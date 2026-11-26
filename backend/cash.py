import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from numeric_inputs import NonnegativeMoney
from core import atomic_posting, db, require_perm, log_audit, now_iso, cash_components, compute_cash_balance, pin_guard

router = APIRouter(prefix="/api", tags=["cash"])


class ClosingInput(BaseModel):
    actual_cash: NonnegativeMoney
    notes: Optional[str] = ""


class WithdrawalInput(BaseModel):
    person: str = Field(min_length=1, max_length=120)
    amount: NonnegativeMoney = Field(gt=0)
    date: Optional[str] = None
    reason: Optional[str] = ""
    source: str = Field(default="cash", pattern="^(cash|bank)$")
    notes: Optional[str] = ""


@router.get("/cash/summary")
async def cash_summary(user: dict = Depends(require_perm("cash.view")), _pin: dict = Depends(pin_guard)):
    bid = user["business_id"]
    summary = await cash_components(bid)
    summary["withdrawals"] = []
    if user["permissions"].get("withdrawals.view"):
        summary["withdrawals"] = await db.withdrawals.find(
            {"business_id": bid, "source": "cash"}, {"_id": 0, "business_id": 0}
        ).sort("created_at", -1).to_list(100000)
    return summary


@router.post("/cash/closing", status_code=201)
@atomic_posting
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
