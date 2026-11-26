import uuid
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP, localcontext
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from numeric_inputs import MAX_STOCK_QUANTITY, NonnegativeStockQuantity, NonnegativeMoney, bounded_stock, checked_money
from purchases import _stock_value, _valuation_fields
from core import atomic_posting, db, require_perm, log_audit, now_iso, next_number, can_finance, require_edit_pin
from ledger import post_return, reverse_return, try_post

router = APIRouter(prefix="/api/returns", tags=["returns"])

REASONS = "^(changed_mind|damaged|wrong_product|defect|other)$"


class ReturnItem(BaseModel):
    product_id: str
    quantity: NonnegativeStockQuantity = Field(ge=1, le=MAX_STOCK_QUANTITY)
    unit_price: Optional[NonnegativeMoney] = None


class ReturnInput(BaseModel):
    sale_id: Optional[str] = None
    reason: str = Field(pattern=REASONS)
    notes: Optional[str] = ""
    restock: bool = True
    refund_method: str = Field(default="cash", pattern="^(cash|card|transfer|other)$")
    client_ref: Optional[str] = Field(default=None, max_length=64)
    items: List[ReturnItem] = Field(min_length=1)


class ReturnUpdate(BaseModel):
    reason: Optional[str] = Field(default=None, pattern=REASONS)
    notes: Optional[str] = None
    refund_method: Optional[str] = Field(default=None, pattern="^(cash|card|transfer|other)$")
    restock: Optional[bool] = None
    items: Optional[List[ReturnItem]] = None
    pin: Optional[str] = None


def return_public(doc: dict, include_financials: bool) -> dict:
    doc = {k: v for k, v in doc.items() if k not in ("_id", "business_id")}
    doc["items"] = [{k: v for k, v in line.items() if k != "sale_ranges"} for line in doc.get("items", [])]
    if not include_financials:
        doc.pop("cogs_reversed", None)
        for item in doc["items"]:
            item.pop("unit_cost", None)
            item.pop("cogs", None)
    return doc


