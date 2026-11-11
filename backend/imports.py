"""Bulk product import (.xlsx / .csv) with column mapping, preview, and safe commit.

Security & integrity:
- Extension + magic-byte checks, 5MB size cap, 2000-row cap.
- openpyxl read_only + data_only: formulas are NEVER evaluated (cached values only),
  macros are never executed; .xlsm/.xls/.xlsb rejected.
- Strings sanitized (control chars stripped, length-capped, spreadsheet-formula
  injection neutralized by apostrophe-prefixing leading = + - @).
- Commit runs with a compensating rollback (single-node Mongo has no multi-doc
  transactions): any failure deletes inserted docs and restores updated originals.
- GL guard: initial quantities set stock_qty directly (opening stock) and never
  post journal entries; formal opening-balance accounting stays in the GL workflow.
"""
import csv
import io
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

import openpyxl
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core import db, require_perm, log_audit, now_iso

router = APIRouter(prefix="/api/products/import", tags=["import"])
products_bulk_router = APIRouter(prefix="/api/products", tags=["products-bulk"])
logger = logging.getLogger(__name__)

MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_ROWS = 2000

FIELDS = ["name", "sku", "category", "unit", "purchase_price", "selling_price", "initial_quantity", "description"]

FIELD_ALIASES = {
    "name": ["اسم المنتج", "المنتج", "الاسم", "product name", "name", "product"],
    "sku": ["رمز المنتج", "الكود", "الباركود", "sku", "product code", "code", "barcode"],
    "category": ["الفئة", "التصنيف", "category"],
    "unit": ["وحدة القياس", "الوحدة", "unit", "unit type", "uom"],
    "purchase_price": ["سعر الشراء", "سعر التكلفة", "تكلفة الشراء", "purchase price", "cost", "buy price"],
    "selling_price": ["سعر البيع", "السعر", "selling price", "sale price", "price"],
    "initial_quantity": ["الكمية الابتدائية", "الكمية", "الرصيد الافتتاحي", "initial quantity", "quantity", "qty", "stock"],
    "description": ["الوصف", "ملاحظات", "description", "notes"],
}

UNIT_MAP = {
    "قطعة": "piece", "حبة": "piece", "piece": "piece", "pcs": "piece",
    "كيلو": "kilogram", "كغ": "kilogram", "كيلوغرام": "kilogram", "kg": "kilogram", "kilogram": "kilogram",
    "جرام": "gram", "غرام": "gram", "gram": "gram", "g": "gram",
    "لتر": "liter", "liter": "liter", "litre": "liter", "l": "liter",
    "مل": "milliliter", "مليلتر": "milliliter", "ml": "milliliter", "milliliter": "milliliter",
    "متر": "meter", "meter": "meter", "m": "meter",
    "سم": "centimeter", "سنتيمتر": "centimeter", "cm": "centimeter", "centimeter": "centimeter",
    "علبة": "box", "صندوق": "box", "box": "box",
    "طقم": "set", "مجموعة": "set", "set": "set",
}

_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
TEMPLATE_HEADERS = ["اسم المنتج", "رمز المنتج/SKU", "الفئة", "وحدة القياس", "سعر الشراء", "سعر البيع", "الكمية الابتدائية", "الوصف"]


def _clean_str(v, max_len: int) -> str:
    if v is None:
        return ""
    s = str(v)
    s = _CTRL.sub("", s).strip()
    if s.startswith(("=", "+", "-", "@")):
        s = "'" + s  # spreadsheet formula-injection guard
    return s[:max_len]


def _clean_num(v):
    """Returns (value, ok). Empty -> (None, True)."""
    if v is None or (isinstance(v, str) and not v.strip()):
        return None, True
    if isinstance(v, bool):
        return None, False
    if isinstance(v, (int, float)):
        return (round(float(v), 4), True) if float(v) >= 0 else (None, False)
    s = str(v).strip().replace("٬", "").replace(",", "").replace(" ", "")
    try:
        f = float(s)
    except ValueError:
        return None, False
    return (round(f, 4), True) if f >= 0 else (None, False)


