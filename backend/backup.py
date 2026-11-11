import io
import json
import re
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from core import db, get_current_user, log_audit, now_iso

router = APIRouter(prefix="/api/backup", tags=["backup"])

USER_EXCLUDED_FIELDS = {"password_hash", "reset_token_hash", "reset_token_expires"}
BUSINESS_EXCLUDED_FIELDS = {"pin_hash"}

BACKUP_COLLECTIONS = [
    "products",
    "sales",
    "purchases",
    "purchase_returns",
    "returns",
    "expenses",
    "inventory_movements",
    "cash_closings",
    "withdrawals",
    "partners",
    "partner_transactions",
    "accounts",
    "journal_entries",
    "audit_logs",
]


@router.get("/export")
async def export_backup(user: dict = Depends(get_current_user)):
    if user.get("role") != "OWNER":
        raise HTTPException(status_code=403, detail="Only the owner can export a backup")
    biz_id = user["business_id"]

    business = await db.businesses.find_one({"business_id": biz_id}, {"_id": 0}) or {}
    business = {k: v for k, v in business.items() if k not in BUSINESS_EXCLUDED_FIELDS}

    users = await db.users.find({"business_id": biz_id}, {"_id": 0}).to_list(10000)
    users = [{k: v for k, v in u.items() if k not in USER_EXCLUDED_FIELDS} for u in users]

    data = {"business": business, "users": users}
    for name in BACKUP_COLLECTIONS:
        data[name] = await db[name].find({"business_id": biz_id}, {"_id": 0}).to_list(200000)

    payload = {
        "meta": {
            "app": "ProfitLens",
            "format_version": 1,
            "exported_at": now_iso(),
            "business_id": biz_id,
        },
        "data": data,
    }
    await log_audit(biz_id, user, "backup.exported", "business", biz_id, "Full JSON backup downloaded")

    buf = io.BytesIO(json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8"))
    filename = f"profitlens-backup-{biz_id}-{date.today().isoformat()}.json"
    return StreamingResponse(
        buf,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Excel (.xlsx) backup — same business data as the JSON export, organized into
# readable worksheets. Read-only: never alters stored data.
# ---------------------------------------------------------------------------

XLSX_SHEETS = [
    ("Products", "products", [
        "product_id", "name", "sku", "category", "spec_quantity", "spec_unit",
        "product_cost", "selling_price", "stock_qty", "minimum_stock_level",
        "discount", "shipping_cost", "advertising_cost", "payment_fee", "other_costs",
        "launch_date", "description", "archived", "is_demo", "created_at", "updated_at",
    ]),
    ("Purchases", "purchases", [
        "purchase_id", "purchase_number", "supplier", "invoice_number", "purchase_date",
        "payment_method", "subtotal", "additional_costs", "total", "status", "import_ref",
        "notes", "created_by", "created_by_name", "created_at",
    ]),
    ("Purchase Items", "purchases", [
        "purchase_id", "purchase_number", "supplier", "purchase_date",
        "product_id", "name", "quantity", "unit_cost", "total",
    ]),
    ("Sales", "sales", [
        "sale_id", "sale_number", "date", "customer", "payment_method", "currency",
        "subtotal", "discount", "total", "cogs", "profit", "status", "import_ref",
        "notes", "created_by", "created_by_name", "created_at",
    ]),
    ("Sale Items", "sales", [
        "sale_id", "sale_number", "date", "customer",
        "product_id", "name", "quantity", "unit_type", "unit_price", "discount", "total", "unit_cost", "cogs",
    ]),
    ("Expenses", "expenses", [
        "expense_id", "expense_number", "expense_date", "category", "description",
        "amount", "payment_method", "status", "notes", "created_by", "created_by_name", "created_at",
    ]),
    ("Customers", None, []),       # built from customers collection if present
    ("Suppliers", None, []),       # built from suppliers collection if present
    ("Inventory", "inventory_movements", [
        "movement_id", "product_id", "product_name", "quantity", "movement_type",
        "reference_id", "reference_number", "user_id", "user_name", "notes", "created_at",
    ]),
    ("Accounting Records", "journal_entries", [
        "entry_id", "entry_number", "date", "entry_type", "description",
        "debit_account", "credit_account", "amount",
        "reference_type", "reference_id", "reference_number",
        "status", "created_by", "created_by_name", "created_at",
    ]),
    ("Purchase Returns", "purchase_returns", []),
    ("Returns", "returns", []),
    ("Cash Closings", "cash_closings", []),
    ("Withdrawals", "withdrawals", []),
    ("Partners", "partners", []),
    ("Partner Transactions", "partner_transactions", []),
    ("Accounts", "accounts", []),
]


def _flatten_rows(docs: list, fields: list, item_fields: list = None) -> list:
    """Return rows: either flat per-doc rows, or one row per item for line sheets."""
    rows = []
    for doc in docs:
        if item_fields:
            parent = {k: doc.get(k) for k in fields if k in doc}
            items = doc.get("items") or []
            for it in items:
                row = {**parent, **{k: it.get(k) for k in item_fields if k in it}}
                rows.append([_cell(row.get(k)) for k in (fields + item_fields)])
        else:
            rows.append([_cell(doc.get(k)) for k in fields])
    return rows


def _cell(v):
    if v is None:
        return ""
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, (list, dict)):
        return json.dumps(v, ensure_ascii=False, default=str)
    return str(v)


def _generic_fields(docs: list) -> list:
    seen, fields = set(), []
    for d in docs:
        for k in d.keys():
            if k not in seen:
                seen.add(k)
                fields.append(k)
    return fields


@router.get("/export.xlsx")
async def export_backup_xlsx(user: dict = Depends(get_current_user)):
    if user.get("role") != "OWNER":
        raise HTTPException(status_code=403, detail="Only the owner can export a backup")
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment
    from openpyxl.utils import get_column_letter

    biz_id = user["business_id"]
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    header_font = Font(bold=True, color="FFFFFF", size=11)
    header_fill = PatternFill("solid", fgColor="065F46")

    meta = wb.create_sheet("Info")
    meta.sheet_view.rightToLeft = False
    meta.append(["app", "format_version", "exported_at", "business_id"])
    meta.append(["ProfitLens", 1, now_iso(), biz_id])
    for c in ("A", "B", "C", "D"):
        meta.column_dimensions[c].width = 28

    for sheet_name, coll, fields in XLSX_SHEETS:
        docs = await db[coll].find({"business_id": biz_id}, {"_id": 0}).to_list(200000) if coll else []
        item_fields = None
        if sheet_name == "Purchase Items":
            fields, item_fields = fields[:4], fields[4:]
        elif sheet_name == "Sale Items":
            fields, item_fields = fields[:4], fields[4:]
        if not fields:
            fields = _generic_fields(docs) or ["empty"]
        ws = wb.create_sheet(sheet_name[:31])
        headers = list(fields) + (item_fields or [])
        ws.append(headers)
        for ci in range(1, len(headers) + 1):
            cell = ws.cell(row=1, column=ci)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal="center")
            ws.column_dimensions[get_column_letter(ci)].width = max(14, min(32, len(str(headers[ci - 1])) + 6))
        rows = _flatten_rows(docs, fields, item_fields) if item_fields else [[_cell(d.get(k)) for k in fields] for d in docs]
        for row in rows:
            ws.append(row)
        if rows:
            ws.auto_filter.ref = f"A1:{get_column_letter(len(headers))}{len(rows) + 1}"
        ws.freeze_panes = "A2"

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    await log_audit(biz_id, user, "backup.exported_xlsx", "business", biz_id, "Full Excel backup downloaded")
    filename = f"profitlens-backup-{biz_id}-{date.today().isoformat()}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
