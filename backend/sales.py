import uuid
import io
from collections import defaultdict
from decimal import Decimal
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from numeric_inputs import MAX_STOCK_QUANTITY, NonnegativeStockQuantity, NonnegativeMoney, bounded_stock, checked_money
from purchases import _stock_value, _valuation_fields
from core import atomic_posting, db, require_perm, log_audit, now_iso, next_number, caps_of, CURRENCIES, require_edit_pin
from ledger import post_sale, reverse_sale, try_post

router = APIRouter(prefix="/api/sales", tags=["sales"])

PAYMENT_METHODS = "^(cash|card|transfer|other|credit)$"


class SaleItem(BaseModel):
    product_id: str
    quantity: NonnegativeStockQuantity = Field(ge=1, le=MAX_STOCK_QUANTITY)
    unit_price: Optional[NonnegativeMoney] = None
    discount: NonnegativeMoney = 0
    unit_type: Optional[str] = Field(default=None, pattern="^(gram|kilogram|milliliter|piece)$")
    total: Optional[NonnegativeMoney] = None


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
    doc = {k: v for k, v in doc.items() if k not in ("_id", "business_id", "cost_allocations")}
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


def _cent(value):
    checked_money(value)
    return round(Decimal(str(value)), 2)


def _cost_through(layers, units):
    """Recorded cost of a prefix of the sold units, rounded once per partial layer."""
    cost = Decimal(0)
    for layer in layers:
        if units <= 0:
            break
        take = min(units, layer["quantity"])
        cost += _cent(Decimal(str(layer["value"])) * take / layer["original_quantity"])
        units -= take
    return cost


async def _apply_sale_lines(bid, user, items, original, now):
    """Retain the original units' posted cost; allocate only extra units at today's basis."""
    old = defaultdict(list)
    if original:
        if "cost_allocations" in original:
            for group in original["cost_allocations"]:
                old[group["product_id"]] = group["layers"]
        else:
            for line in original["items"]:
                cost = line.get("cogs")
                if cost is None:
                    cost = Decimal(str(line.get("unit_cost", 0))) * line["quantity"]
                old[line["product_id"]].append({"quantity": line["quantity"], "original_quantity": line["quantity"],
                                                "value": checked_money(_cent(cost))})
        historical = sum(_cost_through(group, sum(layer["quantity"] for layer in group)) for group in old.values())
        if historical != _cent(original.get("cogs", historical)):
            raise HTTPException(409, "Historical sale line costs require reconciliation")

    amounts = defaultdict(int)
    for item in items:
        amounts[item.product_id] = bounded_stock(amounts[item.product_id], item.quantity)
    products, layers, deltas = {}, {}, {}
    for pid in sorted(old.keys() | amounts.keys()):
        key = {"business_id": bid, "product_id": pid}
        product = await db.products.find_one(key)
        if not product:
            raise HTTPException(404, "Product not found")
        products[pid] = product
        prev = old[pid]
        previously_sold = sum(layer["quantity"] for layer in prev)
        sold = amounts[pid]
        delta = sold - previously_sold
        layers[pid] = list(prev)
        if not delta:
            continue
        stock = product.get("stock_qty") or 0
        remaining = bounded_stock(stock, -delta)
        if delta > 0 and remaining < 0 and not (user.get("business") or {}).get("allow_negative_stock"):
            raise HTTPException(400, f"Insufficient stock: {product['name']}")
        value = await _stock_value(bid, product)
        if delta > 0:
            available = max(Decimal(0), Decimal(str(stock)))
            consumed = min(Decimal(delta), available)
            # Exhausting physical stock assigns its entire remaining carrying value.
            extra_cost = value * consumed / available if available else Decimal(0)
            extra_cost += (delta - consumed) * Decimal(str(product.get("product_cost") or 0))
            issued = _cent(extra_cost)
            layers[pid].append({"quantity": delta, "original_quantity": delta, "value": checked_money(issued)})
        else:
            issued = _cost_through(prev, sold) - _cost_through(prev, previously_sold)
            retained = sold
            layers[pid] = []
            for layer in prev:
                if not retained:
                    break
                qty = min(retained, layer["quantity"])
                layers[pid].append({**layer, "quantity": qty})
                retained -= qty
        fields = _valuation_fields(product, remaining, value - issued, now)
        await db.products.update_one(key, {"$set": {
            **fields, "stock_qty": remaining,
            "quantity_sold": max(0, bounded_stock(product.get("quantity_sold") or 0, delta)),
        }})
        deltas[pid] = bounded_stock(0, -delta)

    positions = defaultdict(int)
    lines = []
    subtotal = discount_total = total_cost = Decimal(0)
    for item in items:
        pid = item.product_id
        product = products[pid]
        start = positions[pid]
        end = start + item.quantity
        cost = _cost_through(layers[pid], end) - _cost_through(layers[pid], start)
        positions[pid] = end
        price = checked_money(item.unit_price if item.unit_price is not None else (product.get("selling_price") or 0))
        base = _cent(item.total if item.total is not None else Decimal(str(price)) * item.quantity)
        discount = min(_cent(item.discount), base)
        lines.append({
            "product_id": pid, "name": product["name"], "quantity": item.quantity,
            "unit_type": item.unit_type, "unit_price": price, "discount": checked_money(discount),
            "total": checked_money(base - discount), "unit_cost": checked_money(cost / item.quantity),
            "cogs": checked_money(cost),
        })
        subtotal += base
        discount_total += discount
        total_cost += cost
    total = subtotal - discount_total
    return ({
        "cost_allocations": [{"product_id": pid, "layers": group} for pid, group in layers.items() if group],
        "items": lines, "subtotal": checked_money(subtotal), "discount_total": checked_money(discount_total),
        "total": checked_money(total), "cogs": checked_money(total_cost), "profit": checked_money(total - total_cost),
    }, products, deltas)


