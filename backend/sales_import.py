"""Bulk sales import (.xlsx/.csv) — every committed row goes through the REAL
sale pipeline (create_sale_record): stock deduction, weighted-average COGS from
posted cost records, inventory movements and balanced GL entries included.

Rows sharing the same invoice reference (رقم الفاتورة) are grouped into ONE
multi-item sale. Duplicate refs (already imported) are flagged, never re-posted.
"""
import hashlib
import io
import json
from collections import defaultdict
from decimal import Decimal
from typing import Optional

import openpyxl
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from invoice_dates import invoice_date
from numeric_inputs import checked_money
from core import atomic_posting, db, require_perm, log_audit
from imports import _suggest_mapping, _parse_file, _clean_str, _clean_num
from sales import SaleInput, SaleItem, create_sale_record

router = APIRouter(prefix="/api/sales/import", tags=["sales-import"])

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
    return _suggest_mapping(headers, SALE_ALIASES)


def _map_pm(raw: str) -> Optional[str]:
    return PM_MAP.get(raw.strip().casefold()) if raw else None


async def _product_maps(bid: str):
    exact_skus, aliases = defaultdict(list), defaultdict(list)
    async for product in db.products.find({"business_id": bid, "archived": {"$ne": True}},
                                         {"_id": 0, "product_id": 1, "sku": 1, "name": 1,
                                          "selling_price": 1, "stock_qty": 1}):
        sku = (product.get("sku") or "").strip()
        name = (product.get("name") or "").strip()
        if sku:
            exact_skus[sku].append(product)
        for alias in {sku.casefold(), name.casefold()} - {""}:
            aliases[alias].append(product)
    return exact_skus, aliases


def _evaluate(headers, data_rows, mapping, existing_refs, by_sku, by_name, *,
              allow_negative_stock=False, existing_anonymous_rows=()):
    columns = {field: headers.index(header) for field, header in mapping.items() if header in headers}
    groups = defaultdict(list)
    available = {}
    out = []
    for n, row in enumerate(data_rows, start=2):
        def cell(field):
            index = columns.get(field)
            return row[index] if index is not None and index < len(row) else None

        values = {}
        reason = None
        for field, limit in (("invoice_ref", 64), ("customer", 120), ("product", 120),
                             ("payment_method", 40), ("notes", 200)):
            text = _clean_str(cell(field), limit + 1)
            if len(text) > limit:
                reason = "field_too_long"
            values[field] = text
        # Group by the entire original ref. Separate overlong refs must never merge.
        raw_ref = str(cell("invoice_ref")).strip() if cell("invoice_ref") is not None else ""
        identity = raw_ref if len(values["invoice_ref"]) > 64 else values["invoice_ref"]
        key = ("ref", identity.casefold()) if identity else ("row", n)
        try:
            values["date"] = invoice_date(cell("date"))
        except ValueError:
            values["date"] = str(cell("date") or "")
            reason = reason or "invalid_date"

        payment = values["payment_method"]
        if payment and payment.casefold() not in PM_MAP:
            reason = reason or "invalid_payment_method"
        else:
            values["payment_method"] = _map_pm(payment) or ""

        qty, valid_qty = _clean_num(cell("quantity"), quantity=True, whole=True)
        price, valid_price = _clean_num(cell("unit_price"))
        values.update(quantity=qty, unit_price=price)
        candidates = by_sku.get(values["product"]) or by_name.get(values["product"].casefold(), [])
        if not candidates:
            reason = reason or "product_not_found"
        elif len(candidates) != 1:
            reason = reason or "ambiguous_product"
        else:
            product = candidates[0]
            pid = values["product_id"] = product["product_id"]
            available[pid] = Decimal(str(product.get("stock_qty") or 0))
            if price is None and valid_price:
                values["unit_price"] = product.get("selling_price") or 0
        if not valid_qty or not qty or qty < 1:
            reason = reason or "invalid_quantity"
        if not valid_price:
            reason = reason or "invalid_price"
        if not reason:
            try:
                checked_money(Decimal(str(values["unit_price"])) * qty)
            except HTTPException:
                reason = "invalid_price"
        result = {"row": n, "values": values, "status": "invalid" if reason else "new", "reason": reason}
        groups[key].append(result)
        out.append(result)

    # Preview and commit consume whole invoices in first-seen order. Reserve stock
    # only for eligible invoices; sibling errors never silently shrink a sale.
    for (kind, key), lines in groups.items():
        group_error = None
        first_ref = lines[0]["values"]["invoice_ref"]
        for field in ("date", "customer", "payment_method", "notes"):
            distinct = {line["values"][field] for line in lines if line["values"][field]}
            if len(distinct) > 1:
                group_error = "invoice_conflict"
                break
            resolved = next(iter(distinct), "cash" if field == "payment_method" else "")
            for line in lines:
                line["values"][field] = resolved
        for line in lines:
            line["values"]["invoice_ref"] = first_ref
        if any(line["status"] == "invalid" for line in lines):
            group_error = group_error or "invoice_invalid"
        if not group_error and ((kind == "ref" and key in existing_refs)
                                or (kind == "row" and key in existing_anonymous_rows)):
            for line in lines:
                line.update(status="duplicate", reason="exists_ref")
            continue
        if not group_error:
            required = defaultdict(int)
            invoice_total = Decimal(0)
            for line in lines:
                v = line["values"]
                required[v["product_id"]] += v["quantity"]
                invoice_total += round(Decimal(str(v["unit_price"])) * v["quantity"], 2)
            try:
                checked_money(invoice_total)
            except HTTPException:
                group_error = "invalid_price"
            if not allow_negative_stock and any(qty > available[pid] for pid, qty in required.items()):
                group_error = group_error or "insufficient_stock"
            if not group_error:
                for pid, qty in required.items():
                    available[pid] -= qty
        if group_error:
            for line in lines:
                if line["status"] == "new":
                    line.update(status="invalid", reason=group_error)
    return out


