import uuid
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from core import db, require_perm, log_audit, now_iso, next_number, require_edit_pin
from ledger import post_purchase, reverse_purchase, try_post

router = APIRouter(prefix="/api/purchases", tags=["purchases"])

PAYMENT_METHODS = "^(cash|card|transfer|other|credit)$"


class PurchaseItem(BaseModel):
    product_id: str
    quantity: int = Field(ge=1)
    unit_cost: float = Field(ge=0)


class PurchaseInput(BaseModel):
    supplier: str = Field(min_length=1, max_length=120)
    invoice_number: Optional[str] = ""
    purchase_date: Optional[str] = None
    notes: Optional[str] = ""
    additional_costs: float = Field(ge=0, default=0)
    payment_method: str = Field(default="cash", pattern=PAYMENT_METHODS)
    client_ref: Optional[str] = Field(default=None, max_length=64)
    items: List[PurchaseItem] = Field(min_length=1)


class PurchaseUpdate(BaseModel):
    supplier: Optional[str] = Field(default=None, min_length=1, max_length=120)
    invoice_number: Optional[str] = None
    purchase_date: Optional[str] = None
    notes: Optional[str] = None
    additional_costs: Optional[float] = Field(default=None, ge=0)
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
    subtotal = 0.0
    for it in items:
        p = prods[it.product_id]
        line_total = round(it.quantity * it.unit_cost, 2)
        subtotal += line_total
        lines.append({
            "product_id": p["product_id"],
            "name": p["name"],
            "quantity": it.quantity,
            "unit_cost": it.unit_cost,
            "total": line_total,
        })
    return lines, round(subtotal, 2)


async def _record_movement(bid: str, user: dict, p: dict, qty: float, mtype: str, ref_id: str, ref_number: str, notes: str, now: str):
    await db.inventory_movements.insert_one({
        "movement_id": f"mov_{uuid.uuid4().hex[:12]}",
        "business_id": bid,
        "product_id": p["product_id"],
        "product_name": p["name"],
        "quantity": qty,
        "movement_type": mtype,
        "reference_id": ref_id,
        "reference_number": ref_number,
        "user_id": user["user_id"],
        "user_name": user.get("name", ""),
        "notes": notes,
        "created_at": now,
    })


def _receipt_avg(old_qty: float, old_cost: float, qty: float, unit_cost: float) -> tuple:
    new_qty = old_qty + qty
    new_avg = round(((old_qty * old_cost) + (qty * unit_cost)) / new_qty, 4) if new_qty > 0 else unit_cost
    return new_qty, new_avg


def _aggregate_lines(lines: list):
    qty, val = {}, {}
    for line in lines:
        qty[line["product_id"]] = qty.get(line["product_id"], 0) + line["quantity"]
        val[line["product_id"]] = val.get(line["product_id"], 0.0) + line["quantity"] * line["unit_cost"]
    return qty, val


def _aggregate_items(items: list):
    qty, val = {}, {}
    for it in items:
        qty[it.product_id] = qty.get(it.product_id, 0) + it.quantity
        val[it.product_id] = val.get(it.product_id, 0.0) + it.quantity * it.unit_cost
    return qty, val


def _edited_avg_cost(p: dict, oq: float, oval: float, nq: float, nval: float) -> tuple:
    cur_qty = p.get("stock_qty", 0) or 0
    cur_avg = p.get("product_cost", 0) or 0
    pre_qty = cur_qty - oq
    pre_value = cur_qty * cur_avg - oval
    final_qty = pre_qty + nq
    if final_qty <= 0:
        return final_qty, cur_avg
    if pre_qty > 0:
        return final_qty, round((max(pre_value, 0.0) + nval) / final_qty, 4)
    return final_qty, (round(nval / nq, 4) if nq > 0 else cur_avg)


async def _apply_item_edit(bid: str, purchase: dict, items: list, user: dict, allow_negative: bool, now: str):
    if len(items) < 1:
        raise HTTPException(status_code=400, detail="At least one item is required")
    old_qty, old_val = _aggregate_lines(purchase["items"])
    new_qty, new_val = _aggregate_items(items)
    prods = await _fetch_products(bid, set(old_qty) | set(new_qty))
    for pid, p in prods.items():
        final_qty = (p.get("stock_qty", 0) or 0) - old_qty.get(pid, 0) + new_qty.get(pid, 0)
        if not allow_negative and final_qty < 0:
            raise HTTPException(status_code=400, detail=f"Insufficient stock: {p['name']}")
    for pid, p in prods.items():
        final_qty, new_avg = _edited_avg_cost(p, old_qty.get(pid, 0), old_val.get(pid, 0.0), new_qty.get(pid, 0), new_val.get(pid, 0.0))
        await db.products.update_one(
            {"product_id": pid},
            {"$set": {"stock_qty": final_qty, "product_cost": new_avg, "updated_at": now}},
        )
        delta = new_qty.get(pid, 0) - old_qty.get(pid, 0)
        if delta != 0:
            await _record_movement(bid, user, p, delta, "ADJUSTMENT", purchase["purchase_id"], purchase["purchase_number"], f"purchase edit {purchase['purchase_number']}", now)
    return _build_lines(items, prods)


