"""Bulk purchases export/import (.xlsx).

- Export: template-compatible workbook (purchases can be edited and re-imported).
- Import: every committed row goes through the REAL purchase pipeline
  (create_purchase): stock increase, weighted-average cost update, inventory
  movements and balanced GL posting included.
- Duplicate protection: rows carrying an already-imported invoice reference
  (import_ref) are skipped; duplicates inside the same file are also flagged.
- Existing purchase records are NEVER modified — rows only create new purchases.
"""
import io
import json
import logging

import openpyxl
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from core import db, require_perm, log_audit
from imports import _parse_file, _clean_str, _clean_num
from purchases import PurchaseInput, PurchaseItem, create_purchase, cancel_purchase
from sales_import import _map_pm

router = APIRouter(prefix="/api/purchases", tags=["purchases-import"])
logger = logging.getLogger(__name__)

PURCHASE_FIELDS = ["invoice_ref", "date", "supplier", "product", "quantity", "unit_cost", "payment_method", "additional_costs", "notes"]
PURCHASE_ALIASES = {
    "invoice_ref": ["رقم الفاتورة", "رقم المرجع", "invoice", "invoice #", "invoice no", "ref", "reference"],
    "date": ["التاريخ", "date", "purchase date"],
    "supplier": ["المورد", "supplier", "vendor"],
    "product": ["المنتج", "المنتج/sku", "اسم المنتج", "رمز المنتج", "sku", "product", "product name", "item"],
    "quantity": ["الكمية", "quantity", "qty"],
    "unit_cost": ["سعر الشراء", "سعر الوحدة", "تكلفة الوحدة", "unit cost", "unit price", "cost", "price"],
    "payment_method": ["طريقة الدفع", "payment method", "payment"],
    "additional_costs": ["تكاليف إضافية", "تكاليف اضافية", "additional costs", "extra costs"],
    "notes": ["ملاحظات", "notes", "الوصف", "description"],
}
TEMPLATE_HEADERS = ["رقم الفاتورة", "التاريخ", "المورد", "المنتج/SKU", "الكمية", "سعر الشراء", "طريقة الدفع", "تكاليف إضافية", "ملاحظات"]


def _suggest(headers):
    mapping = {f: "" for f in PURCHASE_FIELDS}
    norm = {h: h.strip().lower() for h in headers if h}
    for field, aliases in PURCHASE_ALIASES.items():
        for h, n in norm.items():
            if n in [a.lower() for a in aliases] or any(a.lower() in n for a in aliases):
                mapping[field] = h
                break
    return mapping


async def _product_maps(bid: str):
    by_sku, by_name = {}, {}
    async for p in db.products.find({"business_id": bid, "archived": {"$ne": True}},
                                    {"_id": 0, "product_id": 1, "sku": 1, "name": 1, "product_cost": 1}):
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
        supplier = _clean_str(cell("supplier"), 120)
        prod_raw = _clean_str(cell("product"), 120)
        qty, ok_q = _clean_num(cell("quantity"))
        cost, ok_c = _clean_num(cell("unit_cost"))
        pm = _map_pm(_clean_str(cell("payment_method"), 40))
        add_costs, ok_a = _clean_num(cell("additional_costs"))
        notes = _clean_str(cell("notes"), 200)

        product = by_sku.get(prod_raw.lower()) or by_name.get(prod_raw.lower())
        values = {"invoice_ref": ref, "date": date, "supplier": supplier, "product": prod_raw,
                  "quantity": qty, "unit_cost": cost, "payment_method": pm,
                  "additional_costs": add_costs, "notes": notes}

        if not supplier:
            out.append({"row": n, "values": values, "status": "invalid", "reason": "missing_supplier"})
            continue
        if not prod_raw or not product:
            out.append({"row": n, "values": values, "status": "invalid", "reason": "product_not_found"})
            continue
        if qty is None or not ok_q or qty <= 0 or float(qty) != int(qty):
            out.append({"row": n, "values": values, "status": "invalid", "reason": "invalid_quantity"})
            continue
        if cost is None or not ok_c:
            out.append({"row": n, "values": values, "status": "invalid", "reason": "invalid_price"})
            continue
        if not ok_a:
            out.append({"row": n, "values": values, "status": "invalid", "reason": "invalid_price"})
            continue
        if ref and ref.lower() in existing_refs:
            out.append({"row": n, "values": values, "status": "duplicate", "reason": "exists_ref"})
            continue
        values["product_id"] = product["product_id"]
        values["quantity"] = int(qty)
        values["unit_cost"] = cost
        values["additional_costs"] = add_costs or 0
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
    existing_refs = {r.lower() for r in await db.purchases.distinct("import_ref", {"business_id": bid, "import_ref": {"$ne": None}})}
    by_sku, by_name = await _product_maps(bid)
    rows = _evaluate(headers, data_rows, mapping, existing_refs, by_sku, by_name)
    return headers, mapping, rows


