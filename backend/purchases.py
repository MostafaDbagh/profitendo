import uuid
from collections import defaultdict
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from numeric_inputs import MAX_STOCK_QUANTITY, NonnegativeStockQuantity, NonnegativeMoney, bounded_stock, checked_money
from core import atomic_posting, db, require_perm, log_audit, now_iso, next_number, require_edit_pin
from ledger import post_purchase, reverse_purchase, try_post

router = APIRouter(prefix="/api/purchases", tags=["purchases"])

PAYMENT_METHODS = "^(cash|card|transfer|other|credit)$"


class PurchaseItem(BaseModel):
    product_id: str
    quantity: NonnegativeStockQuantity = Field(ge=1, le=MAX_STOCK_QUANTITY)
    unit_cost: NonnegativeMoney


class PurchaseInput(BaseModel):
    supplier: str = Field(min_length=1, max_length=120)
    invoice_number: Optional[str] = ""
    purchase_date: Optional[str] = None
    notes: Optional[str] = ""
    additional_costs: NonnegativeMoney = 0
    payment_method: str = Field(default="cash", pattern=PAYMENT_METHODS)
    client_ref: Optional[str] = Field(default=None, max_length=64)
    items: List[PurchaseItem] = Field(min_length=1)


class PurchaseUpdate(BaseModel):
    supplier: Optional[str] = Field(default=None, min_length=1, max_length=120)
    invoice_number: Optional[str] = None
    purchase_date: Optional[str] = None
    notes: Optional[str] = None
    additional_costs: Optional[NonnegativeMoney] = None
    payment_method: Optional[str] = Field(default=None, pattern=PAYMENT_METHODS)
    items: Optional[List[PurchaseItem]] = None
    pin: Optional[str] = None


