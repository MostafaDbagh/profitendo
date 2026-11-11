import uuid
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from core import db, require_perm, log_audit, now_iso, next_number, can_finance, require_edit_pin
from ledger import post_return, reverse_return, try_post

router = APIRouter(prefix="/api/returns", tags=["returns"])

REASONS = "^(changed_mind|damaged|wrong_product|defect|other)$"


class ReturnItem(BaseModel):
    product_id: str
    quantity: int = Field(ge=1)
    unit_price: Optional[float] = Field(default=None, ge=0)


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
    if not include_financials:
        doc.pop("cogs_reversed", None)
        for item in doc.get("items", []):
            item.pop("unit_cost", None)
    return doc


@router.get("")
async def list_returns(user: dict = Depends(require_perm("returns.view"))):
    fin = can_finance(user)
    docs = await db.returns.find({"business_id": user["business_id"]}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    return [return_public(d, fin) for d in docs]


@router.post("", status_code=201)
async def create_return(data: ReturnInput, user: dict = Depends(require_perm("returns.create"))):
    bid = user["business_id"]
    if data.client_ref:
        existing = await db.returns.find_one({"business_id": bid, "client_ref": data.client_ref})
        if existing:
            return return_public(existing, can_finance(user))
    sale = None
    if data.sale_id:
        sale = await db.sales.find_one({"sale_id": data.sale_id, "business_id": bid})
        if not sale:
            raise HTTPException(status_code=404, detail="Original sale not found")

    now = now_iso()
    rid = f"ret_{uuid.uuid4().hex[:12]}"
    number = await next_number(bid, "return")
    lines = []
    refund_total = 0.0
    cogs_reversed = 0.0

    for it in data.items:
        p = await db.products.find_one({"product_id": it.product_id, "business_id": bid})
        if not p:
            raise HTTPException(status_code=404, detail="Product not found")
        sale_line = None
        if sale:
            sale_line = next((l for l in sale["items"] if l["product_id"] == it.product_id), None)
            if not sale_line:
                raise HTTPException(status_code=400, detail=f"Product {p['name']} not in original sale")
            if it.quantity > sale_line["quantity"]:
                raise HTTPException(status_code=400, detail=f"Return quantity exceeds sold quantity for {p['name']}")
        price = it.unit_price
        if price is None:
            price = sale_line["unit_price"] if sale_line else (p.get("selling_price", 0) or 0)
        unit_cost = sale_line["unit_cost"] if sale_line else (p.get("product_cost", 0) or 0)
        line_refund = round(price * it.quantity, 2)
        refund_total += line_refund
        cogs_reversed += unit_cost * it.quantity
        lines.append({
            "product_id": p["product_id"],
            "name": p["name"],
            "quantity": it.quantity,
            "unit_price": price,
            "total": line_refund,
            "unit_cost": unit_cost,
        })

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
        new_qty = max(0, (p.get("quantity_sold", 0) or 0) - line["quantity"])
        updates = {"quantity_sold": new_qty, "updated_at": now}
        inc = {}
        if data.restock:
            inc["stock_qty"] = line["quantity"]
        await db.products.update_one({"product_id": p["product_id"]}, {"$inc": inc, "$set": updates})
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

    if data.items is not None:
        if len(data.items) < 1:
            raise HTTPException(status_code=400, detail="At least one item is required")
        sale = None
        if ret.get("sale_id"):
            sale = await db.sales.find_one({"sale_id": ret["sale_id"], "business_id": bid})
        restock_old = ret.get("restock", True)
        old_map = {}
        for line in ret["items"]:
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
        for it in data.items:
            if sale:
                sale_line = next((l for l in sale["items"] if l["product_id"] == it.product_id), None)
                if not sale_line:
                    raise HTTPException(status_code=400, detail=f"Product {prods[it.product_id]['name']} not in original sale")
                if it.quantity > sale_line["quantity"]:
                    raise HTTPException(status_code=400, detail=f"Return quantity exceeds sold quantity for {prods[it.product_id]['name']}")
        for pid, p in prods.items():
            oq = old_map.get(pid, 0)
            nq = new_map.get(pid, 0)
            cur_stock = p.get("stock_qty", 0) or 0
            stock_after = cur_stock - (oq if restock_old else 0) + (nq if restock_new else 0)
            if stock_after < 0:
                raise HTTPException(status_code=400, detail=f"Insufficient stock: {p['name']}")
            qs_after = max(0, (p.get("quantity_sold", 0) or 0) + oq - nq)
            await db.products.update_one(
                {"product_id": pid},
                {"$set": {"stock_qty": stock_after, "quantity_sold": qs_after, "updated_at": now}},
            )
            stock_delta = (nq if restock_new else 0) - (oq if restock_old else 0)
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
        lines = []
        refund_total = 0.0
        cogs_reversed = 0.0
        for it in data.items:
            p = prods[it.product_id]
            sale_line = next((l for l in sale["items"] if l["product_id"] == it.product_id), None) if sale else None
            price = it.unit_price
            if price is None:
                price = sale_line["unit_price"] if sale_line else (p.get("selling_price", 0) or 0)
            unit_cost = sale_line["unit_cost"] if sale_line else (p.get("product_cost", 0) or 0)
            line_refund = round(price * it.quantity, 2)
            refund_total += line_refund
            cogs_reversed += unit_cost * it.quantity
            lines.append({
                "product_id": p["product_id"],
                "name": p["name"],
                "quantity": it.quantity,
                "unit_price": price,
                "total": line_refund,
                "unit_cost": unit_cost,
            })
        updates["items"] = lines
        updates["refund_total"] = round(refund_total, 2)
        updates["cogs_reversed"] = round(cogs_reversed, 2)

    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    await db.returns.update_one({"return_id": return_id}, {"$set": updates})
    await log_audit(bid, user, "return.updated", "return", return_id, f"{ret['return_number']} · {', '.join(updates.keys())}")
    doc = await db.returns.find_one({"return_id": return_id}, {"_id": 0})
    await try_post(post_return(bid, user, doc, replace=True))
    return return_public(doc, can_finance(user))


@router.post("/{return_id}/cancel")
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
        for line in ret["items"]:
            p = await db.products.find_one({"product_id": line["product_id"], "business_id": bid})
            if not p:
                continue
            if (p.get("stock_qty", 0) or 0) - line["quantity"] < 0 and not allow_negative:
                raise HTTPException(status_code=400, detail=f"Cancelling would make stock negative for {p['name']}")
        for line in ret["items"]:
            p = await db.products.find_one({"product_id": line["product_id"], "business_id": bid})
            if not p:
                continue
            await db.products.update_one(
                {"product_id": p["product_id"]},
                {"$inc": {"stock_qty": -line["quantity"], "quantity_sold": line["quantity"]}, "$set": {"updated_at": now}},
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
            await db.products.update_one(
                {"product_id": line["product_id"], "business_id": bid},
                {"$inc": {"quantity_sold": line["quantity"]}, "$set": {"updated_at": now}},
            )
    await db.returns.update_one({"return_id": return_id}, {"$set": {"status": "cancelled", "cancelled_at": now, "cancelled_by": user["user_id"]}})
    await log_audit(bid, user, "return.cancelled", "return", return_id, ret["return_number"])
    await try_post(reverse_return(bid, user, ret))
    return {"ok": True}