@router.get("/export.xlsx")
async def export_purchases(user: dict = Depends(require_perm("purchases.view"))):
    """Template-compatible export — files can be edited and re-imported via the import wizard."""
    docs = await db.purchases.find({"business_id": user["business_id"]}, {"_id": 0}).sort("created_at", -1).to_list(10000)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.sheet_view.rightToLeft = True
    ws.append(TEMPLATE_HEADERS)
    for p in docs:
        n_items = len(p.get("items", []))
        for j, it in enumerate(p.get("items", [])):
            ws.append([
                p.get("invoice_number") or p.get("import_ref") or p.get("purchase_number", ""),
                str(p.get("purchase_date", ""))[:10],
                p.get("supplier", ""),
                it.get("name", ""),
                it.get("quantity", 0),
                it.get("unit_cost", 0),
                p.get("payment_method", ""),
                p.get("additional_costs", 0) if j == 0 else "",
                p.get("notes", "") if j == 0 else "",
            ])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": "attachment; filename=purchases_export.xlsx"})


@router.get("/import/template")
async def purchases_template(user: dict = Depends(require_perm("purchases.view"))):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.sheet_view.rightToLeft = True
    ws.append(TEMPLATE_HEADERS)
    ws.append(["PO-0001", "2026-01-15", "مورد الجملة", "COF-250", 20, 25, "نقدي", 10, "شحنة يناير"])
    ws.append(["PO-0001", "2026-01-15", "مورد الجملة", "SUG-1KG", 30, 10, "نقدي", "", ""])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": "attachment; filename=purchases_template.xlsx"})


@router.post("/import/preview")
async def purchases_import_preview(file: UploadFile = File(...), mapping: str = Form(default=""),
                                   user: dict = Depends(require_perm("purchases.create"))):
    try:
        mapping_obj = json.loads(mapping) if mapping else {}
    except ValueError:
        raise HTTPException(status_code=400, detail="IMPORT_BAD_MAPPING")
    headers, mapping_obj, rows = await _parse_and_evaluate(file, mapping_obj, user["business_id"])
    return {"headers": headers, "suggested_mapping": mapping_obj, "fields": PURCHASE_FIELDS, "rows": rows, "summary": _summary(rows)}


@router.post("/import/commit")
async def purchases_import_commit(file: UploadFile = File(...), mapping: str = Form(default=""),
                                  user: dict = Depends(require_perm("purchases.create"))):
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
                                    "supplier": r["values"]["supplier"], "payment_method": r["values"]["payment_method"],
                                    "additional_costs": r["values"]["additional_costs"],
                                    "notes": r["values"]["notes"], "items": []})
        g["items"].append({"product_id": r["values"]["product_id"], "quantity": r["values"]["quantity"],
                           "unit_cost": r["values"]["unit_cost"]})

    created = []
    try:
        for g in groups.values():
            data = PurchaseInput(
                supplier=g["supplier"],
                invoice_number=g["ref"] or "",
                purchase_date=g["date"] or None,
                notes=g["notes"] or "",
                additional_costs=g["additional_costs"],
                payment_method=g["payment_method"],
                client_ref=f"import:{g['ref']}" if g["ref"] else None,
                items=[PurchaseItem(**it) for it in g["items"]],
            )
            doc = await create_purchase(data, user)
            await db.purchases.update_one({"purchase_id": doc["purchase_id"]},
                                          {"$set": {"import_ref": g["ref"] or None}})
            created.append(doc)
    except Exception:
        logger.exception("purchases import failed — cancelling %d created purchases", len(created))
        for doc in reversed(created):
            try:
                await cancel_purchase(doc["purchase_id"], user)
            except Exception:
                logger.exception("rollback cancel failed for %s", doc["purchase_id"])
        raise HTTPException(status_code=500, detail="IMPORT_ROLLED_BACK")

    summary = _summary(rows)
    await log_audit(user["business_id"], user, "purchases.imported", "purchase", "",
                    f"{len(created)} invoices from {summary['new']} rows · skipped {summary['duplicate']} · invalid {summary['invalid']}")
    return {"ok": True, "invoices_created": len(created), "rows_imported": summary["new"],
            "duplicate": summary["duplicate"], "invalid": summary["invalid"]}