@router.get("")
async def list_purchases(user: dict = Depends(require_perm("purchases.view"))):
    docs = await db.purchases.find({"business_id": user["business_id"]}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return docs


async def _fetch_products(bid: str, product_ids) -> dict:
    ids = list(dict.fromkeys(product_ids))
    prods = {}
    async for p in db.products.find({"product_id": {"$in": ids}, "business_id": bid}):
        prods[p["product_id"]] = p
    for pid in ids:
        if pid not in prods:
            raise HTTPException(status_code=404, detail="Product not found")
    return prods


def _build_lines(items, prods: dict):
    lines = []
    subtotal = Decimal(0)
    for it in items:
        p = prods[it.product_id]
        line_total = round(checked_money(_amount(it.quantity) * _amount(it.unit_cost)), 2)
        subtotal += _amount(line_total)
        lines.append({
            "product_id": p["product_id"],
            "name": p["name"],
            "quantity": it.quantity,
            "unit_cost": it.unit_cost,
            "total": line_total,
        })
    return lines, checked_money(subtotal)


async def _record_movement(bid: str, user: dict, p: dict, qty: float, mtype: str, ref_id: str, ref_number: str, notes: str, now: str):
    await db.inventory_movements.insert_one({
        "movement_id": f"mov_{uuid.uuid4().hex[:12]}",
        "business_id": bid,
        "product_id": p["product_id"],
        "product_name": p["name"],
        "quantity": bounded_stock(0, qty),
        "movement_type": mtype,
        "reference_id": ref_id,
        "reference_number": ref_number,
        "user_id": user["user_id"],
        "user_name": user.get("name", ""),
        "notes": notes,
        "created_at": now,
    })


def _amount(value):
    return Decimal(str(value))


def _line_value(line, field):
    if field and field in line:
        return _amount(line[field])
    if "unit_cost" not in line:
        raise HTTPException(409, "Historical transaction has no recorded cost")
    extended = _amount(line["quantity"]) * _amount(line["unit_cost"])
    return round(extended, 2) if field else extended


def _aggregate_lines(lines):
    quantities, values = defaultdict(int), defaultdict(Decimal)
    for line in lines:
        pid = line["product_id"]
        quantities[pid] = bounded_stock(quantities[pid], line["quantity"])
        # The receipt's journal debits its rounded line amounts.
        values[pid] += _line_value(line, "total")
    return quantities, values


async def _historical_value(bid, pid, stock):
    """Reconcile pre-snapshot stock with priced source documents and their movements."""
    key = {"business_id": bid, "product_id": pid}
    movements = defaultdict(Decimal)
    adjusted_quantity = Decimal(0)
    total = Decimal(0)
    async for row in db.inventory_movements.find(key, {"reference_id": 1, "quantity": 1, "carrying_value_delta": 1}):
        if not row.get("reference_id"):
            if "carrying_value_delta" not in row:
                # Older manual adjustments did not record their valuation.
                return None
            total += _amount(row["carrying_value_delta"])
            adjusted_quantity += _amount(row["quantity"])
            continue
        movements[row["reference_id"]] += _amount(row["quantity"])
    if sum(movements.values()) + adjusted_quantity != stock:
        return None

    sources = (
        (db.purchases, "purchase_id", "total", 1),
        (db.sales, "sale_id", "cogs", -1),
        (db.purchase_returns, "return_id", "total", -1),
        (db.returns, "return_id", None, 1),
    )
    for collection, identifier, price_field, sign in sources:
        query = {"business_id": bid, "items.product_id": pid, "status": "confirmed"}
        if not price_field:
            query["restock"] = {"$ne": False}
        async for doc in collection.find(query, {identifier: 1, "items": 1}):
            quantity = Decimal(0)
            for line in doc["items"]:
                if line["product_id"] != pid:
                    continue
                units = _amount(line["quantity"])
                field = price_field or ("cogs" if "cogs" in line else None)
                total += sign * _line_value(line, field)
                quantity += sign * units
            if movements.pop(doc[identifier], 0) != quantity:
                return None
    return None if any(movements.values()) else total


def _matching_basis(product, stock, cost):
    basis = product.get("purchase_valuation")
    if basis and _amount(basis["quantity"]) == stock and _amount(basis["unit_cost"]) == cost:
        return basis


def reported_stock_value(product):
    """Read the stored carrying amount independently of the nonnegative selling-cost basis."""
    stock = _amount(product.get("stock_qty") or 0)
    cost = _amount(product.get("product_cost") or 0)
    basis = _matching_basis(product, stock, cost)
    value = _amount(basis["value"]) if basis else stock * cost
    return round(checked_money(value), 2)


async def _stock_value(bid, product, *, reversing=False):
    stock = _amount(product.get("stock_qty") or 0)
    cost = _amount(product.get("product_cost") or 0)
    basis = _matching_basis(product, stock, cost)
    if basis:
        if basis["at"] == product.get("updated_at"):
            return _amount(basis["value"])
        # A rename, SKU change or other catalogue edit updates the timestamp as
        # well. Only a subsequent stock event can invalidate a matching basis.
        later_movement = await db.inventory_movements.find_one({
            "business_id": bid, "product_id": product["product_id"], "created_at": {"$gt": basis["at"]},
        }, {"_id": 1})
        if not later_movement:
            return _amount(basis["value"])
    # Imported opening balances have no priced movements. Once purchases have
    # posted, their four-place legacy average may no longer encode the balance.
    if await db.purchases.find_one({"business_id": bid, "items.product_id": product["product_id"]}, {"_id": 1}):
        value = await _historical_value(bid, product["product_id"], stock)
        if value is not None:
            return value
        if reversing:
            # Determine whether the pre-snapshot average identifies exactly
            # one possible cent value. Never guess between plausible amounts.
            estimate = stock * cost
            error = abs(stock) * Decimal("0.00005")
            lower = (estimate - error).quantize(Decimal("0.01"), rounding=ROUND_CEILING)
            upper = (estimate + error).quantize(Decimal("0.01"), rounding=ROUND_FLOOR)
            if lower == upper:
                return lower
            raise HTTPException(409, "Historical inventory value requires reconciliation before reversing this receipt")
    return stock * cost


def _valuation_fields(product, quantity, value, now):
    checked_money(value)
    if quantity == 0 and abs(value) >= Decimal("0.005"):
        raise HTTPException(409, "Cancellation would leave inventory value without stock")
    if quantity > 0 and value <= Decimal("-0.005"):
        raise HTTPException(409, "Purchase would leave negative inventory value")
    average = product.get("product_cost", 0) or 0
    if quantity:
        ratio = value / _amount(quantity)
        if ratio >= 0:
            average = checked_money(ratio)
        # When backorders carry a positive total value, no nonnegative average
        # can express it. Keep the previous unit cost for further movements and
        # report the actual carrying amount from the snapshot.
    else:
        value = Decimal(0)
    return {"product_cost": average, "updated_at": now, "purchase_valuation": {
        "quantity": quantity, "value": str(value), "unit_cost": average, "at": now,
    }}


async def _apply_item_edit(bid: str, purchase: dict, items: list, user: dict, allow_negative: bool, now: str):
    if len(items) < 1:
        raise HTTPException(status_code=400, detail="At least one item is required")
    old_qty, old_val = _aggregate_lines(purchase["items"])
    prods = await _fetch_products(bid, set(old_qty) | {it.product_id for it in items})
    lines, subtotal = _build_lines(items, prods)
    new_qty, new_val = _aggregate_lines(lines)
    for pid, product in prods.items():
        delta = new_qty[pid] - old_qty[pid]
        final_qty = bounded_stock(product.get("stock_qty") or 0, delta)
        if not allow_negative and final_qty < 0:
            raise HTTPException(status_code=400, detail=f"Insufficient stock: {product['name']}")
        balance = await _stock_value(bid, product, reversing=bool(old_qty[pid]))
        fields = _valuation_fields(product, final_qty, balance + new_val[pid] - old_val[pid], now)
        await db.products.update_one({"business_id": bid, "product_id": pid},
                                     {"$set": {**fields, "stock_qty": final_qty}})
        if delta:
            await _record_movement(bid, user, product, delta, "ADJUSTMENT", purchase["purchase_id"],
                                   purchase["purchase_number"], f"purchase edit {purchase['purchase_number']}", now)
    return lines, subtotal


@router.post("", status_code=201)
async def create_purchase_route(data: PurchaseInput, user: dict = Depends(require_perm("purchases.create"))):
    doc = await create_purchase(data, user)
    doc.pop("_id", None)
    return doc


@atomic_posting
async def create_purchase(data: PurchaseInput, user: dict) -> dict:
    """Core purchase creation — used by the API endpoint and the bulk importer."""
    bid = user["business_id"]
    if data.client_ref:
        existing = await db.purchases.find_one({"business_id": bid, "client_ref": data.client_ref}, {"_id": 0})
        if existing:
            return existing
    prods = await _fetch_products(bid, [it.product_id for it in data.items])

    pid = f"pur_{uuid.uuid4().hex[:12]}"
    number = await next_number(bid, "purchase")
    now = now_iso()
    lines, subtotal = _build_lines(data.items, prods)
    total = round(checked_money(_amount(subtotal) + _amount(data.additional_costs)), 2)

    doc = {
        "purchase_id": pid,
        "client_ref": data.client_ref,
        "business_id": bid,
        "purchase_number": number,
        "supplier": data.supplier.strip(),
        "invoice_number": (data.invoice_number or "").strip(),
        "purchase_date": data.purchase_date or now[:10],
        "notes": data.notes or "",
        "payment_method": data.payment_method,
        "items": lines,
        "subtotal": subtotal,
        "additional_costs": data.additional_costs,
        "total": total,
        "status": "confirmed",
        "created_by": user["user_id"],
        "created_by_name": user.get("name", ""),
        "created_at": now,
    }
    quantities, values = _aggregate_lines(lines)
    for product_id, quantity in quantities.items():
        product = prods[product_id]
        stock = bounded_stock(product.get("stock_qty") or 0, quantity)
        value = await _stock_value(bid, product)
        fields = _valuation_fields(product, stock, value + values[product_id], now)
        await db.products.update_one({"business_id": bid, "product_id": product_id},
                                     {"$set": {**fields, "stock_qty": stock}})
    await db.purchases.insert_one(doc)
    for it in data.items:
        await _record_movement(bid, user, prods[it.product_id], it.quantity, "PURCHASE", pid, number, data.notes or "", now)

    await log_audit(bid, user, "purchase.created", "purchase", pid, f"{number} · {doc['supplier']} · {total}")
    await try_post(post_purchase(bid, user, doc))
    doc.pop("_id", None)
    return doc


@router.put("/{purchase_id}")
@atomic_posting
async def update_purchase(purchase_id: str, data: PurchaseUpdate, user: dict = Depends(require_perm("purchases.edit"))):
    bid = user["business_id"]
    require_edit_pin(user, data.pin)
    purchase = await db.purchases.find_one({"purchase_id": purchase_id, "business_id": bid})
    if not purchase:
        raise HTTPException(status_code=404, detail="Purchase not found")
    if purchase.get("status") != "confirmed":
        raise HTTPException(status_code=400, detail="Only confirmed purchases can be edited")
    allow_negative = (user.get("business") or {}).get("allow_negative_stock", False)
    now = now_iso()
    updates = {k: v for k, v in data.model_dump().items() if v is not None and k in ("supplier", "invoice_number", "purchase_date", "notes", "additional_costs", "payment_method")}
    if "supplier" in updates:
        updates["supplier"] = updates["supplier"].strip()

    if data.items is not None:
        if await db.purchase_returns.find_one(
            {"business_id": bid, "purchase_id": purchase_id, "status": "confirmed"}, {"_id": 1}
        ):
            raise HTTPException(409, "Reverse supplier returns before changing purchase lines")
        lines, subtotal = await _apply_item_edit(bid, purchase, data.items, user, allow_negative, now)
        updates["items"] = lines
        updates["subtotal"] = subtotal

    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    subtotal = updates.get("subtotal", purchase["subtotal"])
    additional = updates.get("additional_costs", purchase.get("additional_costs", 0))
    updates["total"] = round(checked_money(_amount(subtotal) + _amount(additional)), 2)
    await db.purchases.update_one({"business_id": bid, "purchase_id": purchase_id}, {"$set": updates})
    await log_audit(bid, user, "purchase.updated", "purchase", purchase_id, f"{purchase['purchase_number']} · {', '.join(updates.keys())}")
    doc = await db.purchases.find_one({"business_id": bid, "purchase_id": purchase_id}, {"_id": 0})
    await try_post(post_purchase(bid, user, doc, replace=True))
    return doc


@router.post("/{purchase_id}/cancel")
@atomic_posting
async def cancel_purchase(purchase_id: str, user: dict = Depends(require_perm("purchases.cancel"))):
    bid = user["business_id"]
    purchase = await db.purchases.find_one({"purchase_id": purchase_id, "business_id": bid})
    if not purchase:
        raise HTTPException(status_code=404, detail="Purchase not found")
    if purchase.get("status") == "cancelled":
        raise HTTPException(status_code=400, detail="Purchase already cancelled")
    allow_negative = (user.get("business") or {}).get("allow_negative_stock", False)
    now = now_iso()
    if any(line.get("returned_qty", 0) for line in purchase["items"]) or await db.purchase_returns.find_one(
        {"business_id": bid, "purchase_id": purchase_id, "status": "confirmed"}, {"_id": 1}
    ):
        raise HTTPException(status_code=409, detail="Reverse supplier returns before cancelling this purchase")
    quantities, costs = _aggregate_lines(purchase["items"])
    products = await _fetch_products(bid, quantities)
    for pid, quantity in quantities.items():
        product = products[pid]
        stock = product.get("stock_qty", 0) or 0
        remaining = bounded_stock(stock, -quantity)
        if remaining < 0 and not allow_negative:
            raise HTTPException(status_code=400, detail=f"Cancelling would make stock negative for {product['name']}")
        value = await _stock_value(bid, product, reversing=True)
        fields = _valuation_fields(product, remaining, value - costs[pid], now)
        await db.products.update_one(
            {"business_id": bid, "product_id": pid},
            {"$set": {**fields, "stock_qty": remaining}},
        )
        await _record_movement(bid, user, product, -quantity, "ADJUSTMENT", purchase_id,
                               purchase["purchase_number"], f"Purchase {purchase['purchase_number']} cancelled", now)
    await db.purchases.update_one({"business_id": bid, "purchase_id": purchase_id}, {"$set": {"status": "cancelled", "cancelled_at": now, "cancelled_by": user["user_id"]}})
    await log_audit(bid, user, "purchase.cancelled", "purchase", purchase_id, purchase["purchase_number"])
    await try_post(reverse_purchase(bid, user, purchase))
    return {"ok": True}
