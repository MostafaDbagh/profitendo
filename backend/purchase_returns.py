"""Purchase returns: send purchased inventory back to the supplier at the
ORIGINAL purchase-line cost, reversing inventory value and the corresponding
Cash/Bank/Accounts-Payable balance with balanced GL entries linked to the
original purchase for audit-trail consistency.
"""
import uuid
from collections import defaultdict
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import atomic_posting, db, require_perm, log_audit, now_iso, next_number
from numeric_inputs import bounded_stock
from purchases import _amount, _line_value, _record_movement, _stock_value, _valuation_fields
from ledger import post_source, reverse_source, try_post, _accounts_map, _line

router = APIRouter(prefix="/api/purchase-returns", tags=["purchase-returns"])


class PRItem(BaseModel):
    product_id: str
    quantity: Decimal = Field(gt=0, le=1_000_000)


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


def _history_conflict():
    return HTTPException(409, "Supplier return history must be reconciled with the receipt lines")


def _source_index(line, source):
    pid = line["product_id"]
    index = line.get("purchase_line_index")
    if index is None:
        candidates = [i for i, purchase_line in enumerate(source)
                      if purchase_line["product_id"] == pid and purchase_line.get("unit_cost") == line.get("unit_cost")]
        if len(candidates) != 1:
            raise _history_conflict()
        index = candidates[0]
    if not isinstance(index, int) or index < 0 or index >= len(source):
        raise _history_conflict()
    original = source[index]
    if original["product_id"] != pid or line.get("unit_cost") != original.get("unit_cost"):
        raise _history_conflict()
    return index


async def _returned_by_line(bid, purchase):
    source = purchase["items"]
    quantities = defaultdict(Decimal)
    values = defaultdict(Decimal)
    query = {"business_id": bid, "purchase_id": purchase["purchase_id"], "status": {"$ne": "cancelled"}}
    async for ret in db.purchase_returns.find(query, {"items": 1}):
        for line in ret["items"]:
            i = _source_index(line, source)
            quantities[i] = _amount(bounded_stock(quantities[i], line["quantity"]))
            values[i] += _line_value(line, "total")
    for i, line in enumerate(source):
        if (quantities[i] != _amount(line.get("returned_qty") or 0)
                or not 0 <= quantities[i] <= _amount(line["quantity"])
                or not 0 <= values[i] <= _line_value(line, "total")):
            raise _history_conflict()
    return quantities, values


def _allocate(items, source, quantities, values):
    requested = defaultdict(Decimal)
    for item in items:
        requested[item.product_id] = _amount(bounded_stock(requested[item.product_id], item.quantity))
    lines = []
    for i, original in enumerate(source):
        pid = original["product_id"]
        size = _amount(original["quantity"])
        take = min(requested[pid], size - quantities[i])
        if not take:
            continue
        total = _line_value(original, "total")
        next_quantity = _amount(bounded_stock(quantities[i], take))
        # Allocate cents cumulatively so that all partial returns together
        # refund exactly the original line, including after an earlier void.
        target = round(total * next_quantity / size, 2)
        amount = max(Decimal(0), target - values[i])
        quantities[i] = next_quantity
        values[i] += amount
        requested[pid] -= take
        lines.append({"product_id": pid, "product_name": original.get("name") or original.get("product_name", ""),
                      "purchase_line_index": i, "quantity": bounded_stock(0, take),
                      "unit_cost": original["unit_cost"], "total": float(amount)})
    if any(requested.values()):
        raise HTTPException(400, "Return quantity exceeds remaining purchase quantity")
    return lines


