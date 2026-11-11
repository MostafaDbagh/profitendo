import uuid
import io
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from core import db, require_perm, log_audit, now_iso, next_number, caps_of, CURRENCIES, require_edit_pin
from ledger import post_sale, reverse_sale, try_post

router = APIRouter(prefix="/api/sales", tags=["sales"])

PAYMENT_METHODS = "^(cash|card|transfer|other|credit)$"


class SaleItem(BaseModel):
    product_id: str
    quantity: int = Field(ge=1)
    unit_price: Optional[float] = Field(default=None, ge=0)
    discount: float = Field(ge=0, default=0)
    unit_type: Optional[str] = Field(default=None, pattern="^(gram|kilogram|milliliter|piece)$")
    total: Optional[float] = Field(default=None, ge=0)


class SaleInput(BaseModel):
    customer: Optional[str] = ""
    payment_method: str = Field(default="cash", pattern=PAYMENT_METHODS)
    notes: Optional[str] = ""
    currency: Optional[str] = None
    client_ref: Optional[str] = Field(default=None, max_length=64)
    items: List[SaleItem] = Field(min_length=1)


class SaleUpdate(BaseModel):
    customer: Optional[str] = None
    payment_method: Optional[str] = Field(default=None, pattern=PAYMENT_METHODS)
    notes: Optional[str] = None
    currency: Optional[str] = None
    items: Optional[List[SaleItem]] = None
    pin: Optional[str] = None


def sale_public(doc: dict, caps: dict) -> dict:
    doc = {k: v for k, v in doc.items() if k not in ("_id", "business_id")}
    if not caps.get("costs"):
        doc.pop("cogs", None)
        for item in doc.get("items", []):
            item.pop("unit_cost", None)
            item.pop("cogs", None)
    if not caps.get("profit"):
        doc.pop("profit", None)
    return doc