def _summary(rows):
    return {"total": len(rows),
            "new": sum(1 for r in rows if r["status"] == "new"),
            "duplicate": sum(1 for r in rows if r["status"] == "duplicate"),
            "invalid": sum(1 for r in rows if r["status"] == "invalid")}


async def _prepare_upload(file, raw_mapping):
    try:
        mapping = json.loads(raw_mapping) if raw_mapping else {}
    except ValueError:
        raise HTTPException(400, "IMPORT_BAD_MAPPING") from None
    headers, data_rows = await _parse_file(file)
    if not isinstance(mapping, dict) or any(
        key not in SALE_FIELDS or not isinstance(header, str) or (header and header not in headers)
        for key, header in mapping.items()
    ):
        raise HTTPException(400, "IMPORT_BAD_MAPPING")
    mapping = mapping or _suggest(headers)
    # The same file may be uploaded under another name, or mapped differently.
    # Only the effective mapping and contents identify an anonymous-row retry.
    effective = {key: header for key, header in mapping.items() if header}
    digest = hashlib.sha256(json.dumps(effective, sort_keys=True).encode())
    digest.update(b"\0")
    await file.seek(0)
    while chunk := await file.read(65536):
        digest.update(chunk)
    return headers, data_rows, mapping, digest.hexdigest()


def _matches_invoice(sale, rows):
    first = rows[0]["values"]
    if (sale.get("status") != "confirmed"
            or (sale.get("customer") or "") != first["customer"]
            or sale.get("payment_method") != first["payment_method"]
            or (sale.get("notes") or "") != first["notes"]
            or (first["date"] and sale.get("date") != first["date"])):
        return False
    fields = ("product_id", "quantity", "unit_price")
    return ([tuple(item.get(key) for key in fields) for item in sale["items"]]
            == [tuple(row["values"].get(key) for key in fields) for row in rows])


