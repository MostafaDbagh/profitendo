from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import db, get_current_user, log_audit, now_iso

router = APIRouter(prefix="/api/onboarding", tags=["onboarding"])

SKIPPABLE_STEPS = {"business", "products", "opening", "first_action"}


class OnboardingUpdate(BaseModel):
    step: Optional[int] = Field(default=None, ge=0, le=5)
    status: Optional[str] = Field(default=None, pattern="^(in_progress|skipped|completed)$")
    skip_step: Optional[str] = None


async def detect_progress(business_id: str, biz: dict) -> dict:
    products = await db.products.count_documents({"business_id": business_id, "archived": {"$ne": True}})
    sales = await db.sales.count_documents({"business_id": business_id})
    purchases = await db.purchases.count_documents({"business_id": business_id})
    expenses = await db.expenses.count_documents({"business_id": business_id})
    return {
        "business": bool(biz.get("setup_completed")),
        "products": products > 0,
        "opening": bool(biz.get("cash_opening")),
        "first_transaction": (sales + purchases + expenses) > 0,
        "operational_data": (products + sales + purchases + expenses) > 0,
    }


def _payload(ob: dict, checklist: dict) -> dict:
    return {
        "required": ob.get("status") == "in_progress",
        "step": ob.get("step", 0),
        "status": ob.get("status", "in_progress"),
        "skipped_steps": ob.get("skipped_steps", []),
        "checklist": {k: v for k, v in checklist.items() if k != "operational_data"},
    }


@router.get("")
async def get_onboarding(user: dict = Depends(get_current_user)):
    biz = await db.businesses.find_one({"business_id": user["business_id"]}) or {}
    checklist = await detect_progress(user["business_id"], biz)
    ob = user.get("onboarding")
    if not ob:
        status = "auto_bypassed" if checklist["operational_data"] else "in_progress"
        ob = {"step": 0, "status": status, "skipped_steps": [], "updated_at": now_iso()}
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"onboarding": ob}})
    return _payload(ob, checklist)


@router.put("")
async def update_onboarding(data: OnboardingUpdate, user: dict = Depends(get_current_user)):
    if data.skip_step is not None and data.skip_step not in SKIPPABLE_STEPS:
        raise HTTPException(status_code=400, detail="Invalid skip step")
    biz = await db.businesses.find_one({"business_id": user["business_id"]}) or {}
    checklist = await detect_progress(user["business_id"], biz)
    ob = user.get("onboarding") or {"step": 0, "status": "in_progress", "skipped_steps": []}

    updates = {}
    if data.step is not None:
        ob["step"] = data.step
        updates["onboarding.step"] = data.step
    if data.status is not None:
        ob["status"] = data.status
        updates["onboarding.status"] = data.status
    if data.skip_step:
        skipped = list({*ob.get("skipped_steps", []), data.skip_step})
        ob["skipped_steps"] = skipped
        updates["onboarding.skipped_steps"] = skipped
    updates["onboarding.updated_at"] = now_iso()
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": updates})
    if data.status in ("completed", "skipped"):
        await log_audit(user["business_id"], user, f"onboarding.{data.status}", "user", user["user_id"], "")
    return _payload(ob, checklist)


@router.post("/restart")
async def restart_onboarding(user: dict = Depends(get_current_user)):
    ob = {"step": 0, "status": "in_progress", "skipped_steps": [], "updated_at": now_iso()}
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"onboarding": ob}})
    biz = await db.businesses.find_one({"business_id": user["business_id"]}) or {}
    checklist = await detect_progress(user["business_id"], biz)
    await log_audit(user["business_id"], user, "onboarding.restarted", "user", user["user_id"], "")
    return _payload(ob, checklist)