@router.get("")
async def list_returns(user: dict = Depends(require_perm("returns.view"))):
    fin = can_finance(user)
    docs = await db.returns.find({"business_id": user["business_id"]}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    return [return_public(d, fin) for d in docs]


def cents(value):
    checked_money(value)
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _posted_line_costs(document):
    """Distribute a legacy document's recorded COGS across its original rows."""
    lines = document.get("items", [])
    if all("cogs" in line for line in lines):
        return [cents(line["cogs"]) for line in lines]
    costs = []
    extended, allocated = Decimal(0), Decimal(0)
    for index, line in enumerate(lines):
        extended += Decimal(str(line.get("unit_cost", 0))) * line["quantity"]
        cumulative = cents(extended)
        if index == len(lines) - 1:
            cumulative = cents(document.get("cogs_reversed", cumulative))
        costs.append(cumulative - allocated)
        allocated = cumulative
    return costs


def _remaining_ranges(size, occupied):
    """Half-open unit offsets within one SKU, in original sale-line order."""
    position = 0
    available = []
    for start, end in sorted(occupied, key=lambda span: span[0]):
        if not (position <= start < end <= size):
            raise HTTPException(409, "Historical refund allocations conflict with the sale")
        if position < start:
            available.append((position, start))
        position = end
    if position < size:
        available.append((position, size))
    return available


def _take_ranges(size, occupied, preferred, qty):
    selected = []
    # An edit keeps its existing units first, even if an earlier return was cancelled.
    for start, end in preferred:
        for lo, hi in _remaining_ranges(size, occupied + selected):
            begin = max(lo, start)
            take = min(min(hi, end) - begin, qty)
            if take > 0:
                selected.append((begin, begin + take))
                qty -= take
            if not qty:
                return selected
    for start, end in _remaining_ranges(size, occupied + selected):
        take = min(qty, end - start)
        selected.append((start, start + take))
        qty -= take
        if not qty:
            return selected
    raise HTTPException(400, "Return exceeds remaining sold quantity")


async def _allocations(scope, exclude_return):
    projection = {"items": 1, "return_id": 1, "created_at": 1, "cogs_reversed": 1}
    active = await db.returns.find({**scope, "status": {"$ne": "cancelled"}}, projection).to_list(None)
    if any("sale_ranges" not in line for ret in active for line in ret["items"]):
        # Older postings consumed the number of units already returned at posting time.
        # Include subsequent cancellations in the timeline so a surviving return keeps
        # its original price and fractional-cent position.
        events = []
        for ret in active:
            events.append((ret.get("created_at", ""), str(ret["_id"]), 1, ret))
        async for ret in db.returns.find({**scope, "status": "cancelled"},
                                         {**projection, "cancelled_at": 1}):
            if ret.get("cancelled_at"):
                events.append((ret.get("created_at", ""), str(ret["_id"]), 1, ret))
                events.append((ret["cancelled_at"], str(ret["_id"]), -1, ret))
        counts = defaultdict(int)
        for _, _, change, ret in sorted(events, key=lambda e: e[:3]):
            for line in ret["items"]:
                pid, qty = line["product_id"], line["quantity"]
                if change == 1 and "sale_ranges" not in line:
                    line["sale_ranges"] = [(counts[pid], counts[pid] + qty)]
                counts[pid] += change * qty

    occupied, preferred = defaultdict(list), defaultdict(list)
    used_value, used_cost = defaultdict(Decimal), defaultdict(Decimal)
    for ret in active:
        for line, cost in zip(ret["items"], _posted_line_costs(ret)):
            pid = line["product_id"]
            if ret["return_id"] == exclude_return:
                preferred[pid].extend(line["sale_ranges"])
            else:
                occupied[pid].extend(line["sale_ranges"])
                used_value[pid] += cents(line["total"])
                used_cost[pid] += cost
    return occupied, preferred, used_value, used_cost


def _range_value(source, selected):
    amount, cost = Decimal(0), Decimal(0)
    offset = 0
    for line in source:
        size = line["quantity"]
        net = cents(line["total"] if "total" in line else
                    Decimal(str(line["unit_price"])) * size - Decimal(str(line.get("discount", 0))))
        sold_cost = cents(line["cogs"] if "cogs" in line else Decimal(str(line.get("unit_cost", 0))) * size)
        # Enough precision for a cent amount multiplied by a signed 64-bit quantity.
        with localcontext() as context:
            context.prec = 60
            for start, end in selected:
                lo, hi = max(0, start - offset), min(size, end - offset)
                if lo < hi:
                    amount += cents(net * hi / size) - cents(net * lo / size)
                    cost += cents(sold_cost * hi / size) - cents(sold_cost * lo / size)
        offset += size
    return amount, cost


async def refund_lines(bid, items, sale_id, *, exclude_return=None, posting=False):
    sold = defaultdict(list)
    sale = None
    if sale_id:
        scope = {"business_id": bid, "sale_id": sale_id}
        # Serialize posted refunds even when neither operation restocks inventory.
        if posting:
            sale = await db.sales.find_one_and_update(scope, {"$inc": {"return_revision": 1}})
        else:
            sale = await db.sales.find_one(scope)
        if not sale:
            raise HTTPException(404, "Original sale not found")
        if sale.get("status") != "confirmed":
            raise HTTPException(409, "Only confirmed sales can be returned")
        for line in sale["items"]:
            sold[line["product_id"]].append(line)
        occupied, preferred, used_value, used_cost = await _allocations(scope, exclude_return)
        refunded = sum(used_value.values(), Decimal(0))

    lines = []
    for item in items:
        pid, qty = item.product_id, item.quantity
        product = await db.products.find_one({"business_id": bid, "product_id": pid})
        if not product:
            raise HTTPException(404, "Product not found")
        line = {"product_id": pid, "name": product["name"], "quantity": qty}
        if sale:
            source = sold[pid]
            size = sum(original["quantity"] for original in source)
            selected = _take_ranges(size, occupied[pid], preferred[pid], qty)
            amount, cost = _range_value(source, selected)
            paid, sold_cost = _range_value(source, [(0, size)])
            remaining_cost = max(Decimal(0), sold_cost - used_cost[pid])
            if sum(end - start for start, end in occupied[pid]) + qty == size:
                cost = remaining_cost
            else:
                cost = min(cost, remaining_cost)
            # Older invoices may round their document total separately from the lines.
            document_room = cents(sale["total"]) - refunded
            amount = max(Decimal(0), min(amount, paid - used_value[pid], document_room))
            if item.unit_price is not None:
                requested = cents(Decimal(str(item.unit_price)) * qty)
                if requested > amount:
                    raise HTTPException(400, "Refund exceeds original net price")
                amount = requested
            unit_cost, price = float(cost / qty), float(amount / qty)
            occupied[pid].extend(selected)
            used_value[pid] += amount
            used_cost[pid] += cost
            refunded += amount
            line["sale_ranges"] = selected
        else:
            price = item.unit_price if item.unit_price is not None else product.get("selling_price", 0) or 0
            amount = cents(Decimal(str(price)) * qty)
            unit_cost = product.get("product_cost", 0) or 0
            cost = cents(Decimal(str(unit_cost)) * qty)
        line.update(unit_price=checked_money(price), total=checked_money(amount),
                    unit_cost=checked_money(unit_cost), cogs=checked_money(cost))
        lines.append(line)
    return sale, lines


def _return_totals(lines):
    refund = checked_money(sum(cents(line["total"]) for line in lines))
    cost = checked_money(sum(cents(line["cogs"]) for line in lines))
    return refund, cost


class RefundPreview(BaseModel):
    sale_id: str
    items: List[ReturnItem] = Field(min_length=1)
    return_id: Optional[str] = None


async def preview_total(data, user):
    _, lines = await refund_lines(user["business_id"], data.items, data.sale_id, exclude_return=data.return_id)
    total, _ = _return_totals(lines)
    return {"total": total}


@router.post("/preview")
async def preview_new(data: RefundPreview, user: dict = Depends(require_perm("returns.create"))):
    return await preview_total(data.model_copy(update={"return_id": None}), user)


@router.post("/{return_id}/preview")
async def preview_edit(return_id: str, data: RefundPreview, user: dict = Depends(require_perm("returns.edit"))):
    scope = {"return_id": return_id, "sale_id": data.sale_id, "business_id": user["business_id"]}
    if not await db.returns.find_one(scope):
        raise HTTPException(404, "Return not found")
    return await preview_total(data.model_copy(update={"return_id": return_id}), user)


async def _apply_return_stock(bid, user, previous, current, now):
    quantity_delta, sold_delta, value_delta = defaultdict(int), defaultdict(int), defaultdict(Decimal)
    for document, direction in ((previous, -1), (current, 1)):
        if document is None:
            continue
        for line, cost in zip(document["items"], _posted_line_costs(document)):
            pid = line["product_id"]
            sold_delta[pid] -= direction * line["quantity"]
            if document.get("restock", True):
                quantity_delta[pid] += direction * line["quantity"]
                value_delta[pid] += direction * cost

    names = {}
    allow_negative = (user.get("business") or {}).get("allow_negative_stock", False)
    for pid, sold_change in sold_delta.items():
        key = {"business_id": bid, "product_id": pid}
        product = await db.products.find_one(key)
        if not product:
            raise HTTPException(409, "Cannot change inventory for a missing return product")
        names[pid] = product["name"]
        fields = {"quantity_sold": max(0, bounded_stock(product.get("quantity_sold") or 0, sold_change)),
                  "updated_at": now}
        delta = quantity_delta[pid]
        if delta or value_delta[pid]:
            stock = bounded_stock(product.get("stock_qty") or 0, delta)
            if delta < 0 and stock < 0 and not allow_negative:
                raise HTTPException(400, f"Insufficient stock: {product['name']}")
            carrying = await _stock_value(bid, product, reversing=delta < 0 or value_delta[pid] < 0)
            new_value = carrying + value_delta[pid]
            fields.update(_valuation_fields(product, stock, new_value, now), stock_qty=stock)
        await db.products.update_one(key, {"$set": fields})

    doc = current or previous
    if previous is None:
        movements = [(line["product_id"], line["quantity"]) for line in current["items"]] if current["restock"] else []
        movement_type, notes = "RETURN", f"{doc['reason']} · {doc.get('notes', '')}".strip(" ·")
    elif current is None:
        movements = [(line["product_id"], -line["quantity"]) for line in previous["items"]] if previous.get("restock", True) else []
        movement_type, notes = "ADJUSTMENT", f"Return {doc['return_number']} cancelled"
    else:
        movements = quantity_delta.items()
        movement_type, notes = "ADJUSTMENT", f"return edit {doc['return_number']}"
    for pid, delta in movements:
        if delta:
            await db.inventory_movements.insert_one({
                "movement_id": f"mov_{uuid.uuid4().hex[:12]}", "business_id": bid,
                "product_id": pid, "product_name": names[pid], "quantity": delta,
                "movement_type": movement_type, "reference_id": doc["return_id"],
                "reference_number": doc["return_number"], "user_id": user["user_id"],
                "user_name": user.get("name", ""), "notes": notes, "created_at": now,
            })


@router.post("", status_code=201)
@atomic_posting
async def create_return(data: ReturnInput, user: dict = Depends(require_perm("returns.create"))):
    bid = user["business_id"]
    if data.client_ref:
        existing = await db.returns.find_one({"business_id": bid, "client_ref": data.client_ref})
        if existing:
            return return_public(existing, can_finance(user))
    sale, lines = await refund_lines(bid, data.items, data.sale_id, posting=True)
    now = now_iso()
    rid = f"ret_{uuid.uuid4().hex[:12]}"
    number = await next_number(bid, "return")
    refund_total, cogs_reversed = _return_totals(lines)

    doc = {
        "return_id": rid,
        "client_ref": data.client_ref,
        "business_id": bid,
        "return_number": number,
        "sale_id": sale["sale_id"] if sale else None,
        "sale_number": sale["sale_number"] if sale else None,
        "reason": data.reason,
        "notes": data.notes or "",
        "restock": data.restock,
        "refund_method": data.refund_method,
        "items": lines,
        "refund_total": round(refund_total, 2),
        "cogs_reversed": round(cogs_reversed, 2),
        "return_date": now,
        "status": "confirmed",
        "created_by": user["user_id"],
        "created_by_name": user.get("name", ""),
        "created_at": now,
    }
    await _apply_return_stock(bid, user, None, doc, now)
    await db.returns.insert_one(doc)

    await log_audit(bid, user, "return.created", "return", rid, f"{number} · {round(refund_total, 2)}")
    await try_post(post_return(bid, user, doc))
    doc.pop("_id", None)
    return return_public(doc, can_finance(user))


@router.put("/{return_id}")
@atomic_posting
async def update_return(return_id: str, data: ReturnUpdate, user: dict = Depends(require_perm("returns.edit"))):
    bid = user["business_id"]
    require_edit_pin(user, data.pin)
    ret = await db.returns.find_one({"return_id": return_id, "business_id": bid})
    if not ret:
        raise HTTPException(status_code=404, detail="Return not found")
    if ret.get("status") == "cancelled":
        raise HTTPException(status_code=400, detail="Cannot edit a cancelled return")
    now = now_iso()
    updates = {}
    if data.reason is not None:
        updates["reason"] = data.reason
    if data.notes is not None:
        updates["notes"] = data.notes
    if data.refund_method is not None:
        updates["refund_method"] = data.refund_method

    restock_new = data.restock if data.restock is not None else ret.get("restock", True)
    if data.restock is not None:
        updates["restock"] = data.restock

    restock_old = ret.get("restock", True)
    if data.items is not None or restock_old != restock_new:
        lines = ret["items"]
        if data.items is not None:
            if not data.items:
                raise HTTPException(status_code=400, detail="At least one item is required")
            _, lines = await refund_lines(bid, data.items, ret.get("sale_id"), exclude_return=return_id, posting=True)
        updates["items"] = lines
        if data.items is not None:
            updates["refund_total"], updates["cogs_reversed"] = _return_totals(lines)
        await _apply_return_stock(bid, user, ret, {**ret, **updates}, now)

    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    await db.returns.update_one({"return_id": return_id, "business_id": bid}, {"$set": updates})
    await log_audit(bid, user, "return.updated", "return", return_id, f"{ret['return_number']} · {', '.join(updates.keys())}")
    doc = await db.returns.find_one({"return_id": return_id, "business_id": bid}, {"_id": 0})
    await try_post(post_return(bid, user, doc, replace=True))
    return return_public(doc, can_finance(user))


@router.post("/{return_id}/cancel")
@atomic_posting
async def cancel_return(return_id: str, user: dict = Depends(require_perm("returns.cancel"))):
    bid = user["business_id"]
    ret = await db.returns.find_one({"return_id": return_id, "business_id": bid})
    if not ret:
        raise HTTPException(status_code=404, detail="Return not found")
    if ret.get("status") == "cancelled":
        raise HTTPException(status_code=400, detail="Return already cancelled")
    now = now_iso()
    await _apply_return_stock(bid, user, ret, None, now)
    await db.returns.update_one({"return_id": return_id, "business_id": bid}, {"$set": {"status": "cancelled", "cancelled_at": now, "cancelled_by": user["user_id"]}})
    await log_audit(bid, user, "return.cancelled", "return", return_id, ret["return_number"])
    await try_post(reverse_return(bid, user, ret))
    return {"ok": True}
