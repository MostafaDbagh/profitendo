import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from core import db, require_perm, log_audit, now_iso, compute_cash_balance, pin_guard

router = APIRouter(prefix="/api", tags=["cash"])


class ClosingInput(BaseModel):
    actual_cash: float = Field(ge=0)
    notes: Optional[str] = ""


class WithdrawalInput(BaseModel):
    person: str = Field(min_length=1, max_length=120)
    amount: float = Field(gt=0)
    date: Optional[str] = None
    reason: Optional[str] = ""
    source: str = Field(default="cash", pattern="^(cash|bank)$")
    notes: Optional[str] = ""


@router.get("/cash/summary")
async def cash_summary(user: dict = Depends(require_perm("cash.view")), _pin: dict = Depends(pin_guard)):
    bid = user["business_id"]
    biz = await db.businesses.find_one({"business_id": bid}, {"_id": 0, "cash_opening": 1})
    opening = (biz or {}).get("cash_opening", 0) or 0
    sales = await db.sales.find({"business_id": bid, "status": "confirmed", "payment_method": "cash"}, {"_id": 0, "total": 1}).to_list(100000)
    returns = await db.returns.find({"business_id": bid, "refund_method": "cash"}, {"_id": 0, "refund_total": 1}).to_list(100000)
    expenses = await db.expenses.find({"business_id": bid, "payment_method": "cash"}, {"_id": 0, "amount": 1}).to_list(100000)
    withdrawals = await db.withdrawals.find({"business_id": bid, "source": "cash"}, {"_id": 0}).to_list(100000)
    cash_sales = round(sum(s.get("total", 0) for s in sales), 2)
    cash_refunds = round(sum(r.get("refund_total", 0) for r in returns), 2)
    cash_expenses = round(sum(e.get("amount", 0) for e in expenses), 2)
    cash_withdrawals = round(sum(w.get("amount", 0) for w in withdrawals), 2)
    balance = round(opening + cash_sales - cash_refunds - cash_expenses - cash_withdrawals, 2)
    return {
        "opening": opening,
        "cash_sales": cash_sales,
        "cash_refunds": cash_refunds,
        "cash_expenses": cash_expenses,
        "cash_withdrawals": cash_withdrawals,
        "balance": balance,
        "withdrawals": [
            {k: v for k, v in w.items() if k not in ("_id", "business_id")}
            for w in sorted(withdrawals, key=lambda x: x.get("created_at", ""), reverse=True)
        ] if user["permissions"].get("withdrawals.view") else [],
    }


@router.post("/cash/closing", status_code=201)
async def cash_closing(data: ClosingInput, user: dict = Depends(require_perm("cash.close"))):
    bid = user["business_id"]
    expected = await compute_cash_balance(bid)
    now = now_iso()
    doc = {
        "closing_id": f"clo_{uuid.uuid4().hex[:12]}",
        "business_id": bid,
        "date": now,
        "expected": expected,
        "actual": round(data.actual_cash, 2),
        "difference": round(data.actual_cash - expected, 2),
        "notes": data.notes or "",
        "created_by": user["user_id"],
        "created_by_name": user.get("name", ""),
        "created_at": now,
    }
    await db.cash_closings.insert_one(doc)
    await log_audit(bid, user, "cash.closing", "cash_closing", doc["closing_id"], f"expected {expected} · actual {doc['actual']} · diff {doc['difference']}")
    doc.pop("_id", None)
    doc.pop("business_id", None)
    return doc


@router.get("/cash/closings")
async def list_closings(user: dict = Depends(require_perm("cash.view")), _pin: dict = Depends(pin_guard)):
    docs = await db.cash_closings.find({"business_id": user["business_id"]}, {"_id": 0, "business_id": 0}).sort("created_at", -1).to_list(200)
    return docs


@router.get("/withdrawals")
async def list_withdrawals(user: dict = Depends(require_perm("withdrawals.view"))):
    docs = await db.withdrawals.find({"business_id": user["business_id"]}, {"_id": 0, "business_id": 0}).sort("created_at", -1).to_list(1000)
    return docs


@router.post("/withdrawals", status_code=201)
async def create_withdrawal(data: WithdrawalInput, user: dict = Depends(require_perm("withdrawals.manage"))):
    bid = user["business_id"]
    now = now_iso()
    doc = {
        "withdrawal_id": f"wdr_{uuid.uuid4().hex[:12]}",
        "business_id": bid,
        "person": data.person.strip(),
        "amount": round(data.amount, 2),
        "date": data.date or now[:10],
        "reason": data.reason or "",
        "source": data.source,
        "notes": data.notes or "",
        "created_by": user["user_id"],
        "created_by_name": user.get("name", ""),
        "created_at": now,
    }
    await db.withdrawals.insert_one(doc)
    await log_audit(bid, user, "withdrawal.created", "withdrawal", doc["withdrawal_id"], f"{doc['person']} · {doc['amount']} ({doc['source']})")
    doc.pop("_id", None)
    doc.pop("business_id", None)
    return doc