async def _parse_file(file: UploadFile):
    raw = await file.read(MAX_FILE_BYTES + 1)
    if len(raw) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="IMPORT_FILE_TOO_LARGE")
    name = (file.filename or "").lower()
    if name.endswith((".xlsm", ".xlsb", ".xls")):
        raise HTTPException(status_code=400, detail="IMPORT_UNSUPPORTED_FORMAT")
    if name.endswith(".xlsx"):
        if not raw[:2] == b"PK":
            raise HTTPException(status_code=400, detail="IMPORT_UNSUPPORTED_FORMAT")
        try:
            wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
            ws = wb.active
            rows = [list(r) for r in ws.iter_rows(max_row=MAX_ROWS + 2, values_only=True)]
            wb.close()
        except Exception:
            raise HTTPException(status_code=400, detail="IMPORT_UNREADABLE_FILE")
    elif name.endswith(".csv"):
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            raise HTTPException(status_code=400, detail="IMPORT_UNREADABLE_FILE")
        rows = [r for r in csv.reader(io.StringIO(text))][: MAX_ROWS + 2]
    else:
        raise HTTPException(status_code=400, detail="IMPORT_UNSUPPORTED_FORMAT")
    rows = [r for r in rows if any(c is not None and str(c).strip() for c in r)]
    if not rows:
        raise HTTPException(status_code=400, detail="IMPORT_EMPTY_FILE")
    if len(rows) - 1 > MAX_ROWS:
        raise HTTPException(status_code=400, detail="IMPORT_TOO_MANY_ROWS")
    headers = [_clean_str(h, 80) for h in rows[0]]
    return headers, rows[1:]


def _suggest_mapping(headers):
    mapping = {f: "" for f in FIELDS}
    normalized = {h: h.strip().lower() for h in headers if h}
    for field, aliases in FIELD_ALIASES.items():
        for h, norm in normalized.items():
            if norm in [a.lower() for a in aliases] or any(a.lower() in norm for a in aliases):
                mapping[field] = h
                break
    return mapping


def _map_unit(raw: str) -> Optional[str]:
    if not raw:
        return None
    return UNIT_MAP.get(raw.strip().lower(), "other")


async def _existing_maps(bid: str):
    by_sku, by_name = {}, {}
    async for p in db.products.find({"business_id": bid}, {"_id": 0, "product_id": 1, "sku": 1, "name": 1}):
        if p.get("sku"):
            by_sku[p["sku"]] = p
        by_name[(p.get("name") or "").strip().lower()] = p
    return by_sku, by_name


def _evaluate(headers, data_rows, mapping, strategy, by_sku, by_name):
    idx = {f: None for f in FIELDS}
    for f, h in mapping.items():
        if h:
            try:
                idx[f] = headers.index(h)
            except ValueError:
                pass
    out = []
    seen_sku, seen_name = set(), set()
    for n, r in enumerate(data_rows, start=2):
        def cell(f):
            i = idx[f]
            return r[i] if i is not None and i < len(r) else None

        name = _clean_str(cell("name"), 120)
        sku = _clean_str(cell("sku"), 64)
        category = _clean_str(cell("category"), 100)
        unit = _map_unit(_clean_str(cell("unit"), 40))
        description = _clean_str(cell("description"), 500)
        purchase_price, ok1 = _clean_num(cell("purchase_price"))
        selling_price, ok2 = _clean_num(cell("selling_price"))
        qty, ok3 = _clean_num(cell("initial_quantity"))

        values = {"name": name, "sku": sku, "category": category, "spec_unit": unit,
                  "product_cost": purchase_price, "selling_price": selling_price,
                  "stock_qty": qty or 0, "description": description}

        if not name:
            out.append({"row": n, "values": values, "status": "invalid", "reason": "missing_name"})
            continue
        if not ok1 or not ok2:
            out.append({"row": n, "values": values, "status": "invalid", "reason": "invalid_price"})
            continue
        if not ok3:
            out.append({"row": n, "values": values, "status": "invalid", "reason": "invalid_quantity"})
            continue
        if sku and sku in seen_sku:
            out.append({"row": n, "values": values, "status": "duplicate", "reason": "duplicate_in_file"})
            continue
        if not sku and name.lower() in seen_name:
            out.append({"row": n, "values": values, "status": "duplicate", "reason": "duplicate_in_file"})
            continue
        seen_sku.add(sku) if sku else seen_name.add(name.lower())
        if sku and sku in by_sku:
            status = "update" if strategy == "update" else "duplicate"
            out.append({"row": n, "values": values, "status": status, "reason": "exists_sku"})
            continue
        if name.lower() in by_name:
            out.append({"row": n, "values": values, "status": "duplicate", "reason": "exists_name"})
            continue
        out.append({"row": n, "values": values, "status": "new", "reason": None})
    return out