async def _post_stock(bid, user, ret, sign, now):
    quantities, values = defaultdict(Decimal), defaultdict(Decimal)
    for line in ret["items"]:
        pid = line["product_id"]
        quantities[pid] = _amount(bounded_stock(quantities[pid], sign * _amount(line["quantity"])))
        values[pid] += sign * _line_value(line, "total")
    for pid, delta in quantities.items():
        key = {"business_id": bid, "product_id": pid}
        product = await db.products.find_one(key)
        if not product:
            raise HTTPException(409, "The receipt product is missing")
        stock = bounded_stock(product.get("stock_qty") or 0, delta)
        if sign < 0 and stock < 0 and not (user.get("business") or {}).get("allow_negative_stock", False):
            raise HTTPException(400, "Insufficient stock for supplier return")
        previous = await _stock_value(bid, product, reversing=True)
        fields = _valuation_fields(product, stock, previous + values[pid], now)
        await db.products.update_one(key, {"$set": {**fields, "stock_qty": stock}})
        movement = "PURCHASE_RETURN" if sign < 0 else "PURCHASE_RETURN_CANCEL"
        await _record_movement(bid, user, product, bounded_stock(0, delta), movement,
                               ret["return_id"], ret["return_number"], ret.get("reason", ""), now)


async def _save_quantities(bid, purchase, quantities):
    changes = {f"items.{i}.returned_qty": bounded_stock(0, qty) for i, qty in quantities.items()
               if qty != _amount(purchase["items"][i].get("returned_qty") or 0)}
    if changes:
        await db.purchases.update_one({"business_id": bid, "purchase_id": purchase["purchase_id"]}, {"$set": changes})


@router.post("", status_code=201)
@atomic_posting
async def create_purchase_return(data: PRInput, user: dict = Depends(require_perm("purchases.create"))):
    bid = user["business_id"]
    if data.client_ref:
        existing = await db.purchase_returns.find_one({"business_id": bid, "client_ref": data.client_ref}, {"_id": 0})
        if existing:
            return existing
    purchase = await db.purchases.find_one({"purchase_id": data.purchase_id, "business_id": bid})
    if not purchase or purchase.get("status") != "confirmed":
        raise HTTPException(status_code=404, detail="Purchase not found or not confirmed")

    quantities, values = await _returned_by_line(bid, purchase)
    lines = _allocate(data.items, purchase["items"], quantities, values)
    total_value = float(sum((_amount(line["total"]) for line in lines), Decimal(0)))
    now = now_iso()
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
    await _post_stock(bid, user, doc, -1, now)
    await db.purchase_returns.insert_one(doc)
    await _save_quantities(bid, purchase, quantities)
    await log_audit(bid, user, "purchase_return.created", "purchase_return", rid, f"{number} · {round(total_value, 2)}")
    await try_post(_post_pr(bid, user, doc))
    return pr_public(doc)


@router.post("/{return_id}/cancel")
@atomic_posting
async def cancel_purchase_return(return_id: str, user: dict = Depends(require_perm("purchases.cancel"))):
    bid = user["business_id"]
    ret = await db.purchase_returns.find_one({"return_id": return_id, "business_id": bid})
    if not ret:
        raise HTTPException(status_code=404, detail="Return not found")
    if ret.get("status") == "cancelled":
        raise HTTPException(status_code=400, detail="Return already cancelled")
    now = now_iso()
    purchase = await db.purchases.find_one({"business_id": bid, "purchase_id": ret["purchase_id"]})
    if not purchase or purchase.get("status") != "confirmed":
        raise HTTPException(409, "Cannot reverse a return without its confirmed purchase")
    quantities, _ = await _returned_by_line(bid, purchase)
    for line in ret["items"]:
        index = _source_index(line, purchase["items"])
        quantities[index] = _amount(bounded_stock(quantities[index], -_amount(line["quantity"])))
    await _post_stock(bid, user, ret, 1, now)
    await _save_quantities(bid, purchase, quantities)
    await db.purchase_returns.update_one({"business_id": bid, "return_id": return_id},
                                         {"$set": {"status": "cancelled", "cancelled_at": now, "cancelled_by": user["user_id"]}})
    await log_audit(bid, user, "purchase_return.cancelled", "purchase_return", return_id, ret["return_number"])
    await try_post(reverse_source(bid, "purchase_return", return_id, user, f"قيد عكسي — مرتجع مشتريات {ret['return_number']}"))
    return {"ok": True}
