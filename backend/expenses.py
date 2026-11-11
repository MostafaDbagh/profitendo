import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from core import db, require_perm, log_audit, now_iso
from ledger import post_expense, reverse_expense, try_post

router = APIRouter(prefix="/api/expenses", tags=["expenses"])

CATEGORIES = [
    "rent", "utilities", "salaries", "advertising", "shipping",
    "packaging", "maintenance", "transportation", "taxes", "other",
]


class ExpenseInput(BaseModel):
    amount: float = Field(gt=0)
    category: str
    date: Optional[str] = None
    description: Optional[str] = ""
    payment_method: str = Field(default="cash", pattern="^(cash|card|transfer|other)$")
    notes: Optional[str] = ""


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
    now = now_iso()
    doc = {
        "expense_id": f"exp_{uuid.uuid4().hex[:12]}",
        "business_id": user["business_id"],
        "amount": round(data.amount, 2),
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
async def update_expense(expense_id: str, data: ExpenseInput, user: dict = Depends(require_perm("expenses.edit"))):
    validate(data)
    existing = await db.expenses.find_one({"expense_id": expense_id, "business_id": user["business_id"]})
    if not existing:
        raise HTTPException(status_code=404, detail="Expense not found")
    updates = {
        "amount": round(data.amount, 2),
        "category": data.category,
        "date": data.date or existing["date"],
        "description": data.description or "",
        "payment_method": data.payment_method,
        "notes": data.notes or "",
        "updated_at": now_iso(),
    }
    await db.expenses.update_one({"expense_id": expense_id}, {"$set": updates})
    await log_audit(user["business_id"], user, "expense.updated", "expense", expense_id, f"{data.category} · {updates['amount']}")
    doc = await db.expenses.find_one({"expense_id": expense_id}, {"_id": 0})
    await try_post(post_expense(user["business_id"], user, doc, replace=True))
    return expense_public(doc)


@router.delete("/{expense_id}")
async def delete_expense(expense_id: str, user: dict = Depends(require_perm("expenses.delete"))):
    existing = await db.expenses.find_one({"expense_id": expense_id, "business_id": user["business_id"]})
    if not existing:
        raise HTTPException(status_code=404, detail="Expense not found")
    await db.expenses.delete_one({"expense_id": expense_id, "business_id": user["business_id"]})
    await log_audit(user["business_id"], user, "expense.deleted", "expense", expense_id, "")
    await try_post(reverse_expense(user["business_id"], user, existing))
    return {"ok": True}
