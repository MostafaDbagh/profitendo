"""Bulk sales import (.xlsx/.csv) — every committed row goes through the REAL
sale pipeline (create_sale_record): stock deduction, weighted-average COGS from
posted cost records, inventory movements and balanced GL entries included.

Rows sharing the same invoice reference (رقم الفاتورة) are grouped into ONE
multi-item sale. Duplicate refs (already imported) are flagged, never re-posted.
"""
import io
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

import openpyxl
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from core import db, require_perm, log_audit
from imports import _parse_file, _clean_str, _clean_num, MAX_ROWS
from sales import SaleInput, SaleItem, create_sale_record, cancel_sale

router = APIRouter(prefix="/api/sales/import", tags=["sales-import"])
logger = logging.getLogger(__name__)

SALE_FIELDS = ["invoice_ref", "date", "customer", "product", "quantity", "unit_price", "payment_method", "notes"]
SALE_ALIASES = {
    "invoice_ref": ["رقم الفاتورة", "رقم المرجع", "invoice", "invoice #", "ref", "reference", "invoice no"],
    "date": ["التاريخ", "date", "sale date"],
    "customer": ["العميل", "customer", "client", "الزبون"],
    "product": ["المنتج", "اسم المنتج", "رمز المنتج", "sku", "product", "product name", "item"],
    "quantity": ["الكمية", "quantity", "qty"],
    "unit_price": ["سعر البيع", "سعر الوحدة", "unit price", "price", "selling price"],
    "payment_method": ["طريقة الدفع", "payment method", "payment"],
    "notes": ["ملاحظات", "notes", "الوصف", "description"],
}
PM_MAP = {
    "نقدي": "cash", "كاش": "cash", "نقد": "cash", "cash": "cash",
    "بطاقة": "card", "card": "card",
    "تحويل": "transfer", "حوالة": "transfer", "transfer": "transfer", "bank": "transfer",
    "أخرى": "other", "اخرى": "other", "other": "other",
    "آجل": "credit", "اجل": "credit", "دين": "credit", "credit": "credit",
}
TEMPLATE_HEADERS = ["رقم الفاتورة", "التاريخ", "العميل", "المنتج/SKU", "الكمية", "سعر البيع", "طريقة الدفع", "ملاحظات"]


def _suggest(headers):
    mapping = {f: "" for f in SALE_FIELDS}
    norm = {h: h.strip().lower() for h in headers if h}
    for field, aliases in SALE_ALIASES.items():
        for h, n in norm.items():
            if n in [a.lower() for a in aliases] or any(a.lower() in n for a in aliases):
                mapping[field] = h
                break
    return mapping


def _map_pm(raw: str) -> Optional[str]:
    if not raw:
        return None
    return PM_MAP.get(raw.strip().lower())


async def _product_maps(bid: str):
    by_sku, by_name = {}, {}
    async for p in db.products.find({"business_id": bid, "archived": {"$ne": True}},
                                    {"_id": 0, "product_id": 1, "sku": 1, "name": 1, "selling_price": 1, "stock_qty": 1}):
        if p.get("sku"):
            by_sku[p["sku"].strip().lower()] = p
        by_name[(p.get("name") or "").strip().lower()] = p
    return by_sku, by_name


def _evaluate(headers, data_rows, mapping, existing_refs, by_sku, by_name):
    idx = {}
    for f, h in mapping.items():
        if h and h in headers:
            idx[f] = headers.index(h)
    out = []
    for n, r in enumerate(data_rows, start=2):
        def cell(f):
            i = idx.get(f)
            return r[i] if i is not None and i < len(r) else None

        ref = _clean_str(cell("invoice_ref"), 64)
        date = _clean_str(cell("date"), 20)
        customer = _clean_str(cell("customer"), 120)
        prod_raw = _clean_str(cell("product"), 120)
        qty, ok_q = _clean_num(cell("quantity"))
        price, ok_p = _clean_num(cell("unit_price"))
        pm = _map_pm(_clean_str(cell("payment_method"), 40))
        notes = _clean_str(cell("notes"), 200)

        product = by_sku.get(prod_raw.lower()) or by_name.get(prod_raw.lower())
        values = {"invoice_ref": ref, "date": date, "customer": customer, "product": prod_raw,
                  "quantity": qty, "unit_price": price, "payment_method": pm, "notes": notes}

        if not prod_raw or not product:
            out.append({"row": n, "values": values, "status": "invalid", "reason": "product_not_found"})
            continue
        if qty is None or not ok_q or qty <= 0:
            out.append({"row": n, "values": values, "status": "invalid", "reason": "invalid_quantity"})
            continue
        if not ok_p:
            out.append({"row": n, "values": values, "status": "invalid", "reason": "invalid_price"})
            continue
        if (product.get("stock_qty", 0) or 0) < qty:
            out.append({"row": n, "values": values, "status": "invalid", "reason": "insufficient_stock"})
            continue
        if ref and ref.lower() in existing_refs:
            out.append({"row": n, "values": values, "status": "duplicate", "reason": "exists_ref"})
            continue
        values["product_id"] = product["product_id"]
        if price is None:
            values["unit_price"] = product.get("selling_price") or 0
        values["payment_method"] = pm or "cash"
        out.append({"row": n, "values": values, "status": "new", "reason": None})
    return out


