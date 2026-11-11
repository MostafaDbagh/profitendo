import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from core import db, require_perm, log_audit, now_iso, pin_guard

router = APIRouter(prefix="/api/partners", tags=["partners"])

TXN_TYPES = "^(allocation|withdrawal|contribution)$"


class PartnerInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    ownership_percentage: float = Field(ge=0, le=100)
    notes: Optional[str] = ""
    status: str = Field(default="active", pattern="^(active|inactive)$")
    paid_in_capital: Optional[float] = Field(default=0, ge=0)
    capital_currency: Optional[str] = "USD"


class PartnerTxnInput(BaseModel):
    type: str = Field(pattern=TXN_TYPES)
    amount: float = Field(gt=0)
    date: Optional[str] = None
    notes: Optional[str] = ""


def partner_public(doc: dict) -> dict:
    return {k: v for k, v in doc.items() if k not in ("_id", "business_id")}


@router.get("")
async def list_partners(user: dict = Depends(require_perm("partners.view")), _pin: dict = Depends(pin_guard)):
    docs = await db.partners.find({"business_id": user["business_id"]}, {"_id": 0}).to_list(200)
    out = []
    for p in docs:
        txns = await db.partner_transactions.find({"partner_id": p["partner_id"]}, {"_id": 0}).to_list(1000)
        balance = sum(
            t["amount"] if t["type"] in ("allocation", "contribution") else -t["amount"]
            for t in txns
        )
        out.append({**partner_public(p), "balance": round(balance, 2), "transaction_count": len(txns)})
    return out


@router.post("", status_code=201)
async def create_partner(data: PartnerInput, user: dict = Depends(require_perm("partners.manage")), _pin: dict = Depends(pin_guard)):
    doc = {
        "partner_id": f"prt_{uuid.uuid4().hex[:12]}",
        "business_id": user["business_id"],
        "name": data.name.strip(),
        "ownership_percentage": data.ownership_percentage,
        "paid_in_capital": round(data.paid_in_capital or 0, 2),
        "capital_currency": data.capital_currency or "USD",
        "notes": data.notes or "",
        "status": data.status,
        "created_at": now_iso(),
    }
    await db.partners.insert_one(doc)
    await log_audit(user["business_id"], user, "partner.created", "partner", doc["partner_id"], doc["name"])
    return partner_public(doc)


@router.put("/{partner_id}")
async def update_partner(partner_id: str, data: PartnerInput, user: dict = Depends(require_perm("partners.manage")), _pin: dict = Depends(pin_guard)):
    bid = user["business_id"]
    p = await db.partners.find_one({"partner_id": partner_id, "business_id": bid})
    if not p:
        raise HTTPException(status_code=404, detail="Partner not found")
    updates = {
        "name": data.name.strip(),
        "ownership_percentage": data.ownership_percentage,
        "paid_in_capital": round(data.paid_in_capital or 0, 2),
        "capital_currency": data.capital_currency or "USD",
        "notes": data.notes or "",
        "status": data.status,
    }
    await db.partners.update_one({"partner_id": partner_id}, {"$set": updates})
    await log_audit(bid, user, "partner.updated", "partner", partner_id, updates["name"])
    return {**partner_public(p), **updates}


@router.get("/{partner_id}")
async def get_partner(partner_id: str, user: dict = Depends(require_perm("partners.view")), _pin: dict = Depends(pin_guard)):
    p = await db.partners.find_one({"partner_id": partner_id, "business_id": user["business_id"]}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Partner not found")
    txns = await db.partner_transactions.find({"partner_id": partner_id}, {"_id": 0, "business_id": 0}).sort("created_at", -1).to_list(1000)
    balance = sum(t["amount"] if t["type"] in ("allocation", "contribution") else -t["amount"] for t in txns)
    return {**partner_public(p), "transactions": txns, "balance": round(balance, 2)}


@router.post("/{partner_id}/transactions", status_code=201)
async def create_partner_txn(partner_id: str, data: PartnerTxnInput, user: dict = Depends(require_perm("partners.manage")), _pin: dict = Depends(pin_guard)):
    bid = user["business_id"]
    p = await db.partners.find_one({"partner_id": partner_id, "business_id": bid})
    if not p:
        raise HTTPException(status_code=404, detail="Partner not found")
    now = now_iso()
    doc = {
        "txn_id": f"ptx_{uuid.uuid4().hex[:12]}",
        "business_id": bid,
        "partner_id": partner_id,
        "type": data.type,
        "amount": round(data.amount, 2),
        "date": data.date or now[:10],
        "notes": data.notes or "",
        "created_by": user["user_id"],
        "created_by_name": user.get("name", ""),
        "created_at": now,
    }
    await db.partner_transactions.insert_one(doc)
    await log_audit(bid, user, "partner.transaction.created", "partner", partner_id, f"{p['name']} · {data.type} · {doc['amount']}")
    doc.pop("_id", None)
    doc.pop("business_id", None)
    return doc