@router.post("", status_code=201)
async def create_purchase_route(data: PurchaseInput, user: dict = Depends(require_perm("purchases.create"))):
    doc = await create_purchase(data, user)
    doc.pop("_id", None)
    return doc


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
    total = round(subtotal + data.additional_costs, 2)

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
    await db.purchases.insert_one(doc)

    for it in data.items:
        p = prods[it.product_id]
        _, new_avg = _receipt_avg(p.get("stock_qty", 0) or 0, p.get("product_cost", 0) or 0, it.quantity, it.unit_cost)
        await db.products.update_one(
            {"product_id": p["product_id"]},
            {"$inc": {"stock_qty": it.quantity}, "$set": {"product_cost": new_avg, "updated_at": now}},
        )
        p["stock_qty"] = (p.get("stock_qty", 0) or 0) + it.quantity
        p["product_cost"] = new_avg
        await _record_movement(bid, user, p, it.quantity, "PURCHASE", pid, number, data.notes or "", now)

    await log_audit(bid, user, "purchase.created", "purchase", pid, f"{number} · {doc['supplier']} · {total}")
    await try_post(post_purchase(bid, user, doc))
    doc.pop("_id", None)
    return doc


@router.put("/{purchase_id}")
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
        lines, subtotal = await _apply_item_edit(bid, purchase, data.items, user, allow_negative, now)
        updates["items"] = lines
        updates["subtotal"] = subtotal

    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    subtotal = updates.get("subtotal", purchase["subtotal"])
    additional = updates.get("additional_costs", purchase.get("additional_costs", 0))
    updates["total"] = round(subtotal + additional, 2)
    await db.purchases.update_one({"purchase_id": purchase_id}, {"$set": updates})
    await log_audit(bid, user, "purchase.updated", "purchase", purchase_id, f"{purchase['purchase_number']} · {', '.join(updates.keys())}")
    doc = await db.purchases.find_one({"purchase_id": purchase_id}, {"_id": 0})
    await try_post(post_purchase(bid, user, doc, replace=True))
    return doc


@router.post("/{purchase_id}/cancel")
async def cancel_purchase(purchase_id: str, user: dict = Depends(require_perm("purchases.cancel"))):
    bid = user["business_id"]
    purchase = await db.purchases.find_one({"purchase_id": purchase_id, "business_id": bid})
    if not purchase:
        raise HTTPException(status_code=404, detail="Purchase not found")
    if purchase.get("status") == "cancelled":
        raise HTTPException(status_code=400, detail="Purchase already cancelled")
    allow_negative = (user.get("business") or {}).get("allow_negative_stock", False)
    now = now_iso()
    for line in purchase["items"]:
        p = await db.products.find_one({"product_id": line["product_id"], "business_id": bid})
        if not p:
            continue
        new_stock = (p.get("stock_qty", 0) or 0) - line["quantity"]
        if new_stock < 0 and not allow_negative:
            raise HTTPException(status_code=400, detail=f"Cancelling would make stock negative for {p['name']}")
    for line in purchase["items"]:
        p = await db.products.find_one({"product_id": line["product_id"], "business_id": bid})
        if not p:
            continue
        await db.products.update_one(
            {"product_id": p["product_id"]},
            {"$inc": {"stock_qty": -line["quantity"]}, "$set": {"updated_at": now}},
        )
        await db.inventory_movements.insert_one({
            "movement_id": f"mov_{uuid.uuid4().hex[:12]}",
            "business_id": bid,
            "product_id": p["product_id"],
            "product_name": p["name"],
            "quantity": -line["quantity"],
            "movement_type": "ADJUSTMENT",
            "reference_id": purchase_id,
            "reference_number": purchase["purchase_number"],
            "user_id": user["user_id"],
            "user_name": user.get("name", ""),
            "notes": f"Purchase {purchase['purchase_number']} cancelled",
            "created_at": now,
        })
    await db.purchases.update_one({"purchase_id": purchase_id}, {"$set": {"status": "cancelled", "cancelled_at": now, "cancelled_by": user["user_id"]}})
    await log_audit(bid, user, "purchase.cancelled", "purchase", purchase_id, purchase["purchase_number"])
    await try_post(reverse_purchase(bid, user, purchase))
    return {"ok": True}
