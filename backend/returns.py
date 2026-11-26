import uuid
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from numeric_inputs import MAX_STOCK_QUANTITY, NonnegativeStockQuantity, NonnegativeMoney, bounded_stock
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
    return doc


@router.get("")
async def list_returns(user: dict = Depends(require_perm("returns.view"))):
    fin = can_finance(user)
    docs = await db.returns.find({"business_id": user["business_id"]}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    return [return_public(d, fin) for d in docs]


def cents(value):
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


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
    projection = {"items": 1, "return_id": 1, "created_at": 1}
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
    used_value = defaultdict(Decimal)
    for ret in active:
        for line in ret["items"]:
            pid = line["product_id"]
            if ret["return_id"] == exclude_return:
                preferred[pid].extend(line["sale_ranges"])
            else:
                occupied[pid].extend(line["sale_ranges"])
                used_value[pid] += cents(line["total"])
    return occupied, preferred, used_value


def _range_value(source, selected):
    amount, cost = Decimal(0), Decimal(0)
    offset = 0
    for line in source:
        size = line["quantity"]
        net = cents(line["total"] if "total" in line else line["unit_price"] * size - line.get("discount", 0))
        for start, end in selected:
            lo, hi = max(0, start - offset), min(size, end - offset)
            if lo < hi:
                amount += cents(net * hi / size) - cents(net * lo / size)
                cost += Decimal(str(line.get("unit_cost", 0))) * (hi - lo)
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
        occupied, preferred, used_value = await _allocations(scope, exclude_return)
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
            paid, _ = _range_value(source, [(0, size)])
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
            refunded += amount
            line["sale_ranges"] = selected
        else:
            price = item.unit_price if item.unit_price is not None else product.get("selling_price", 0) or 0
            amount = cents(Decimal(str(price)) * qty)
            unit_cost = product.get("product_cost", 0) or 0
        line.update(unit_price=price, total=float(amount), unit_cost=unit_cost)
        lines.append(line)
    return sale, lines


class RefundPreview(BaseModel):
    sale_id: str
    items: List[ReturnItem] = Field(min_length=1)
    return_id: Optional[str] = None


async def preview_total(data, user):
    _, lines = await refund_lines(user["business_id"], data.items, data.sale_id, exclude_return=data.return_id)
    return {"total": round(sum(line["total"] for line in lines), 2)}


@router.post("/preview")
async def preview_new(data: RefundPreview, user: dict = Depends(require_perm("returns.create"))):
    return await preview_total(data.model_copy(update={"return_id": None}), user)


@router.post("/{return_id}/preview")
async def preview_edit(return_id: str, data: RefundPreview, user: dict = Depends(require_perm("returns.edit"))):
    scope = {"return_id": return_id, "sale_id": data.sale_id, "business_id": user["business_id"]}
    if not await db.returns.find_one(scope):
        raise HTTPException(404, "Return not found")
    return await preview_total(data.model_copy(update={"return_id": return_id}), user)


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
    refund_total = sum(line["total"] for line in lines)
    cogs_reversed = sum(line["unit_cost"] * line["quantity"] for line in lines)

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
    await db.returns.insert_one(doc)

    for line in lines:
        p = await db.products.find_one({"product_id": line["product_id"], "business_id": bid})
        if not p:
            continue
        new_qty = max(0, bounded_stock(p.get("quantity_sold") or 0, -line["quantity"]))
        updates = {"quantity_sold": new_qty, "updated_at": now}
        if data.restock:
            updates["stock_qty"] = bounded_stock(p.get("stock_qty") or 0, line["quantity"])
        await db.products.update_one({"product_id": p["product_id"], "business_id": bid}, {"$set": updates})
        if data.restock:
            await db.inventory_movements.insert_one({
                "movement_id": f"mov_{uuid.uuid4().hex[:12]}",
                "business_id": bid,
                "product_id": p["product_id"],
                "product_name": p["name"],
                "quantity": line["quantity"],
                "movement_type": "RETURN",
                "reference_id": rid,
                "reference_number": number,
                "user_id": user["user_id"],
                "user_name": user.get("name", ""),
                "notes": f"{data.reason} · {data.notes or ''}".strip(" ·"),
                "created_at": now,
            })

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
        old_map = defaultdict(int)
        new_map = defaultdict(int)
        for line in ret["items"]:
            old_map[line["product_id"]] += line["quantity"]
        for line in lines:
            new_map[line["product_id"]] += line["quantity"]
        prods = {}
        for pid in set(old_map) | set(new_map):
            p = await db.products.find_one({"product_id": pid, "business_id": bid})
            if not p:
                raise HTTPException(status_code=404, detail="Product not found")
            prods[pid] = p
        for pid, p in prods.items():
            oq = old_map.get(pid, 0)
            nq = new_map.get(pid, 0)
            cur_stock = p.get("stock_qty", 0) or 0
            stock_delta = bounded_stock(0, (nq if restock_new else 0) - (oq if restock_old else 0))
            stock_after = bounded_stock(cur_stock, stock_delta)
            if stock_after < 0 and not (user.get("business") or {}).get("allow_negative_stock", False):
                raise HTTPException(status_code=400, detail=f"Insufficient stock: {p['name']}")
            qs_after = max(0, bounded_stock(p.get("quantity_sold") or 0, oq - nq))
            await db.products.update_one(
                {"product_id": pid, "business_id": bid},
                {"$set": {"stock_qty": stock_after, "quantity_sold": qs_after, "updated_at": now}},
            )
            if stock_delta != 0:
                await db.inventory_movements.insert_one({
                    "movement_id": f"mov_{uuid.uuid4().hex[:12]}",
                    "business_id": bid,
                    "product_id": pid,
                    "product_name": p["name"],
                    "quantity": stock_delta,
                    "movement_type": "ADJUSTMENT",
                    "reference_id": return_id,
                    "reference_number": ret["return_number"],
                    "user_id": user["user_id"],
                    "user_name": user.get("name", ""),
                    "notes": f"return edit {ret['return_number']}",
                    "created_at": now,
                })
        refund_total = sum(line["total"] for line in lines)
        cogs_reversed = sum(line["unit_cost"] * line["quantity"] for line in lines)
        updates["items"] = lines
        updates["refund_total"] = round(refund_total, 2)
        updates["cogs_reversed"] = round(cogs_reversed, 2)

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
    allow_negative = (user.get("business") or {}).get("allow_negative_stock", False)
    now = now_iso()
    if ret.get("restock"):
        quantities = {}
        for line in ret["items"]:
            pid = line["product_id"]
            quantities[pid] = quantities.get(pid, 0) + line["quantity"]
        for pid, quantity in quantities.items():
            p = await db.products.find_one({"product_id": pid, "business_id": bid})
            if not p:
                continue
            if bounded_stock(p.get("stock_qty") or 0, -quantity) < 0 and not allow_negative:
                raise HTTPException(status_code=400, detail=f"Cancelling would make stock negative for {p['name']}")
        for line in ret["items"]:
            p = await db.products.find_one({"product_id": line["product_id"], "business_id": bid})
            if not p:
                continue
            await db.products.update_one(
                {"product_id": p["product_id"], "business_id": bid},
                {"$set": {"stock_qty": bounded_stock(p.get("stock_qty") or 0, -line["quantity"]),
                          "quantity_sold": bounded_stock(p.get("quantity_sold") or 0, line["quantity"]),
                          "updated_at": now}},
            )
            await db.inventory_movements.insert_one({
                "movement_id": f"mov_{uuid.uuid4().hex[:12]}",
                "business_id": bid,
                "product_id": p["product_id"],
                "product_name": p["name"],
                "quantity": -line["quantity"],
                "movement_type": "ADJUSTMENT",
                "reference_id": return_id,
                "reference_number": ret["return_number"],
                "user_id": user["user_id"],
                "user_name": user.get("name", ""),
                "notes": f"Return {ret['return_number']} cancelled",
                "created_at": now,
            })
    else:
        for line in ret["items"]:
            key = {"product_id": line["product_id"], "business_id": bid}
            p = await db.products.find_one(key)
            if p:
                await db.products.update_one(key, {"$set": {
                    "quantity_sold": bounded_stock(p.get("quantity_sold") or 0, line["quantity"]),
                    "updated_at": now,
                }})
    await db.returns.update_one({"return_id": return_id, "business_id": bid}, {"$set": {"status": "cancelled", "cancelled_at": now, "cancelled_by": user["user_id"]}})
    await log_audit(bid, user, "return.cancelled", "return", return_id, ret["return_number"])
    await try_post(reverse_return(bid, user, ret))
    return {"ok": True}
