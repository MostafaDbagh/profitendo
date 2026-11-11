import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from core import db, require_perm, log_audit, now_iso, can_finance

router = APIRouter(prefix="/api/inventory", tags=["inventory"])


class AdjustmentInput(BaseModel):
    product_id: str
    movement_type: str = Field(pattern="^(ADJUSTMENT|DAMAGE|MANUAL_CORRECTION)$")
    quantity: int
    notes: Optional[str] = ""


@router.get("")
async def inventory_list(user: dict = Depends(require_perm("inventory.view"))):
    fin = can_finance(user)
    docs = await db.products.find({"business_id": user["business_id"]}, {"_id": 0}).to_list(2000)
    out = []
    for p in docs:
        stock = p.get("stock_qty", 0) or 0
        min_stock = p.get("minimum_stock_level", 0) or 0
        status = "out" if stock <= 0 else ("low" if min_stock > 0 and stock <= min_stock else "ok")
        row = {
            "product_id": p["product_id"],
            "name": p["name"],
            "sku": p.get("sku", ""),
            "stock_qty": stock,
            "minimum_stock_level": min_stock,
            "status": status,
            "updated_at": p.get("updated_at"),
        }
        if fin:
            row["unit_cost"] = p.get("product_cost", 0) or 0
            row["stock_value"] = round(stock * (p.get("product_cost", 0) or 0), 2)
        out.append(row)
    return out


@router.get("/movements")
async def list_movements(product_id: Optional[str] = None, limit: int = 50, user: dict = Depends(require_perm("inventory.view"))):
    query = {"business_id": user["business_id"]}
    if product_id:
        query["product_id"] = product_id
    limit = max(1, min(limit, 200))
    docs = await db.inventory_movements.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return docs


@router.post("/adjust", status_code=201)
async def adjust_stock(data: AdjustmentInput, user: dict = Depends(require_perm("inventory.adjust"))):
    if data.quantity == 0:
        raise HTTPException(status_code=400, detail="Quantity cannot be zero")
    bid = user["business_id"]
    p = await db.products.find_one({"product_id": data.product_id, "business_id": bid})
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    qty = data.quantity
    if data.movement_type == "DAMAGE":
        qty = -abs(qty)
    new_stock = (p.get("stock_qty", 0) or 0) + qty
    allow_negative = (user.get("business") or {}).get("allow_negative_stock", False)
    if new_stock < 0 and not allow_negative:
        raise HTTPException(status_code=400, detail="Insufficient stock")
    now = now_iso()
    mov = {
        "movement_id": f"mov_{uuid.uuid4().hex[:12]}",
        "business_id": bid,
        "product_id": p["product_id"],
        "product_name": p["name"],
        "quantity": qty,
        "movement_type": data.movement_type,
        "reference_id": None,
        "reference_number": None,
        "user_id": user["user_id"],
        "user_name": user.get("name", ""),
        "notes": data.notes or "",
        "created_at": now,
    }
    await db.inventory_movements.insert_one(mov)
    await db.products.update_one({"product_id": p["product_id"]}, {"$inc": {"stock_qty": qty}, "$set": {"updated_at": now}})
    await log_audit(bid, user, "inventory.adjusted", "product", p["product_id"], f"{p['name']}: {qty:+d} ({data.movement_type})")
    mov.pop("_id", None)
    return {**mov, "new_stock": new_stock}
