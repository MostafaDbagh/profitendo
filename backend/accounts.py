import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import db, require_perm, log_audit, now_iso

router = APIRouter(prefix="/api/accounts", tags=["accounts"])

ACCOUNT_GROUPS = ["assets", "liabilities", "equity", "revenue", "cost_of_sales", "expenses"]
GROUP_PATTERN = "^(assets|liabilities|equity|revenue|cost_of_sales|expenses)$"

NORMAL_BALANCE = {
    "assets": "debit",
    "liabilities": "credit",
    "equity": "credit",
    "revenue": "credit",
    "cost_of_sales": "debit",
    "expenses": "debit",
}

ACCOUNT_SUBGROUPS = {
    "assets": ["cash", "bank", "accounts_receivable", "inventory", "fixed_assets", "prepaid_expenses"],
    "liabilities": ["accounts_payable", "loans", "taxes_payable", "salaries_payable"],
    "equity": ["capital", "owner_withdrawals", "retained_earnings"],
    "revenue": ["product_sales", "service_revenue", "other_revenue"],
    "cost_of_sales": ["cogs", "purchase_shipping", "direct_costs"],
    "expenses": ["rent", "salaries", "marketing", "transportation", "communications", "commissions", "bank_expenses"],
}

_GROUP_ROOT_CODE = {"assets": 1000, "liabilities": 2000, "equity": 3000, "revenue": 4000, "cost_of_sales": 5000, "expenses": 6000}

_GROUP_ROOT_NAME = {
    "assets": "Assets", "liabilities": "Liabilities", "equity": "Equity",
    "revenue": "Revenue", "cost_of_sales": "Cost of Sales", "expenses": "Expenses",
}

_SUBGROUP_NAME = {
    "cash": "Cash", "bank": "Bank", "accounts_receivable": "Accounts Receivable", "inventory": "Inventory",
    "fixed_assets": "Fixed Assets", "prepaid_expenses": "Prepaid Expenses",
    "accounts_payable": "Accounts Payable", "loans": "Loans", "taxes_payable": "Taxes Payable",
    "salaries_payable": "Salaries Payable",
    "capital": "Capital", "owner_withdrawals": "Owner Withdrawals", "retained_earnings": "Retained Earnings",
    "product_sales": "Product Sales", "service_revenue": "Service Revenue", "other_revenue": "Other Revenue",
    "cogs": "Cost of Goods Sold", "purchase_shipping": "Purchase Shipping", "direct_costs": "Direct Costs",
    "rent": "Rent", "salaries": "Salaries", "marketing": "Marketing", "transportation": "Transportation",
    "communications": "Communications", "commissions": "Commissions", "bank_expenses": "Bank Expenses",
}


class AccountInput(BaseModel):
    code: str = Field(min_length=1, max_length=20, pattern=r"^[A-Za-z0-9\-]+$")
    name: str = Field(min_length=1, max_length=120)
    group: str = Field(pattern=GROUP_PATTERN)
    subgroup: Optional[str] = None
    parent_id: Optional[str] = None
    normal_balance: Optional[str] = Field(default=None, pattern="^(debit|credit)$")


class AccountUpdate(BaseModel):
    code: Optional[str] = Field(default=None, min_length=1, max_length=20, pattern=r"^[A-Za-z0-9\-]+$")
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    subgroup: Optional[str] = None
    parent_id: Optional[str] = None
    normal_balance: Optional[str] = Field(default=None, pattern="^(debit|credit)$")
    is_active: Optional[bool] = None


def account_public(doc: dict) -> dict:
    return {
        "account_id": doc["account_id"],
        "code": doc["code"],
        "name": doc["name"],
        "group": doc["group"],
        "subgroup": doc.get("subgroup"),
        "parent_id": doc.get("parent_id"),
        "normal_balance": doc["normal_balance"],
        "is_active": doc.get("is_active", True),
        "is_system": doc.get("is_system", False),
        "created_at": doc.get("created_at"),
    }


async def seed_accounts(bid: str) -> None:
    if await db.accounts.count_documents({"business_id": bid}, limit=1):
        return
    now = now_iso()
    docs = []
    for group in ACCOUNT_GROUPS:
        root_code = _GROUP_ROOT_CODE[group]
        root_id = f"acct_{uuid.uuid4().hex[:12]}"
        docs.append({
            "account_id": root_id,
            "business_id": bid,
            "code": str(root_code),
            "name": _GROUP_ROOT_NAME[group],
            "group": group,
            "subgroup": None,
            "parent_id": None,
            "normal_balance": NORMAL_BALANCE[group],
            "is_active": True,
            "is_system": True,
            "created_at": now,
            "updated_at": now,
        })
        for i, sub in enumerate(ACCOUNT_SUBGROUPS[group], start=1):
            docs.append({
                "account_id": f"acct_{uuid.uuid4().hex[:12]}",
                "business_id": bid,
                "code": str(root_code + i * 100),
                "name": _SUBGROUP_NAME[sub],
                "group": group,
                "subgroup": sub,
                "parent_id": root_id,
                "normal_balance": NORMAL_BALANCE[group],
                "is_active": True,
                "is_system": True,
                "created_at": now,
                "updated_at": now,
            })
    await db.accounts.insert_many(docs)


async def _depth(bid: str, account: dict) -> int:
    depth = 0
    cur = account
    while cur.get("parent_id"):
        depth += 1
        cur = await db.accounts.find_one({"account_id": cur["parent_id"], "business_id": bid})
        if not cur or depth > 3:
            break
    return depth