async def _upload_rows(prepared, user):
    headers, data_rows, mapping, digest = prepared
    bid = user["business_id"]
    scope = {"business_id": bid}
    receipt = await db.sales_import_receipts.find_one({"_id": f"{bid}:{digest}"}, {"rows": 1})
    originals = await db.sales.distinct("import_ref", {**scope, "import_ref": {"$type": "string"}})
    by_sku, by_name = await _product_maps(bid)
    rows = _evaluate(headers, data_rows, mapping, {ref.strip().casefold() for ref in originals},
                     by_sku, by_name, allow_negative_stock=(user.get("business") or {}).get("allow_negative_stock", False),
                     existing_anonymous_rows=set(receipt["rows"]) if receipt else set())

    duplicates = defaultdict(list)
    for row in rows:
        ref = row["values"]["invoice_ref"]
        if row["status"] == "duplicate" and ref:
            duplicates[ref.casefold()].append(row)
    if duplicates:
        refs = [ref for ref in originals if ref.strip().casefold() in duplicates]
        recorded = defaultdict(list)
        fields = {"import_ref": 1, "customer": 1, "status": 1, "date": 1, "notes": 1,
                  "payment_method": 1, "items.product_id": 1, "items.quantity": 1, "items.unit_price": 1}
        async for sale in db.sales.find({**scope, "import_ref": {"$in": refs}}, fields):
            recorded[sale["import_ref"].strip().casefold()].append(sale)
        for ref, group in duplicates.items():
            if len(recorded[ref]) != 1 or not _matches_invoice(recorded[ref][0], group):
                for row in group:
                    row.update(status="invalid", reason="existing_invoice_conflict")
    return rows


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
    prepared = await _prepare_upload(file, mapping)
    rows = await _upload_rows(prepared, user)
    headers, _, mapping_obj, _ = prepared
    return {"headers": headers, "suggested_mapping": mapping_obj, "fields": SALE_FIELDS, "rows": rows, "summary": _summary(rows)}


@router.post("/commit")
async def sales_import_commit(file: UploadFile = File(...), mapping: str = Form(default=""),
                              user: dict = Depends(require_perm("sales.create"))):
    prepared = await _prepare_upload(file, mapping)
    return await _commit_upload(prepared, user)


@atomic_posting
async def _commit_upload(prepared, user):
    bid = user["business_id"]
    # Concurrent imports (including different files that share a reference) must
    # validate against the previous commit. Updating the tenant document forces
    # MongoDB to retry a conflicting transaction with a fresh snapshot.
    await db.businesses.update_one({"business_id": bid}, {"$inc": {"sales_import_revision": 1}})
    rows = await _upload_rows(prepared, user)
    groups = defaultdict(list)
    anonymous = []
    for row in rows:
        if row["status"] != "new":
            continue
        values = row["values"]
        ref = values["invoice_ref"]
        key = ref.casefold() if ref else row["row"]
        groups[key].append(values)
        if not ref:
            anonymous.append(row["row"])

    for group in groups.values():
        first = group[0]
        invoice = SaleInput(
            customer=first["customer"], payment_method=first["payment_method"], notes=first["notes"],
            items=[SaleItem(product_id=line["product_id"], quantity=line["quantity"], unit_price=line["unit_price"])
                   for line in group],
        )
        await create_sale_record(bid, user, invoice, import_ref=first["invoice_ref"] or None,
                                 sale_date=first["date"] or None)

    if anonymous:
        await db.sales_import_receipts.update_one(
            {"_id": f"{bid}:{prepared[3]}"},
            {"$setOnInsert": {"business_id": bid, "file_digest": prepared[3]}, "$addToSet": {"rows": {"$each": anonymous}}},
            upsert=True,
        )
    summary = _summary(rows)
    await log_audit(bid, user, "sales.imported", "sale", "",
                    f"{len(groups)} invoices from {summary['new']} rows · skipped {summary['duplicate']} · invalid {summary['invalid']}")
    return {"ok": True, "invoices_created": len(groups), "rows_imported": summary["new"],
            "duplicate": summary["duplicate"], "invalid": summary["invalid"]}
