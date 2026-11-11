from fastapi import APIRouter, Depends, Query

from core import db, require_perm

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("")
async def list_audit(limit: int = Query(default=200), user: dict = Depends(require_perm("audit.view"))):
    limit = max(1, min(limit, 500))
    docs = await db.audit_logs.find(
        {"business_id": user["business_id"]},
        {"_id": 0, "business_id": 0},
    ).sort("created_at", -1).to_list(limit)
    return docs
