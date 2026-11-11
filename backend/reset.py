from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from accounts import seed_accounts
from core import db, get_current_user, log_audit, now_iso

router = APIRouter(prefix="/api/business", tags=["business"])

CONFIRM_PHRASE = "DELETE ALL DATA"

# All business operational collections. KEEP: users, businesses, subscriptions,
# subscription_payments, webhook_events, audit_logs, login_attempts, reset_requests, user_sessions.
WIPE_COLLECTIONS = [
    "sales", "returns", "purchases", "purchase_returns", "expenses",
    "inventory_movements", "cash_closings", "withdrawals",
    "partners", "partner_transactions", "products",
    "journal_entries", "accounts", "assistant_messages",
]


class ResetInput(BaseModel):
    confirmation: str


@router.delete("/data")
async def reset_business_data(data: ResetInput, user: dict = Depends(get_current_user)):
    if user.get("role") != "OWNER":
        raise HTTPException(status_code=403, detail="Only the owner can reset company data")
    if data.confirmation != CONFIRM_PHRASE:
        raise HTTPException(status_code=400, detail="Invalid confirmation phrase")
    bid = user["business_id"]

    deleted = {}
    for name in WIPE_COLLECTIONS:
        res = await db[name].delete_many({"business_id": bid})
        deleted[name] = res.deleted_count
    await db.counters.delete_many({"_id": {"$regex": f"^{bid}:"}})
    await db.businesses.update_one({"business_id": bid}, {"$set": {"cash_opening": 0}})
    await seed_accounts(bid)
    await db.users.update_many(
        {"business_id": bid},
        {"$set": {"onboarding": {"step": 0, "status": "in_progress", "skipped_steps": [], "updated_at": now_iso()}}},
    )
    await log_audit(bid, user, "business.data_reset", "business", bid, f"Collections wiped: {deleted}")
    return {"ok": True, "deleted": deleted}