def _summary(rows):
    return {
        "total": len(rows),
        "new": sum(1 for r in rows if r["status"] == "new"),
        "update": sum(1 for r in rows if r["status"] == "update"),
        "duplicate": sum(1 for r in rows if r["status"] == "duplicate"),
        "invalid": sum(1 for r in rows if r["status"] == "invalid"),
    }


def _product_doc_from_import(user, v):
    now = now_iso()
    return {
        "product_id": f"prod_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "business_id": user["business_id"],
        "name": v["name"], "sku": v["sku"], "selling_price": v["selling_price"],
        "product_cost": v["product_cost"] or 0,
        "currency": None,
        "shipping_cost": 0, "shipping_cost_mode": "unit",
        "advertising_cost": 0, "advertising_cost_mode": "unit",
        "payment_fee": 0, "payment_fee_mode": "unit",
        "discount": 0, "discount_mode": "unit",
        "other_costs": 0, "other_costs_mode": "unit",
        "minimum_stock_level": 0, "launch_date": None,
        "spec_quantity": None, "spec_unit": v["spec_unit"],
        "category": v["category"], "description": v["description"],
        "stock_qty": v["stock_qty"],
        "opening_stock_imported": bool(v["stock_qty"]),
        "is_demo": False, "created_at": now, "updated_at": now,
    }


async def apply_rows(user, rows, by_sku):
    """Write phase with compensating rollback. Stock of UPDATED products is never touched."""
    bid = user["business_id"]
    inserted_ids, backups = [], []
    try:
        for r in rows:
            v = r["values"]
            if r["status"] == "new":
                doc = _product_doc_from_import(user, v)
                await db.products.insert_one(doc)
                inserted_ids.append(doc["product_id"])
            elif r["status"] == "update":
                target = by_sku[v["sku"]]
                original = await db.products.find_one({"product_id": target["product_id"]})
                updates = {"updated_at": now_iso()}
                for f in ("name", "category", "spec_unit", "selling_price", "product_cost", "description"):
                    if v.get(f) not in (None, ""):
                        updates[f] = v[f]
                await db.products.update_one({"product_id": target["product_id"]}, {"$set": updates})
                backups.append(original)
    except Exception:
        logger.exception("import commit failed — rolling back batch")
        if inserted_ids:
            await db.products.delete_many({"product_id": {"$in": inserted_ids}})
        for original in backups:
            await db.products.replace_one({"product_id": original["product_id"]}, original)
        raise HTTPException(status_code=500, detail="IMPORT_ROLLED_BACK")


@router.get("/template")
async def download_template(user: dict = Depends(require_perm("products.view"))):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.sheet_view.rightToLeft = True
    ws.append(TEMPLATE_HEADERS)
    ws.append(["مثال: قهوة عربية 250غ", "COF-250", "مشروبات", "جرام", 25, 45, 100, "قهوة مختصة"])
    ws.append(["مثال: سكر 1كغ", "SUG-1KG", "مواد غذائية", "كيلو", 10, 15, 50, ""])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": "attachment; filename=products_template.xlsx"})


async def _parse_and_evaluate(file, mapping: dict, strategy: str, bid: str):
    headers, data_rows = await _parse_file(file)
    if not mapping:
        mapping = _suggest_mapping(headers)
    by_sku, by_name = await _existing_maps(bid)
    rows = _evaluate(headers, data_rows, mapping, strategy, by_sku, by_name)
    return headers, mapping, rows


