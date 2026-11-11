import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import db, get_current_user, now_iso

router = APIRouter(prefix="/api/drafts", tags=["drafts"])

DRAFT_KINDS = {"sale", "purchase", "sale_return", "purchase_return"}


class DraftInput(BaseModel):
    payload: dict


def _key(kind: str, user: dict) -> dict:
    if kind not in DRAFT_KINDS:
        raise HTTPException(status_code=404, detail="Unknown draft kind")
    return {"business_id": user["business_id"], "user_id": user["user_id"], "kind": kind}


@router.put("/{kind}")
async def save_draft(kind: str, data: DraftInput, user: dict = Depends(get_current_user)):
    key = _key(kind, user)
    now = now_iso()
    await db.invoice_drafts.update_one(
        key,
        {
            "$set": {**key, "payload": data.payload, "updated_at": now},
            "$setOnInsert": {"draft_id": f"drf_{uuid.uuid4().hex[:12]}", "created_at": now},
        },
        upsert=True,
    )
    return {"ok": True, "updated_at": now}


@router.get("/{kind}")
async def get_draft(kind: str, user: dict = Depends(get_current_user)):
    key = _key(kind, user)
    doc = await db.invoice_drafts.find_one(key, {"_id": 0, "payload": 1, "updated_at": 1})
    return {"payload": (doc or {}).get("payload"), "updated_at": (doc or {}).get("updated_at")}


@router.delete("/{kind}")
async def delete_draft(kind: str, user: dict = Depends(get_current_user)):
    await db.invoice_drafts.delete_one(_key(kind, user))
    return {"ok": True}
