import hashlib
import json
import math
import uuid
from datetime import date as calendar_date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field, field_validator
from pymongo.errors import DuplicateKeyError

from core import atomic_posting, db, require_perm, log_audit, now_iso
from ledger import post_expense, reverse_expense, try_post

router = APIRouter(prefix="/api/expenses", tags=["expenses"])

CATEGORIES = [
    "rent", "utilities", "salaries", "advertising", "shipping",
    "packaging", "maintenance", "transportation", "taxes", "other",
]


class ExpenseInput(BaseModel):
    amount: Decimal = Field(gt=0, decimal_places=2, allow_inf_nan=False)
    category: str
    date: Optional[str] = None
    description: Optional[str] = ""
    payment_method: str = Field(default="cash", pattern="^(cash|card|transfer|other)$")
    notes: Optional[str] = ""
    client_ref: Optional[str] = Field(default=None, min_length=1, max_length=64)

    @field_validator("date")
    @classmethod
    def valid_date(cls, value):
        if not value:
            return None
        parsed = calendar_date.fromisoformat(value)
        if parsed.isoformat() != value:
            raise ValueError("Date must use YYYY-MM-DD")
        return value

    @field_validator("amount")
    @classmethod
    def representable_amount(cls, amount):
        stored = float(amount)
        if math.ulp(stored) > 0.01 or Decimal(str(stored)) != amount:
            raise ValueError("Amount exceeds supported currency precision")
        return amount


def validate(data: ExpenseInput):
    if data.category not in CATEGORIES:
        raise HTTPException(status_code=400, detail="Invalid category")


def expense_public(doc: dict) -> dict:
    return {k: v for k, v in doc.items() if k not in ("_id", "business_id")}


@router.get("")
async def list_expenses(user: dict = Depends(require_perm("expenses.view"))):
    docs = await db.expenses.find({"business_id": user["business_id"]}, {"_id": 0}).sort("date", -1).to_list(2000)
    return [expense_public(d) for d in docs]


@router.post("", status_code=201)
async def create_expense(data: ExpenseInput, user: dict = Depends(require_perm("expenses.create"))):
    validate(data)
    if not data.client_ref:
        return await save_expense(data, user, None, None)
    bid = user["business_id"]
    receipt_id = f"{bid}:{data.client_ref}"
    canonical = data.model_dump(exclude={"client_ref"})
    canonical["amount"] = format(data.amount, ".2f")
    digest = hashlib.sha256(json.dumps(canonical, sort_keys=True).encode()).hexdigest()
    try:
        return await save_expense(data, user, receipt_id, digest)
    except DuplicateKeyError:
        # A simultaneous retry can lose the unique receipt insert at commit.
        receipt = await db.expense_submission_receipts.find_one({"_id": receipt_id, "business_id": bid})
        if not receipt:
            raise
        return await replay_expense(receipt, bid, digest)


async def replay_expense(receipt, bid, digest):
    if receipt["digest"] != digest:
        raise HTTPException(409, "Expense submission reference already used for different details")
    expense = await db.expenses.find_one({"business_id": bid, "expense_id": receipt["expense_id"]})
    if not expense:
        raise HTTPException(409, "Previously submitted expense has been deleted")
    return expense_public(expense)


@atomic_posting
async def save_expense(data, user, receipt_id, digest):
    bid = user["business_id"]
    expense_id = f"exp_{uuid.uuid4().hex[:12]}"
    if receipt_id:
        receipt = await db.expense_submission_receipts.find_one({"_id": receipt_id, "business_id": bid})
        if receipt:
            return await replay_expense(receipt, bid, digest)
        await db.expense_submission_receipts.insert_one({
            "_id": receipt_id, "business_id": bid, "expense_id": expense_id, "digest": digest,
        })
    now = now_iso()
    doc = {
        "expense_id": expense_id,
        "business_id": user["business_id"],
        "amount": float(data.amount),
        "category": data.category,
        "date": data.date or now[:10],
        "description": data.description or "",
        "payment_method": data.payment_method,
        "notes": data.notes or "",
        "created_by": user["user_id"],
        "created_by_name": user.get("name", ""),
        "created_at": now,
        "updated_at": now,
    }
    await db.expenses.insert_one(doc)
    await log_audit(user["business_id"], user, "expense.created", "expense", doc["expense_id"], f"{data.category} · {doc['amount']}")
    await try_post(post_expense(user["business_id"], user, doc))
    return expense_public(doc)


@router.put("/{expense_id}")
@atomic_posting
async def update_expense(expense_id: str, data: ExpenseInput, user: dict = Depends(require_perm("expenses.edit"))):
    validate(data)
    existing = await db.expenses.find_one({"expense_id": expense_id, "business_id": user["business_id"]})
    if not existing:
        raise HTTPException(status_code=404, detail="Expense not found")
    updates = {
        "amount": float(data.amount),
        "category": data.category,
        "date": data.date or existing["date"],
        "description": data.description or "",
        "payment_method": data.payment_method,
        "notes": data.notes or "",
        "updated_at": now_iso(),
    }
    await db.expenses.update_one({"expense_id": expense_id, "business_id": user["business_id"]}, {"$set": updates})
    await log_audit(user["business_id"], user, "expense.updated", "expense", expense_id, f"{data.category} · {updates['amount']}")
    doc = await db.expenses.find_one({"expense_id": expense_id, "business_id": user["business_id"]}, {"_id": 0})
    await try_post(post_expense(user["business_id"], user, doc, replace=True))
    return expense_public(doc)


@router.delete("/{expense_id}")
@atomic_posting
async def delete_expense(expense_id: str, user: dict = Depends(require_perm("expenses.delete"))):
    existing = await db.expenses.find_one({"expense_id": expense_id, "business_id": user["business_id"]})
    if not existing:
        raise HTTPException(status_code=404, detail="Expense not found")
    await db.expenses.delete_one({"expense_id": expense_id, "business_id": user["business_id"]})
    await log_audit(user["business_id"], user, "expense.deleted", "expense", expense_id, "")
    await try_post(reverse_expense(user["business_id"], user, existing))
    return {"ok": True}