@router.post("/preview")
async def import_preview(file: UploadFile = File(...), mapping: str = Form(default=""),
                         strategy: str = Form(default="skip"),
                         user: dict = Depends(require_perm("products.create"))):
    import json
    if strategy not in ("skip", "update"):
        raise HTTPException(status_code=400, detail="IMPORT_BAD_STRATEGY")
    try:
        mapping_obj = json.loads(mapping) if mapping else {}
    except ValueError:
        raise HTTPException(status_code=400, detail="IMPORT_BAD_MAPPING")
    headers, mapping_obj, rows = await _parse_and_evaluate(file, mapping_obj, strategy, user["business_id"])
    return {"headers": headers, "suggested_mapping": mapping_obj, "fields": FIELDS, "rows": rows, "summary": _summary(rows)}


@router.post("/commit")
async def import_commit(file: UploadFile = File(...), mapping: str = Form(default=""), strategy: str = Form(default="skip"),
                        user: dict = Depends(require_perm("products.create"))):
    import json
    if strategy not in ("skip", "update"):
        raise HTTPException(status_code=400, detail="IMPORT_BAD_STRATEGY")
    if strategy == "update" and user.get("role") != "OWNER" and "products.edit" not in (user.get("permissions") or {}):
        raise HTTPException(status_code=403, detail="Missing permission: products.edit")
    try:
        mapping_obj = json.loads(mapping) if mapping else {}
    except ValueError:
        raise HTTPException(status_code=400, detail="IMPORT_BAD_MAPPING")
    _, _, rows = await _parse_and_evaluate(file, mapping_obj, strategy, user["business_id"])
    by_sku, _ = await _existing_maps(user["business_id"])
    writable = [r for r in rows if r["status"] in ("new", "update")]
    await apply_rows(user, writable, by_sku)
    summary = _summary(rows)
    await log_audit(user["business_id"], user, "products.imported", "product", "",
                    f"created {summary['new']} · updated {summary['update']} · skipped {summary['duplicate']} · invalid {summary['invalid']}")
    return {"ok": True, **summary}


@products_bulk_router.get("/export.xlsx")
async def export_products(user: dict = Depends(require_perm("products.view"))):
    """Template-compatible export — files can be edited and re-imported via the import wizard."""
    docs = await db.products.find({"business_id": user["business_id"], "archived": {"$ne": True}}, {"_id": 0}).sort("name", 1).to_list(5000)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.sheet_view.rightToLeft = True
    ws.append(TEMPLATE_HEADERS)
    for p in docs:
        ws.append([p.get("name", ""), p.get("sku", "") or "", p.get("category", "") or "",
                   p.get("spec_unit", "") or "", p.get("product_cost", 0) or 0,
                   p.get("selling_price", "") if p.get("selling_price") is not None else "",
                   p.get("stock_qty", 0) or 0, p.get("description", "") or ""])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": "attachment; filename=products_export.xlsx"})


class BulkDeleteInput(BaseModel):
    product_ids: list[str]


@products_bulk_router.post("/bulk-delete")
async def bulk_delete_products(data: BulkDeleteInput, user: dict = Depends(require_perm("products.delete"))):
    """Safe bulk delete: products with ANY transaction history (sales/purchases/returns)
    are archived instead of deleted, protecting GL and inventory audit trails."""
    bid = user["business_id"]
    deleted, archived = [], []
    for pid in data.product_ids[:500]:
        p = await db.products.find_one({"product_id": pid, "business_id": bid})
        if not p:
            continue
        has_history = any([
            await db.sales.find_one({"business_id": bid, "items.product_id": pid}, {"_id": 1}),
            await db.purchases.find_one({"business_id": bid, "items.product_id": pid}, {"_id": 1}),
            await db.returns.find_one({"business_id": bid, "items.product_id": pid}, {"_id": 1}),
        ])
        if has_history:
            await db.products.update_one({"product_id": pid},
                                         {"$set": {"archived": True, "archived_at": now_iso(), "updated_at": now_iso()}})
            archived.append(p["name"])
        else:
            await db.products.delete_one({"product_id": pid})
            deleted.append(p["name"])
    await log_audit(bid, user, "products.bulk_delete", "product", "",
                    f"deleted {len(deleted)} · archived {len(archived)}")
    return {"deleted": len(deleted), "archived": len(archived), "archived_names": archived[:20]}
