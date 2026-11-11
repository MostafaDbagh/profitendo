import os
import uuid
import logging
from pathlib import Path
from datetime import datetime, timezone, timedelta, date as dt_date
from typing import Optional

import bcrypt
import jwt
from dotenv import load_dotenv
from fastapi import HTTPException, Request, Depends, Response
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ReturnDocument

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

logger = logging.getLogger(__name__)

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_DAYS = 7

CURRENCIES = ["USD", "EUR", "GBP", "SAR", "AED", "EGP", "SYP", "JOD", "IQD", "LBP", "KWD", "QAR", "BHD", "OMR", "YER", "TRY"]

COUNTRY_CODES = ["SY", "SA", "AE", "EG", "JO", "IQ", "LB", "KW", "QA", "BH", "OM", "YE", "TR", "US", "GB", "XX"]
DATE_FORMATS = ["dmy", "mdy", "ymd"]
NUMBER_FORMATS = ["western", "european", "arabic"]

PERMISSION_KEYS = [
    "products.view", "products.create", "products.edit", "products.delete", "products.costs",
    "sales.view", "sales.create", "sales.edit", "sales.cancel",
    "purchases.view", "purchases.create", "purchases.edit", "purchases.cancel",
    "inventory.view", "inventory.adjust",
    "returns.view", "returns.create", "returns.edit", "returns.cancel",
    "expenses.view", "expenses.create", "expenses.edit", "expenses.delete",
    "finance.profit", "finance.margin", "finance.reports",
    "cash.view", "cash.close",
    "salaries.view",
    "withdrawals.view", "withdrawals.manage",
    "employees.view", "employees.manage",
    "partners.view", "partners.manage",
    "users.manage", "permissions.manage", "settings.business",
    "accounts.view", "accounts.manage",
    "audit.view",
]

# Old broad keys -> new granular keys (used to migrate stored overrides)
KEY_MIGRATION = {
    "products.manage": ["products.create", "products.edit", "products.delete"],
    "finance.view": ["products.costs", "finance.profit", "finance.margin"],
    "purchases.manage": ["purchases.create", "purchases.edit", "purchases.cancel"],
    "returns.manage": ["returns.create", "returns.edit", "returns.cancel"],
    "expenses.manage": ["expenses.create", "expenses.edit", "expenses.delete"],
    "reports.financial": ["finance.reports"],
    "settings.manage": ["settings.business"],
    "employees.manage": ["employees.manage", "users.manage", "permissions.manage"],
}


def _role(perms: set) -> dict:
    return {k: (k in perms) for k in PERMISSION_KEYS}


ROLE_DEFAULTS = {
    "OWNER": {k: True for k in PERMISSION_KEYS},
    "MANAGER": _role({
        "products.view", "products.create", "products.edit", "products.delete",
        "sales.view", "sales.create", "sales.edit", "sales.cancel",
        "purchases.view", "purchases.create", "purchases.edit", "purchases.cancel",
        "inventory.view", "inventory.adjust",
        "returns.view", "returns.create", "returns.edit", "returns.cancel",
        "cash.view", "cash.close",
        "accounts.view",
    }),
    "EMPLOYEE": _role({
        "products.view",
        "inventory.view",
        "sales.view", "sales.create",
        "returns.view", "returns.create",
    }),
    "ACCOUNTANT": _role({
        "products.costs",
        "finance.profit", "finance.margin", "finance.reports",
        "expenses.view", "expenses.create", "expenses.edit", "expenses.delete",
        "cash.view",
        "withdrawals.view",
        "accounts.view", "accounts.manage",
    }),
}


def effective_permissions(user: dict) -> dict:
    role = user.get("role", "OWNER")
    if role == "OWNER":
        return {k: True for k in PERMISSION_KEYS}
    base = dict(ROLE_DEFAULTS.get(role, ROLE_DEFAULTS["EMPLOYEE"]))
    for k, v in (user.get("permission_overrides") or {}).items():
        if k in base:
            base[k] = bool(v)
    return base


# ---------- Auth ----------

def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(days=ACCESS_TOKEN_DAYS),
        "type": "access",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def set_auth_cookie(response: Response, user_id: str, email: str):
    token = create_access_token(user_id, email)
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=ACCESS_TOKEN_DAYS * 24 * 3600,
        path="/",
    )