@router.get("")
async def list_sales(user: dict = Depends(require_perm("sales.view"))):
    caps = caps_of(user)
    docs = await db.sales.find({"business_id": user["business_id"]}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    return [sale_public(d, caps) for d in docs]


@router.get("/export.xlsx")
async def export_sales(user: dict = Depends(require_perm("sales.view"))):
    import openpyxl
    caps = caps_of(user)
    fin = caps["costs"] and caps["profit"]
    bid = user["business_id"]
    sales = await db.sales.find({"business_id": bid}, {"_id": 0}).sort("created_at", -1).to_list(10000)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.sheet_view.rightToLeft = True
    headers = ["رقم الفاتورة", "التاريخ", "العميل", "المنتجات", "الكميات", "أسعار البيع", "الإجمالي", "طريقة الدفع", "الحالة"]
    if fin:
        headers += ["تكلفة البضاعة", "صافي الربح"]
    ws.append(headers)
    for s in sales:
        row = [
            s["sale_number"], str(s.get("date", ""))[:10], s.get("customer", ""),
            "، ".join(i["name"] for i in s["items"]),
            "، ".join(str(i["quantity"]) for i in s["items"]),
            "، ".join(str(i["unit_price"]) for i in s["items"]),
            s["total"], s.get("payment_method", ""), s.get("status", ""),
        ]
        if fin:
            row += [s.get("cogs", 0), s.get("profit", 0)]
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": "attachment; filename=sales_export.xlsx"})


@router.post("", status_code=201)
async def create_sale(data: SaleInput, user: dict = Depends(require_perm("sales.create"))):
    bid = user["business_id"]
    if data.client_ref:
        existing = await db.sales.find_one({"business_id": bid, "client_ref": data.client_ref})
        if existing:
            return sale_public(existing, caps_of(user))
    doc = await create_sale_record(bid, user, data)
    return sale_public(doc, caps_of(user))


async def create_sale_record(bid: str, user: dict, data: SaleInput, *, import_ref: Optional[str] = None,
                             sale_date: Optional[str] = None) -> dict:
    """Core sale creation — used by the API endpoint and the bulk importer.
    Stock, weighted-average cost, inventory movements and GL posting all happen here."""
    allow_negative = (user.get("business") or {}).get("allow_negative_stock", False)
    if data.currency and data.currency not in CURRENCIES:
        raise HTTPException(status_code=400, detail="Invalid currency")
    currency = data.currency or (user.get("business") or {}).get("base_currency", "USD")

    products = []
    for it in data.items:
        p = await db.products.find_one({"product_id": it.product_id, "business_id": bid})
        if not p:
            raise HTTPException(status_code=404, detail="Product not found")
        if not allow_negative and (p.get("stock_qty", 0) or 0) < it.quantity:
            raise HTTPException(status_code=400, detail=f"Insufficient stock: {p['name']}")
        products.append((p, it))

    sid = f"sal_{uuid.uuid4().hex[:12]}"
    number = await next_number(bid, "sale")
    now = now_iso()
    lines = []
    subtotal = 0.0
    total_discount = 0.0
    cogs = 0.0
    for p, it in products:
        price = it.unit_price if it.unit_price is not None else (p.get("selling_price", 0) or 0)
        line_base = round(it.total, 2) if it.total is not None else round(price * it.quantity, 2)
        discount = min(it.discount, line_base)
        line_total = round(line_base - discount, 2)
        unit_cost = p.get("product_cost", 0) or 0
        line_cogs = round(unit_cost * it.quantity, 2)
        subtotal += line_base
        total_discount += discount
        cogs += line_cogs
        lines.append({
            "product_id": p["product_id"],
            "name": p["name"],
            "quantity": it.quantity,
            "unit_type": it.unit_type,
            "unit_price": price,
            "discount": round(discount, 2),
            "total": line_total,
            "unit_cost": unit_cost,
            "cogs": line_cogs,
        })
    total = round(subtotal - total_discount, 2)
    cogs = round(cogs, 2)

    doc = {
        "sale_id": sid,
        "client_ref": data.client_ref,
        "business_id": bid,
        "sale_number": number,
        "date": sale_date or now,
        "customer": (data.customer or "").strip(),
        "payment_method": data.payment_method,
        "notes": data.notes or "",
        "currency": currency,
        "items": lines,
        "subtotal": round(subtotal, 2),
        "discount_total": round(total_discount, 2),
        "total": total,
        "cogs": cogs,
        "profit": round(total - cogs, 2),
        "status": "confirmed",
        "import_ref": import_ref,
        "created_by": user["user_id"],
        "created_by_name": user.get("name", ""),
        "created_at": now,
    }
    await db.sales.insert_one(doc)

    for p, it in products:
        await db.products.update_one(
            {"product_id": p["product_id"]},
            {"$inc": {"stock_qty": -it.quantity, "quantity_sold": it.quantity}, "$set": {"updated_at": now}},
        )
        await db.inventory_movements.insert_one({
            "movement_id": f"mov_{uuid.uuid4().hex[:12]}",
            "business_id": bid,
            "product_id": p["product_id"],
            "product_name": p["name"],
            "quantity": -it.quantity,
            "movement_type": "SALE",
            "reference_id": sid,
            "reference_number": number,
            "user_id": user["user_id"],
            "user_name": user.get("name", ""),
            "notes": data.notes or "",
            "created_at": now,
        })

    await log_audit(bid, user, "sale.created", "sale", sid, f"{number} · {total}")
    await try_post(post_sale(bid, user, doc))
    doc.pop("_id", None)
    return doc


@router.put("/{sale_id}")
async def update_sale(sale_id: str, data: SaleUpdate, user: dict = Depends(require_perm("sales.edit"))):
    bid = user["business_id"]
    require_edit_pin(user, data.pin)
    sale = await db.sales.find_one({"sale_id": sale_id, "business_id": bid})
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    if sale.get("status") != "confirmed":
        raise HTTPException(status_code=400, detail="Only confirmed sales can be edited")
    allow_negative = (user.get("business") or {}).get("allow_negative_stock", False)
    now = now_iso()
    updates = {}
    if data.customer is not None:
        updates["customer"] = data.customer.strip()
    if data.payment_method is not None:
        updates["payment_method"] = data.payment_method
    if data.notes is not None:
        updates["notes"] = data.notes
    if data.currency is not None:
        if data.currency not in CURRENCIES:
            raise HTTPException(status_code=400, detail="Invalid currency")
        updates["currency"] = data.currency

    if data.items is not None:
        if len(data.items) < 1:
            raise HTTPException(status_code=400, detail="At least one item is required")
        old_map = {}
        for line in sale["items"]:
            old_map[line["product_id"]] = old_map.get(line["product_id"], 0) + line["quantity"]
        new_map = {}
        for it in data.items:
            new_map[it.product_id] = new_map.get(it.product_id, 0) + it.quantity
        prods = {}
        for pid in set(old_map) | set(new_map):
            p = await db.products.find_one({"product_id": pid, "business_id": bid})
            if not p:
                raise HTTPException(status_code=404, detail="Product not found")
            prods[pid] = p
        for pid, p in prods.items():
            new_stock = (p.get("stock_qty", 0) or 0) + old_map.get(pid, 0) - new_map.get(pid, 0)
            if not allow_negative and new_stock < 0:
                raise HTTPException(status_code=400, detail=f"Insufficient stock: {p['name']}")
        for pid, p in prods.items():
            delta = new_map.get(pid, 0) - old_map.get(pid, 0)
            if delta == 0:
                continue
            await db.products.update_one(
                {"product_id": pid},
                {"$inc": {"stock_qty": -delta, "quantity_sold": delta}, "$set": {"updated_at": now}},
            )
            await db.inventory_movements.insert_one({
                "movement_id": f"mov_{uuid.uuid4().hex[:12]}",
                "business_id": bid,
                "product_id": pid,
                "product_name": p["name"],
                "quantity": -delta,
                "movement_type": "ADJUSTMENT",
                "reference_id": sale_id,
                "reference_number": sale["sale_number"],
                "user_id": user["user_id"],
                "user_name": user.get("name", ""),
                "notes": f"sale edit {sale['sale_number']}",
                "created_at": now,
            })
        lines = []
        subtotal = 0.0
        total_discount = 0.0
        cogs = 0.0
        for it in data.items:
            p = prods[it.product_id]
            price = it.unit_price if it.unit_price is not None else (p.get("selling_price", 0) or 0)
            line_base = round(it.total, 2) if it.total is not None else round(price * it.quantity, 2)
            discount = min(it.discount, line_base)
            line_total = round(line_base - discount, 2)
            unit_cost = p.get("product_cost", 0) or 0
            line_cogs = round(unit_cost * it.quantity, 2)
            subtotal += line_base
            total_discount += discount
            cogs += line_cogs
            lines.append({
                "product_id": p["product_id"],
                "name": p["name"],
                "quantity": it.quantity,
                "unit_type": it.unit_type,
                "unit_price": price,
                "discount": round(discount, 2),
                "total": line_total,
                "unit_cost": unit_cost,
                "cogs": line_cogs,
            })
        total = round(subtotal - total_discount, 2)
        cogs = round(cogs, 2)
        updates.update({
            "items": lines,
            "subtotal": round(subtotal, 2),
            "discount_total": round(total_discount, 2),
            "total": total,
            "cogs": cogs,
            "profit": round(total - cogs, 2),
        })

    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    await db.sales.update_one({"sale_id": sale_id}, {"$set": updates})
    await log_audit(bid, user, "sale.updated", "sale", sale_id, f"{sale['sale_number']} · {', '.join(updates.keys())}")
    doc = await db.sales.find_one({"sale_id": sale_id}, {"_id": 0})
    await try_post(post_sale(bid, user, doc, replace=True))
    return sale_public(doc, caps_of(user))


@router.post("/{sale_id}/cancel")
async def cancel_sale(sale_id: str, user: dict = Depends(require_perm("sales.cancel"))):
    bid = user["business_id"]
    sale = await db.sales.find_one({"sale_id": sale_id, "business_id": bid})
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    if sale.get("status") == "cancelled":
        raise HTTPException(status_code=400, detail="Sale already cancelled")
    now = now_iso()
    allow_negative = (user.get("business") or {}).get("allow_negative_stock", False)
    for line in sale["items"]:
        p = await db.products.find_one({"product_id": line["product_id"], "business_id": bid})
        if not p:
            continue
        new_qty = max(0, (p.get("quantity_sold", 0) or 0) - line["quantity"])
        await db.products.update_one(
            {"product_id": p["product_id"]},
            {"$inc": {"stock_qty": line["quantity"]}, "$set": {"quantity_sold": new_qty, "updated_at": now}},
        )
        await db.inventory_movements.insert_one({
            "movement_id": f"mov_{uuid.uuid4().hex[:12]}",
            "business_id": bid,
            "product_id": p["product_id"],
            "product_name": p["name"],
            "quantity": line["quantity"],
            "movement_type": "ADJUSTMENT",
            "reference_id": sale_id,
            "reference_number": sale["sale_number"],
            "user_id": user["user_id"],
            "user_name": user.get("name", ""),
            "notes": f"Sale {sale['sale_number']} cancelled",
            "created_at": now,
        })
    await db.sales.update_one({"sale_id": sale_id}, {"$set": {"status": "cancelled", "cancelled_at": now, "cancelled_by": user["user_id"]}})
    await log_audit(bid, user, "sale.cancelled", "sale", sale_id, sale["sale_number"])
    await try_post(reverse_sale(bid, user, sale))
    return {"ok": True}