@atomic_posting
async def create_sale_record(bid: str, user: dict, data: SaleInput, *, import_ref: Optional[str] = None,
                             sale_date: Optional[str] = None) -> dict:
    """Core sale creation — used by the API endpoint and the bulk importer.
    Stock, weighted-average cost, inventory movements and GL posting all happen here."""
    if data.currency and data.currency not in CURRENCIES:
        raise HTTPException(status_code=400, detail="Invalid currency")
    currency = data.currency or (user.get("business") or {}).get("base_currency", "USD")

    if data.client_ref:
        existing = await db.sales.find_one({"business_id": bid, "client_ref": data.client_ref})
        if existing:
            return existing
    sid = f"sal_{uuid.uuid4().hex[:12]}"
    number = await next_number(bid, "sale")
    now = now_iso()
    totals, products, _ = await _apply_sale_lines(bid, user, data.items, None, now)

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
        **totals,
        "status": "confirmed",
        "import_ref": import_ref,
        "created_by": user["user_id"],
        "created_by_name": user.get("name", ""),
        "created_at": now,
    }
    await db.sales.insert_one(doc)

    for it in data.items:
        p = products[it.product_id]
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

    await log_audit(bid, user, "sale.created", "sale", sid, f"{number} · {totals['total']}")
    await try_post(post_sale(bid, user, doc))
    doc.pop("_id", None)
    return doc


@router.put("/{sale_id}")
@atomic_posting
async def update_sale(sale_id: str, data: SaleUpdate, user: dict = Depends(require_perm("sales.edit"))):
    bid = user["business_id"]
    require_edit_pin(user, data.pin)
    sale = await db.sales.find_one({"sale_id": sale_id, "business_id": bid})
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    if sale.get("status") != "confirmed":
        raise HTTPException(status_code=400, detail="Only confirmed sales can be edited")
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
        if await db.returns.find_one({"business_id": bid, "sale_id": sale_id, "status": {"$ne": "cancelled"}}):
            raise HTTPException(409, "Reverse linked returns before changing sale lines")
        if len(data.items) < 1:
            raise HTTPException(status_code=400, detail="At least one item is required")
        totals, prods, deltas = await _apply_sale_lines(bid, user, data.items, sale, now)
        updates.update(totals)
        for pid, delta in deltas.items():
            p = prods[pid]
            await db.inventory_movements.insert_one({
                "movement_id": f"mov_{uuid.uuid4().hex[:12]}",
                "business_id": bid,
                "product_id": pid,
                "product_name": p["name"],
                "quantity": delta,
                "movement_type": "ADJUSTMENT",
                "reference_id": sale_id,
                "reference_number": sale["sale_number"],
                "user_id": user["user_id"],
                "user_name": user.get("name", ""),
                "notes": f"sale edit {sale['sale_number']}",
                "created_at": now,
            })

    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    await db.sales.update_one({"business_id": bid, "sale_id": sale_id}, {"$set": updates})
    await log_audit(bid, user, "sale.updated", "sale", sale_id, f"{sale['sale_number']} · {', '.join(updates.keys())}")
    doc = await db.sales.find_one({"business_id": bid, "sale_id": sale_id}, {"_id": 0})
    await try_post(post_sale(bid, user, doc, replace=True))
    return sale_public(doc, caps_of(user))


@router.post("/{sale_id}/cancel")
@atomic_posting
async def cancel_sale(sale_id: str, user: dict = Depends(require_perm("sales.cancel"))):
    bid = user["business_id"]
    sale = await db.sales.find_one({"sale_id": sale_id, "business_id": bid})
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    if await db.returns.find_one({"business_id": bid, "sale_id": sale_id, "status": {"$ne": "cancelled"}}):
        raise HTTPException(409, "Reverse linked returns before cancelling the sale")
    if sale.get("status") == "cancelled":
        raise HTTPException(status_code=400, detail="Sale already cancelled")
    now = now_iso()
    _, products, _ = await _apply_sale_lines(bid, user, [], sale, now)
    for line in sale["items"]:
        p = products[line["product_id"]]
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
    await db.sales.update_one({"business_id": bid, "sale_id": sale_id}, {"$set": {"status": "cancelled", "cancelled_at": now, "cancelled_by": user["user_id"]}})
    await log_audit(bid, user, "sale.cancelled", "sale", sale_id, sale["sale_number"])
    await try_post(reverse_sale(bid, user, sale))
    return {"ok": True}