def public_user(user: dict) -> dict:
    biz = user.get("business") or {}
    return {
        "user_id": user["user_id"],
        "email": user["email"],
        "name": user.get("name", ""),
        "picture": user.get("picture"),
        "language": user.get("language", "ar"),
        "role": user.get("role", "OWNER"),
        "username": user.get("username"),
        "has_password": bool(user.get("password_hash")),
        "business_id": user.get("business_id"),
        "permissions": effective_permissions(user),
        "business": {
            "name": biz.get("name", ""),
            "base_currency": biz.get("base_currency", "USD"),
            "timezone": biz.get("timezone", "UTC"),
            "country": biz.get("country"),
            "date_format": biz.get("date_format", "dmy"),
            "number_format": biz.get("number_format", "western"),
            "setup_completed": biz.get("setup_completed", False),
            "allow_negative_stock": biz.get("allow_negative_stock", False),
            "pin_enabled": bool(biz.get("pin_hash")),
            "lock_timeout_minutes": biz.get("lock_timeout_minutes", 0),
        } if biz else None,
        "created_at": user.get("created_at"),
    }


async def _attach_context(user: dict) -> dict:
    if user.get("business_id"):
        user["business"] = await db.businesses.find_one({"business_id": user["business_id"]}, {"_id": 0})
    user["permissions"] = effective_permissions(user)
    return user


