"""Purchase returns: send purchased inventory back to the supplier at the
ORIGINAL purchase-line cost, reversing inventory value and the corresponding
Cash/Bank/Accounts-Payable balance with balanced GL entries linked to the
original purchase for audit-trail consistency.
"""
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import db, require_perm, log_audit, now_iso, next_number
from ledger import post_source, reverse_source, try_post, _accounts_map, _line

router = APIRouter(prefix="/api/purchase-returns", tags=["purchase-returns"])


class PRItem(BaseModel):
    product_id: str
    quantity: float = Field(gt=0, le=1_000_000)


class PRInput(BaseModel):
    purchase_id: str
    reason: str = Field(default="", max_length=200)
    refund_method: str = Field(default="cash", pattern="^(cash|card|transfer|other|credit)$")
    client_ref: Optional[str] = Field(default=None, max_length=64)
    items: List[PRItem] = Field(min_length=1)


def pr_public(d: dict) -> dict:
    d.pop("_id", None)
    d.pop("business_id", None)
    return d


async def _post_pr(bid, user, doc, *, replace=False):
    m = await _accounts_map(bid)
    pm = doc.get("refund_method", "cash")
    cr_inventory = m["inventory"]
    dr_acct = m["cash"] if pm == "cash" else m["accounts_payable"] if pm == "credit" else m["bank"]
    total = doc["total_value"]
    lines = [_line(dr_acct, debit=total), _line(cr_inventory, credit=total)]
    return await post_source(bid, user, source_type="purchase_return", source_id=doc["return_id"],
                             source_number=doc["return_number"], lines=lines,
                             narration=f"مرتجع مشتريات {doc['return_number']} — الفاتورة الأصلية {doc['purchase_number']}",
                             date=doc.get("return_date"), replace=replace)


@router.get("")
async def list_purchase_returns(user: dict = Depends(require_perm("purchases.view"))):
    docs = await db.purchase_returns.find({"business_id": user["business_id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return docs


@router.post("", status_code=201)
async def create_purchase_return(data: PRInput, user: dict = Depends(require_perm("purchases.create"))):
    bid = user["business_id"]
    if data.client_ref:
        existing = await db.purchase_returns.find_one({"business_id": bid, "client_ref": data.client_ref}, {"_id": 0})
        if existing:
            return existing
    purchase = await db.purchases.find_one({"purchase_id": data.purchase_id, "business_id": bid})
    if not purchase or purchase.get("status") != "confirmed":
        raise HTTPException(status_code=404, detail="Purchase not found or not confirmed")

    lines = []
    total_value = 0.0
    now = now_iso()
    for it in data.items:
        pl = next((l for l in purchase["items"] if l["product_id"] == it.product_id), None)
        if not pl:
            raise HTTPException(status_code=400, detail="Product not in this purchase")
        already = pl.get("returned_qty", 0) or 0
        if already + it.quantity > pl["quantity"]:
            raise HTTPException(status_code=400, detail=f"Return quantity exceeds purchased quantity: {pl.get('product_name', '')}")
        p = await db.products.find_one({"product_id": it.product_id, "business_id": bid})
        unit_cost = pl.get("unit_cost", 0) or 0  # ORIGINAL purchase cost — never the current product price
        line_total = round(unit_cost * it.quantity, 2)
        total_value += line_total
        lines.append({"product_id": it.product_id, "product_name": pl.get("product_name") or (p or {}).get("name", ""),
                      "quantity": it.quantity, "unit_cost": unit_cost, "total": line_total})

    rid = f"pret_{uuid.uuid4().hex[:12]}"
    number = await next_number(bid, "purchase_return")
    doc = {
        "return_id": rid,
        "client_ref": data.client_ref,
        "business_id": bid,
        "return_number": number,
        "return_date": now,
        "purchase_id": purchase["purchase_id"],
        "purchase_number": purchase["purchase_number"],
        "supplier": purchase.get("supplier", ""),
        "reason": data.reason.strip(),
        "refund_method": data.refund_method,
        "items": lines,
        "total_value": round(total_value, 2),
        "status": "confirmed",
        "created_by": user["user_id"],
        "created_by_name": user.get("name", ""),
        "created_at": now,
    }
    await db.purchase_returns.insert_one(doc)

    for it in data.items:
        await db.products.update_one({"product_id": it.product_id},
                                     {"$inc": {"stock_qty": -it.quantity}, "$set": {"updated_at": now}})
        await db.inventory_movements.insert_one({
            "movement_id": f"mov_{uuid.uuid4().hex[:12]}",
            "business_id": bid,
            "product_id": it.product_id,
            "product_name": next(l["product_name"] for l in lines if l["product_id"] == it.product_id),
            "quantity": -it.quantity,
            "movement_type": "PURCHASE_RETURN",
            "reference_id": rid,
            "reference_number": number,
            "user_id": user["user_id"],
            "user_name": user.get("name", ""),
            "notes": data.reason.strip(),
            "created_at": now,
        })
    await db.purchases.update_one(
        {"purchase_id": purchase["purchase_id"]},
        {"$inc": {**{f"items.{i}.returned_qty": next(x.quantity for x in data.items if x.product_id == l["product_id"])
                     for i, l in enumerate(purchase["items"]) if any(x.product_id == l["product_id"] for x in data.items)}}},
    )
    await log_audit(bid, user, "purchase_return.created", "purchase_return", rid, f"{number} · {round(total_value, 2)}")
    await try_post(_post_pr(bid, user, doc))
    return pr_public(doc)


@router.post("/{return_id}/cancel")
async def cancel_purchase_return(return_id: str, user: dict = Depends(require_perm("purchases.cancel"))):
    bid = user["business_id"]
    ret = await db.purchase_returns.find_one({"return_id": return_id, "business_id": bid})
    if not ret:
        raise HTTPException(status_code=404, detail="Return not found")
    if ret.get("status") == "cancelled":
        raise HTTPException(status_code=400, detail="Return already cancelled")
    now = now_iso()
    for line in ret["items"]:
        await db.products.update_one({"product_id": line["product_id"]},
                                     {"$inc": {"stock_qty": line["quantity"]}, "$set": {"updated_at": now}})
        await db.inventory_movements.insert_one({
            "movement_id": f"mov_{uuid.uuid4().hex[:12]}",
            "business_id": bid,
            "product_id": line["product_id"],
            "product_name": line["product_name"],
            "quantity": line["quantity"],
            "movement_type": "PURCHASE_RETURN_CANCEL",
            "reference_id": return_id,
            "reference_number": ret["return_number"],
            "user_id": user["user_id"],
            "user_name": user.get("name", ""),
            "notes": "",
            "created_at": now,
        })
    purchase = await db.purchases.find_one({"purchase_id": ret["purchase_id"]})
    if purchase:
        await db.purchases.update_one(
            {"purchase_id": ret["purchase_id"]},
            {"$inc": {**{f"items.{i}.returned_qty": -l["quantity"]
                         for i, l in enumerate(purchase["items"])
                         if any(x["product_id"] == l["product_id"] for x in ret["items"])}}},
        )
    await db.purchase_returns.update_one({"return_id": return_id},
                                         {"$set": {"status": "cancelled", "cancelled_at": now, "cancelled_by": user["user_id"]}})
    await log_audit(bid, user, "purchase_return.cancelled", "purchase_return", return_id, ret["return_number"])
    await try_post(reverse_source(bid, "purchase_return", return_id, user, f"قيد عكسي — مرتجع مشتريات {ret['return_number']}"))
    return {"ok": True}