def _summary(rows):
    return {"total": len(rows),
            "new": sum(1 for r in rows if r["status"] == "new"),
            "duplicate": sum(1 for r in rows if r["status"] == "duplicate"),
            "invalid": sum(1 for r in rows if r["status"] == "invalid")}


async def _parse_and_evaluate(file, mapping, bid):
    headers, data_rows = await _parse_file(file)
    if not mapping:
        mapping = _suggest(headers)
    existing_refs = {r.lower() for r in await db.sales.distinct("import_ref", {"business_id": bid, "import_ref": {"$ne": None}})}
    by_sku, by_name = await _product_maps(bid)
    rows = _evaluate(headers, data_rows, mapping, existing_refs, by_sku, by_name)
    return headers, mapping, rows


@router.get("/template")
async def sales_template(user: dict = Depends(require_perm("sales.view"))):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.sheet_view.rightToLeft = True
    ws.append(TEMPLATE_HEADERS)
    ws.append(["IMP-0001", "2026-01-15", "عميل نقدي", "COF-250", 2, 45, "نقدي", ""])
    ws.append(["IMP-0001", "2026-01-15", "عميل نقدي", "SUG-1KG", 1, 15, "نقدي", ""])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": "attachment; filename=sales_template.xlsx"})


@router.post("/preview")
async def sales_import_preview(file: UploadFile = File(...), mapping: str = Form(default=""),
                               user: dict = Depends(require_perm("sales.create"))):
    try:
        mapping_obj = json.loads(mapping) if mapping else {}
    except ValueError:
        raise HTTPException(status_code=400, detail="IMPORT_BAD_MAPPING")
    headers, mapping_obj, rows = await _parse_and_evaluate(file, mapping_obj, user["business_id"])
    return {"headers": headers, "suggested_mapping": mapping_obj, "fields": SALE_FIELDS, "rows": rows, "summary": _summary(rows)}


@router.post("/commit")
async def sales_import_commit(file: UploadFile = File(...), mapping: str = Form(default=""),
                              user: dict = Depends(require_perm("sales.create"))):
    try:
        mapping_obj = json.loads(mapping) if mapping else {}
    except ValueError:
        raise HTTPException(status_code=400, detail="IMPORT_BAD_MAPPING")
    _, _, rows = await _parse_and_evaluate(file, mapping_obj, user["business_id"])
    valid = [r for r in rows if r["status"] == "new"]

    groups = {}
    for r in valid:
        key = r["values"]["invoice_ref"] or f"__row_{r['row']}"
        g = groups.setdefault(key, {"ref": r["values"]["invoice_ref"], "date": r["values"]["date"],
                                    "customer": r["values"]["customer"], "payment_method": r["values"]["payment_method"],
                                    "notes": r["values"]["notes"], "items": []})
        g["items"].append({"product_id": r["values"]["product_id"], "quantity": r["values"]["quantity"],
                           "unit_price": r["values"]["unit_price"]})

    created = []
    try:
        for g in groups.values():
            data = SaleInput(
                customer=g["customer"] or None,
                payment_method=g["payment_method"],
                notes=g["notes"] or None,
                items=[SaleItem(**it) for it in g["items"]],
            )
            doc = await create_sale_record(user["business_id"], user, data,
                                           import_ref=g["ref"] or None, sale_date=g["date"] or None)
            created.append(doc)
    except Exception:
        logger.exception("sales import failed — cancelling %d created sales", len(created))
        for doc in created:
            try:
                await cancel_sale(doc["sale_id"], user)
            except Exception:
                logger.exception("rollback cancel failed for %s", doc["sale_id"])
        raise HTTPException(status_code=500, detail="IMPORT_ROLLED_BACK")

    summary = _summary(rows)
    await log_audit(user["business_id"], user, "sales.imported", "sale", "",
                    f"{len(created)} invoices from {summary['new']} rows · skipped {summary['duplicate']} · invalid {summary['invalid']}")
    return {"ok": True, "invoices_created": len(created), "rows_imported": summary["new"],
            "duplicate": summary["duplicate"], "invalid": summary["invalid"]}