async def _user_from_jwt(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
    except Exception:
        return None
    if payload.get("type") != "access":
        return None
    return await db.users.find_one({"user_id": payload.get("sub")}, {"_id": 0})


async def _user_from_session_token(token: str) -> Optional[dict]:
    doc = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not doc:
        return None
    exp = doc.get("expires_at")
    if isinstance(exp, str):
        try:
            exp = datetime.fromisoformat(exp)
        except ValueError:
            return None
    if exp and exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp and exp < datetime.now(timezone.utc):
        return None
    return await db.users.find_one({"user_id": doc.get("user_id")}, {"_id": 0})


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if token:
        user = await _user_from_jwt(token)
        if user:
            return await _attach_context(user)
    session_token = request.cookies.get("session_token")
    if session_token:
        user = await _user_from_session_token(session_token)
        if user:
            return await _attach_context(user)
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        value = auth_header[7:]
        user = await _user_from_jwt(value)
        if not user:
            user = await _user_from_session_token(value)
        if user:
            return await _attach_context(user)
    raise HTTPException(status_code=401, detail="Not authenticated")


def require_perm(*keys):
    async def dep(user: dict = Depends(get_current_user)):
        perms = user.get("permissions") or {}
        if not any(perms.get(k) for k in keys):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return dep


def can_finance(user: dict) -> bool:
    caps = caps_of(user)
    return caps["costs"] and caps["profit"]


def caps_of(user: dict) -> dict:
    perms = user.get("permissions") or {}
    return {
        "costs": bool(perms.get("products.costs")),
        "profit": bool(perms.get("finance.profit")),
        "margin": bool(perms.get("finance.margin")),
    }


# ---------- Owner PIN ----------

def create_pin_token(user_id: str, business_id: str) -> str:
    payload = {
        "sub": user_id,
        "biz": business_id,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=30),
        "type": "pin",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


async def pin_ok(request: Request, user: dict) -> bool:
    biz = user.get("business") or {}
    if not biz.get("pin_hash"):
        return True
    token = request.headers.get("X-Pin-Token")
    if not token:
        return False
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
    except Exception:
        return False
    return (
        payload.get("type") == "pin"
        and payload.get("sub") == user.get("user_id")
        and payload.get("biz") == user.get("business_id")
    )


async def pin_guard(request: Request, user: dict = Depends(get_current_user)):
    if await pin_ok(request, user):
        return user
    raise HTTPException(status_code=403, detail="PIN_REQUIRED")


def require_edit_pin(user: dict, pin: Optional[str]) -> None:
    biz = user.get("business") or {}
    if biz.get("pin_hash"):
        if not pin or not verify_password(pin, biz["pin_hash"]):
            raise HTTPException(status_code=401, detail="INVALID_PIN")
        return
    if user.get("password_hash"):
        if not pin or not verify_password(pin, user["password_hash"]):
            raise HTTPException(status_code=401, detail="INVALID_PIN")
        return
    raise HTTPException(status_code=400, detail="PIN_SETUP_REQUIRED")


# ---------- Helpers ----------

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def log_audit(business_id: str, user: dict, action: str, entity: str, entity_id: str, summary: str = ""):
    await db.audit_logs.insert_one({
        "log_id": f"log_{uuid.uuid4().hex[:12]}",
        "business_id": business_id,
        "user_id": user.get("user_id"),
        "user_name": user.get("name", ""),
        "action": action,
        "entity": entity,
        "entity_id": entity_id,
        "summary": summary,
        "created_at": now_iso(),
    })


NUMBER_PREFIX = {"sale": "S", "purchase": "P", "return": "R", "journal": "J", "purchase_return": "PR"}


async def next_number(business_id: str, kind: str) -> str:
    doc = await db.counters.find_one_and_update(
        {"_id": f"{business_id}:{kind}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return f"{NUMBER_PREFIX[kind]}-{doc['seq']:04d}"


async def compute_cash_balance(business_id: str) -> float:
    biz = await db.businesses.find_one({"business_id": business_id}, {"_id": 0, "cash_opening": 1})
    opening = (biz or {}).get("cash_opening", 0) or 0
    sales = await db.sales.find({"business_id": business_id, "status": "confirmed", "payment_method": "cash"}, {"_id": 0, "total": 1}).to_list(100000)
    returns = await db.returns.find({"business_id": business_id, "refund_method": "cash"}, {"_id": 0, "refund_total": 1}).to_list(100000)
    expenses = await db.expenses.find({"business_id": business_id, "payment_method": "cash"}, {"_id": 0, "amount": 1}).to_list(100000)
    withdrawals = await db.withdrawals.find({"business_id": business_id, "source": "cash"}, {"_id": 0, "amount": 1}).to_list(100000)
    balance = (
        opening
        + sum(s.get("total", 0) for s in sales)
        - sum(r.get("refund_total", 0) for r in returns)
        - sum(e.get("amount", 0) for e in expenses)
        - sum(w.get("amount", 0) for w in withdrawals)
    )
    return round(balance, 2)


# ---------- Product metrics ----------

def _opt_unit(p: dict, field: str, qty: float) -> float:
    v = p.get(field, 0) or 0
    if p.get(f"{field}_mode", "unit") == "total":
        return (v / qty) if qty > 0 else 0
    return v


def _age_days(launch) -> Optional[int]:
    if not launch:
        return None
    try:
        ld = dt_date.fromisoformat(str(launch)[:10])
        return max(0, (datetime.now(timezone.utc).date() - ld).days)
    except ValueError:
        return None


def compute_metrics(p: dict) -> dict:
    qty = p.get("quantity_sold", 0) or 0
    price = p.get("selling_price", 0) or 0
    product_cost = p.get("product_cost", 0) or 0

    shipping_u = _opt_unit(p, "shipping_cost", qty)
    ads_u = _opt_unit(p, "advertising_cost", qty)
    fee_u = _opt_unit(p, "payment_fee", qty)
    other_u = _opt_unit(p, "other_costs", qty)
    disc_v = p.get("discount", 0) or 0
    discount_u = price * disc_v / 100 if p.get("discount_mode", "unit") == "percent" else disc_v

    unit_cost = product_cost + shipping_u + ads_u + fee_u + discount_u + other_u
    revenue = price * qty
    total_costs = unit_cost * qty
    net_profit = revenue - total_costs
    margin = (net_profit / revenue * 100) if revenue > 0 else 0
    launch = p.get("launch_date")
    return {
        **p,
        "launch_date": launch or None,
        "age_days": _age_days(launch),
        "unit_cost": round(unit_cost, 2),
        "unit_profit": round(price - unit_cost, 2),
        "revenue": round(revenue, 2),
        "total_costs": round(total_costs, 2),
        "net_profit": round(net_profit, 2),
        "profit_margin": round(margin, 2),
        "breakdown": {
            "product_cost": round(product_cost, 2),
            "shipping": round(shipping_u, 2),
            "advertising": round(ads_u, 2),
            "payment_fee": round(fee_u, 2),
            "discount": round(discount_u, 2),
            "other": round(other_u, 2),
        },
    }


PRODUCT_COST_FIELDS = [
    "product_cost", "shipping_cost", "advertising_cost", "payment_fee", "discount", "other_costs",
    "unit_cost", "total_costs",
]
PRODUCT_PROFIT_FIELDS = ["net_profit", "unit_profit"]
PRODUCT_MARGIN_FIELDS = ["profit_margin"]


def product_public(doc: dict, caps: Optional[dict] = None) -> dict:
    doc = {k: v for k, v in doc.items() if k != "_id"}
    doc.pop("user_id", None)
    doc.pop("business_id", None)
    out = compute_metrics(doc)
    out["stock_qty"] = doc.get("stock_qty", 0) or 0
    out["minimum_stock_level"] = doc.get("minimum_stock_level", 0) or 0
    if caps is None:
        caps = {"costs": True, "profit": True, "margin": True}
    if not caps.get("costs"):
        for f in PRODUCT_COST_FIELDS:
            out.pop(f, None)
        out.pop("breakdown", None)
    if not caps.get("profit"):
        for f in PRODUCT_PROFIT_FIELDS:
            out.pop(f, None)
        out.pop("breakdown", None)
    if not caps.get("margin"):
        for f in PRODUCT_MARGIN_FIELDS:
            out.pop(f, None)
    return out