async def _validate_parent(bid: str, parent_id: str, group: str, self_id: Optional[str] = None) -> dict:
    parent = await db.accounts.find_one({"account_id": parent_id, "business_id": bid})
    if not parent:
        raise HTTPException(status_code=400, detail="Parent account not found")
    if self_id and parent_id == self_id:
        raise HTTPException(status_code=400, detail="Account cannot be its own parent")
    if parent["group"] != group:
        raise HTTPException(status_code=400, detail="Parent must be in the same account group")
    if not parent.get("is_active", True):
        raise HTTPException(status_code=400, detail="Parent account is inactive")
    if self_id:
        cur = parent
        hops = 0
        while cur and cur.get("parent_id"):
            if cur["parent_id"] == self_id:
                raise HTTPException(status_code=400, detail="Cannot move an account under its own child")
            cur = await db.accounts.find_one({"account_id": cur["parent_id"], "business_id": bid})
            hops += 1
            if hops > 4:
                break
    if await _depth(bid, parent) >= 2:
        raise HTTPException(status_code=400, detail="Maximum account depth reached")
    return parent


def _validate_subgroup(group: str, subgroup: Optional[str]) -> Optional[str]:
    if subgroup is None:
        return None
    if subgroup not in ACCOUNT_SUBGROUPS.get(group, []):
        raise HTTPException(status_code=400, detail="Invalid subgroup for this account group")
    return subgroup


@router.get("")
async def list_accounts(user: dict = Depends(require_perm("accounts.view"))):
    bid = user["business_id"]
    await seed_accounts(bid)
    docs = await db.accounts.find({"business_id": bid}).sort("code", 1).to_list(1000)
    return [account_public(d) for d in docs]


@router.post("", status_code=201)
async def create_account(data: AccountInput, user: dict = Depends(require_perm("accounts.manage"))):
    bid = user["business_id"]
    await seed_accounts(bid)
    code = data.code.strip()
    name = data.name.strip()
    if await db.accounts.find_one({"business_id": bid, "code": code}):
        raise HTTPException(status_code=400, detail="Account number already exists")
    if data.parent_id:
        await _validate_parent(bid, data.parent_id, data.group)
    subgroup = _validate_subgroup(data.group, data.subgroup)
    now = now_iso()
    doc = {
        "account_id": f"acct_{uuid.uuid4().hex[:12]}",
        "business_id": bid,
        "code": code,
        "name": name,
        "group": data.group,
        "subgroup": subgroup,
        "parent_id": data.parent_id,
        "normal_balance": data.normal_balance or NORMAL_BALANCE[data.group],
        "is_active": True,
        "is_system": False,
        "created_at": now,
        "updated_at": now,
    }
    await db.accounts.insert_one(doc)
    await log_audit(bid, user, "account.created", "account", doc["account_id"], f"{code} · {name}")
    return account_public(doc)


async def _system_updates(acct: dict, data: AccountUpdate) -> dict:
    if data.model_dump(exclude_none=True).keys() - {"is_active"}:
        raise HTTPException(status_code=400, detail="Default accounts can only be activated or deactivated")
    return {}


async def _custom_updates(bid: str, acct: dict, data: AccountUpdate) -> dict:
    updates = {}
    if data.name is not None:
        updates["name"] = data.name.strip()
    if data.code is not None:
        code = data.code.strip()
        clash = await db.accounts.find_one({"business_id": bid, "code": code, "account_id": {"$ne": acct["account_id"]}})
        if clash:
            raise HTTPException(status_code=400, detail="Account number already exists")
        updates["code"] = code
    if data.subgroup is not None:
        updates["subgroup"] = _validate_subgroup(acct["group"], data.subgroup)
    if data.normal_balance is not None:
        updates["normal_balance"] = data.normal_balance
    if data.parent_id is not None:
        await _validate_parent(bid, data.parent_id, acct["group"], self_id=acct["account_id"])
        updates["parent_id"] = data.parent_id
    return updates


@router.put("/{account_id}")
async def update_account(account_id: str, data: AccountUpdate, user: dict = Depends(require_perm("accounts.manage"))):
    bid = user["business_id"]
    acct = await db.accounts.find_one({"account_id": account_id, "business_id": bid})
    if not acct:
        raise HTTPException(status_code=404, detail="Account not found")
    updates = {}
    if data.is_active is not None:
        updates["is_active"] = data.is_active
    if acct.get("is_system"):
        updates.update(await _system_updates(acct, data))
    else:
        updates.update(await _custom_updates(bid, acct, data))
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    updates["updated_at"] = now_iso()
    await db.accounts.update_one({"account_id": account_id}, {"$set": updates})
    await log_audit(bid, user, "account.updated", "account", account_id, f"{acct['code']} · {', '.join(k for k in updates if k != 'updated_at')}")
    doc = await db.accounts.find_one({"account_id": account_id})
    return account_public(doc)


@router.delete("/{account_id}")
async def delete_account(account_id: str, user: dict = Depends(require_perm("accounts.manage"))):
    bid = user["business_id"]
    acct = await db.accounts.find_one({"account_id": account_id, "business_id": bid})
    if not acct:
        raise HTTPException(status_code=404, detail="Account not found")
    if acct.get("is_system"):
        raise HTTPException(status_code=400, detail="Default accounts cannot be deleted; deactivate instead")
    if await db.accounts.count_documents({"business_id": bid, "parent_id": account_id}, limit=1):
        raise HTTPException(status_code=400, detail="Account has child accounts; deactivate instead")
    linked = await db.journal_entries.count_documents(
        {"business_id": bid, "$or": [{"lines.account_id": account_id}, {"account_id": account_id}]}, limit=1
    )
    if linked:
        raise HTTPException(status_code=400, detail="Account has linked journal entries; deactivate instead")
    await db.accounts.delete_one({"account_id": account_id})
    await log_audit(bid, user, "account.deleted", "account", account_id, f"{acct['code']} · {acct['name']}")
    return {"ok": True}
