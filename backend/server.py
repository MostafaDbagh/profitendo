import os
import uuid
import logging
from datetime import datetime, timezone, timedelta, date as dt_date
from typing import Optional

import httpx
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends
from starlette.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, EmailStr, model_validator

from core import (
    db, client, hash_password, verify_password, set_auth_cookie, public_user,
    get_current_user, require_perm, can_finance, caps_of, product_public, log_audit,
    now_iso, compute_cash_balance, create_pin_token, pin_guard, CURRENCIES,
)

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


# ---------- Input models ----------

class RegisterInput(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    password: str = Field(min_length=6, max_length=100)


class LoginInput(BaseModel):
    email: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=1)


class LanguageInput(BaseModel):
    language: str = Field(pattern="^(ar|en)$")


class ProductInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    sku: Optional[str] = ""
    selling_price: Optional[float] = Field(default=None, ge=0)
    product_cost: float = Field(ge=0)
    currency: Optional[str] = None
    shipping_cost: float = Field(ge=0, default=0)
    shipping_cost_mode: str = Field(default="unit", pattern="^(unit|total)$")
    advertising_cost: float = Field(ge=0, default=0)
    advertising_cost_mode: str = Field(default="unit", pattern="^(unit|total)$")
    payment_fee: float = Field(ge=0, default=0)
    payment_fee_mode: str = Field(default="unit", pattern="^(unit|total)$")
    discount: float = Field(ge=0, default=0)
    discount_mode: str = Field(default="unit", pattern="^(unit|percent)$")
    other_costs: float = Field(ge=0, default=0)
    other_costs_mode: str = Field(default="unit", pattern="^(unit|total)$")
    minimum_stock_level: int = Field(ge=0, default=0)
    launch_date: Optional[str] = None
    spec_quantity: Optional[float] = Field(default=None, ge=0)
    spec_unit: Optional[str] = None

    @model_validator(mode="after")
    def check_discount(self):
        if self.discount_mode == "percent" and self.discount > 100:
            raise ValueError("Percentage discount must be between 0 and 100")
        if self.currency and self.currency not in CURRENCIES:
            raise ValueError("Invalid currency")
        if self.spec_unit:
            self.spec_unit = self.spec_unit.strip() or None
            if self.spec_unit and len(self.spec_unit) > 30:
                raise ValueError("spec_unit must be at most 30 characters")
        if self.launch_date:
            try:
                dt_date.fromisoformat(str(self.launch_date)[:10])
            except ValueError:
                raise ValueError("launch_date must be a valid date (YYYY-MM-DD)")
        return self


# ---------- Auth routes ----------

@api_router.post("/auth/register")
async def register(data: RegisterInput, response: Response):
    email = data.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    business_id = f"biz_{uuid.uuid4().hex[:12]}"
    now = now_iso()
    biz = {
        "business_id": business_id,
        "name": data.name.strip(),
        "owner_user_id": user_id,
        "base_currency": "USD",
        "timezone": "UTC",
        "allow_negative_stock": False,
        "cash_opening": 0,
        "setup_completed": False,
        "created_at": now,
        "updated_at": now,
    }
    await db.businesses.insert_one(biz)
    doc = {
        "user_id": user_id,
        "email": email,
        "name": data.name.strip(),
        "password_hash": hash_password(data.password),
        "picture": None,
        "language": "ar",
        "business_id": business_id,
        "role": "OWNER",
        "permission_overrides": {},
        "status": "active",
        "created_at": now,
    }
    await db.users.insert_one(doc)
    doc["business"] = biz
    await log_audit(business_id, doc, "user.registered", "user", user_id, email)
    set_auth_cookie(response, user_id, email)
    return public_user(doc)


@api_router.post("/auth/login")
async def login(data: LoginInput, request: Request, response: Response):
    email = data.email.lower().strip()
    identifier = email
    attempt = await db.login_attempts.find_one({"identifier": identifier}, {"_id": 0})
    if attempt and attempt.get("count", 0) >= 5:
        locked_until = attempt.get("locked_until")
        if locked_until:
            locked_until = datetime.fromisoformat(locked_until)
            if locked_until.tzinfo is None:
                locked_until = locked_until.replace(tzinfo=timezone.utc)
            if locked_until > datetime.now(timezone.utc):
                raise HTTPException(status_code=429, detail="Too many failed attempts. Try again in 15 minutes.")
        await db.login_attempts.delete_one({"identifier": identifier})
        attempt = None
    user = await db.users.find_one({"$or": [{"email": email}, {"username": email}]}, {"_id": 0})
    if not user or not user.get("password_hash") or not verify_password(data.password, user["password_hash"]):
        new_count = (attempt.get("count", 0) if attempt else 0) + 1
        update = {"$inc": {"count": 1}}
        if new_count >= 5:
            update["$set"] = {"locked_until": (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()}
        await db.login_attempts.update_one({"identifier": identifier}, update, upsert=True)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    await db.login_attempts.delete_one({"identifier": identifier})
    if user.get("business_id"):
        user["business"] = await db.businesses.find_one({"business_id": user["business_id"]}, {"_id": 0})
        await log_audit(user["business_id"], user, "user.login", "user", user["user_id"], email)
    set_auth_cookie(response, user["user_id"], email)
    return public_user(user)


@api_router.post("/auth/google/session")
async def google_session(request: Request, response: Response):
    session_id = request.headers.get("X-Session-ID")
    if not session_id:
        raise HTTPException(status_code=400, detail="Missing session id")
    try:
        async with httpx.AsyncClient(timeout=10) as http_client:
            r = await http_client.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": session_id},
            )
    except Exception:
        raise HTTPException(status_code=502, detail="Auth provider unreachable")
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session")
    data = r.json()
    email = data["email"].lower().strip()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if user:
        await db.users.update_one(
            {"email": email},
            {"$set": {"name": data.get("name", user.get("name", "")), "picture": data.get("picture")}},
        )
        user = await db.users.find_one({"email": email}, {"_id": 0})
    else:
        now = now_iso()
        business_id = f"biz_{uuid.uuid4().hex[:12]}"
        await db.businesses.insert_one({
            "business_id": business_id,
            "name": data.get("name", ""),
            "owner_user_id": None,
            "base_currency": "USD",
            "timezone": "UTC",
            "allow_negative_stock": False,
            "cash_opening": 0,
            "setup_completed": False,
            "created_at": now,
            "updated_at": now,
        })
        user = {
            "user_id": f"user_{uuid.uuid4().hex[:12]}",
            "email": email,
            "name": data.get("name", ""),
            "picture": data.get("picture"),
            "password_hash": None,
            "language": "ar",
            "business_id": business_id,
            "role": "OWNER",
            "permission_overrides": {},
            "status": "active",
            "created_at": now,
        }
        await db.users.insert_one(user)
        await db.businesses.update_one({"business_id": business_id}, {"$set": {"owner_user_id": user["user_id"]}})
    if user.get("business_id"):
        user["business"] = await db.businesses.find_one({"business_id": user["business_id"]}, {"_id": 0})
        await log_audit(user["business_id"], user, "user.login", "user", user["user_id"], email)
    await db.user_sessions.insert_one(
        {
            "user_id": user["user_id"],
            "session_token": data["session_token"],
            "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
            "created_at": datetime.now(timezone.utc),
        }
    )
    set_auth_cookie(response, user["user_id"], email)
    response.set_cookie(
        key="session_token",
        value=data["session_token"],
        httponly=True,
        secure=True,
        samesite="none",
        max_age=7 * 24 * 3600,
        path="/",
    )
    return public_user(user)


@api_router.get("/auth/me")
async def auth_me(user: dict = Depends(get_current_user)):
    return public_user(user)


@api_router.post("/auth/logout")
async def logout(request: Request, response: Response):
    session_token = request.cookies.get("session_token")
    if session_token:
        await db.user_sessions.delete_many({"session_token": session_token})
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("session_token", path="/")
    return {"ok": True}


@api_router.put("/auth/language")
async def set_language(data: LanguageInput, user: dict = Depends(get_current_user)):
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"language": data.language}})
    return {"language": data.language}


# ---------- Owner PIN & session unlock ----------

class PinInput(BaseModel):
    pin: str = Field(pattern="^\\d{4,8}$")


class UnlockInput(BaseModel):
    password: Optional[str] = None
    pin: Optional[str] = None


@api_router.post("/auth/pin")
async def set_pin(data: PinInput, user: dict = Depends(require_perm("settings.business"))):
    await db.businesses.update_one(
        {"business_id": user["business_id"]},
        {"$set": {"pin_hash": hash_password(data.pin), "updated_at": now_iso()}},
    )
    await log_audit(user["business_id"], user, "pin.updated", "business", user["business_id"], "Owner PIN set/changed")
    return {"pin_enabled": True}


@api_router.delete("/auth/pin")
async def clear_pin(user: dict = Depends(require_perm("settings.business"))):
    await db.businesses.update_one(
        {"business_id": user["business_id"]},
        {"$unset": {"pin_hash": ""}, "$set": {"updated_at": now_iso()}},
    )
    await log_audit(user["business_id"], user, "pin.cleared", "business", user["business_id"], "Owner PIN removed")
    return {"pin_enabled": False}


@api_router.post("/auth/pin/verify")
async def verify_pin(data: PinInput, user: dict = Depends(get_current_user)):
    biz = user.get("business") or {}
    if not biz.get("pin_hash") or not verify_password(data.pin, biz["pin_hash"]):
        raise HTTPException(status_code=401, detail="Invalid PIN")
    return {"pin_token": create_pin_token(user["user_id"], user["business_id"])}


@api_router.post("/auth/unlock")
async def unlock_session(data: UnlockInput, user: dict = Depends(get_current_user)):
    ok = False
    if data.password and user.get("password_hash"):
        ok = verify_password(data.password, user["password_hash"])
    if not ok and data.pin:
        biz = user.get("business") or {}
        if biz.get("pin_hash"):
            ok = verify_password(data.pin, biz["pin_hash"])
    if not ok:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return {"ok": True}


# ---------- Kiosk / user-selection flow ----------

class SwitchUserInput(BaseModel):
    user_id: str
    password: Optional[str] = None
    pin: Optional[str] = None


class KioskLoginInput(BaseModel):
    username: str = Field(min_length=3, max_length=30)
    password: str = Field(min_length=1)


@api_router.get("/auth/kiosk/users")
async def kiosk_users(user: dict = Depends(get_current_user)):
    members = await db.users.find(
        {"business_id": user["business_id"], "$or": [{"status": "active"}, {"status": {"$exists": False}}]},
        {"_id": 0, "user_id": 1, "name": 1, "picture": 1, "password_hash": 1},
    ).to_list(500)
    return [
        {"user_id": m["user_id"], "name": m.get("name", ""), "picture": m.get("picture"), "has_password": bool(m.get("password_hash"))}
        for m in members
    ]


@api_router.post("/auth/switch-user")
async def switch_user(data: SwitchUserInput, response: Response, user: dict = Depends(get_current_user)):
    bid = user["business_id"]
    target = await db.users.find_one({"user_id": data.user_id, "business_id": bid}, {"_id": 0})
    if not target or target.get("status", "active") != "active":
        raise HTTPException(status_code=404, detail="User not found")
    ok = False
    if data.password and target.get("password_hash"):
        ok = verify_password(data.password, target["password_hash"])
    if not ok and data.pin:
        biz = user.get("business") or {}
        if biz.get("pin_hash"):
            ok = verify_password(data.pin, biz["pin_hash"])
    if not ok:
        biz = user.get("business") or {}
        if not target.get("password_hash") and not biz.get("pin_hash"):
            raise HTTPException(status_code=403, detail="PASSWORD_SETUP_REQUIRED")
        raise HTTPException(status_code=401, detail="Invalid credentials")
    set_auth_cookie(response, target["user_id"], target["email"])
    await log_audit(bid, target, "user.switch", "user", target["user_id"], f"selected by {user.get('name', '')}")
    target["business"] = await db.businesses.find_one({"business_id": bid}, {"_id": 0})
    return public_user(target)


class SetPasswordInput(BaseModel):
    user_id: str
    password: str = Field(min_length=6, max_length=100)


@api_router.post("/auth/set-password")
async def set_first_password(data: SetPasswordInput, response: Response, user: dict = Depends(get_current_user)):
    bid = user["business_id"]
    target = await db.users.find_one({"user_id": data.user_id, "business_id": bid}, {"_id": 0})
    if not target or target.get("status", "active") != "active":
        raise HTTPException(status_code=404, detail="User not found")
    if target.get("password_hash"):
        raise HTTPException(status_code=400, detail="Password already set")
    await db.users.update_one({"user_id": target["user_id"]}, {"$set": {"password_hash": hash_password(data.password)}})
    await log_audit(bid, user, "user.password_set", "user", target["user_id"], f"first password set for {target.get('name', '')}")
    set_auth_cookie(response, target["user_id"], target["email"])
    target["business"] = await db.businesses.find_one({"business_id": bid}, {"_id": 0})
    return public_user(target)


class OwnerSetupInput(BaseModel):
    username: str = Field(min_length=3, max_length=30, pattern="^[a-zA-Z0-9_.-]{3,30}$")
    password: str = Field(min_length=6, max_length=100)


@api_router.get("/auth/setup-state")
async def setup_state():
    admin_email = os.environ["ADMIN_EMAIL"].lower().strip()
    owner = await db.users.find_one({"email": admin_email}, {"_id": 0, "password_hash": 1})
    return {"setup_required": not (owner and owner.get("password_hash"))}


@api_router.post("/auth/owner-setup")
async def owner_setup(data: OwnerSetupInput, response: Response):
    admin_email = os.environ["ADMIN_EMAIL"].lower().strip()
    owner = await db.users.find_one({"email": admin_email}, {"_id": 0})
    if not owner:
        raise HTTPException(status_code=404, detail="Owner not found")
    if owner.get("password_hash"):
        raise HTTPException(status_code=400, detail="Setup already completed")
    uname = data.username.lower().strip()
    clash = await db.users.find_one({"username": uname, "user_id": {"$ne": owner["user_id"]}})
    if clash:
        raise HTTPException(status_code=400, detail="Username already taken")
    await db.users.update_one(
        {"user_id": owner["user_id"]},
        {"$set": {"username": uname, "password_hash": hash_password(data.password)}},
    )
    await log_audit(owner["business_id"], owner, "user.password_set", "user", owner["user_id"], "owner initial setup")
    set_auth_cookie(response, owner["user_id"], owner["email"])
    owner["username"] = uname
    owner["business"] = await db.businesses.find_one({"business_id": owner["business_id"]}, {"_id": 0})
    return public_user(owner)


class KioskSetPasswordInput(BaseModel):
    username: str = Field(min_length=3, max_length=30)
    password: str = Field(min_length=6, max_length=100)


@api_router.post("/auth/kiosk-set-password")
async def kiosk_set_password(data: KioskSetPasswordInput, response: Response):
    username = data.username.lower().strip()
    target = await db.users.find_one({"username": username}, {"_id": 0})
    if not target or target.get("status", "active") != "active":
        raise HTTPException(status_code=404, detail="User not found")
    if target.get("password_hash"):
        raise HTTPException(status_code=400, detail="Password already set")
    await db.users.update_one({"user_id": target["user_id"]}, {"$set": {"password_hash": hash_password(data.password)}})
    await log_audit(target["business_id"], target, "user.password_set", "user", target["user_id"], f"kiosk first setup: {username}")
    set_auth_cookie(response, target["user_id"], target["email"])
    if target.get("business_id"):
        target["business"] = await db.businesses.find_one({"business_id": target["business_id"]}, {"_id": 0})
    return public_user(target)


@api_router.post("/auth/kiosk-login")
async def kiosk_login(data: KioskLoginInput, response: Response):
    username = data.username.lower().strip()
    identifier = f"kiosk:{username}"
    attempt = await db.login_attempts.find_one({"identifier": identifier}, {"_id": 0})
    if attempt and attempt.get("count", 0) >= 5:
        locked_until = attempt.get("locked_until")
        if locked_until:
            locked_until = datetime.fromisoformat(locked_until)
            if locked_until.tzinfo is None:
                locked_until = locked_until.replace(tzinfo=timezone.utc)
            if locked_until > datetime.now(timezone.utc):
                raise HTTPException(status_code=429, detail="Too many failed attempts. Try again in 15 minutes.")
        await db.login_attempts.delete_one({"identifier": identifier})
        attempt = None
    target = await db.users.find_one({"username": username}, {"_id": 0})
    if target and target.get("status", "active") == "active" and not target.get("password_hash"):
        raise HTTPException(status_code=403, detail="PASSWORD_SETUP_REQUIRED")
    ok = bool(
        target
        and target.get("status", "active") == "active"
        and target.get("password_hash")
        and verify_password(data.password, target["password_hash"])
    )
    if not ok:
        new_count = (attempt.get("count", 0) if attempt else 0) + 1
        update = {"$inc": {"count": 1}}
        if new_count >= 5:
            update["$set"] = {"locked_until": (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()}
        await db.login_attempts.update_one({"identifier": identifier}, update, upsert=True)
        raise HTTPException(status_code=401, detail="Invalid username or password")
    await db.login_attempts.delete_one({"identifier": identifier})
    set_auth_cookie(response, target["user_id"], target["email"])
    if target.get("business_id"):
        target["business"] = await db.businesses.find_one({"business_id": target["business_id"]}, {"_id": 0})
        await log_audit(target["business_id"], target, "user.login", "user", target["user_id"], f"kiosk: {username}")
    return public_user(target)


# ---------- Product routes ----------

def product_doc(data: ProductInput, user: dict) -> dict:
    now = now_iso()
    d = data.model_dump()
    d["sku"] = (d.get("sku") or "").strip()
    d["currency"] = (d.get("currency") or "").strip() or None
    d["launch_date"] = (d.get("launch_date") or "").strip() or None
    d["spec_unit"] = (d.get("spec_unit") or "").strip() or None
    return {
        "product_id": f"prod_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "business_id": user["business_id"],
        **d,
        "stock_qty": 0,
        "is_demo": False,
        "created_at": now,
        "updated_at": now,
    }


@api_router.get("/products")
async def list_products(user: dict = Depends(require_perm("products.view"))):
    docs = await db.products.find({"business_id": user["business_id"], "archived": {"$ne": True}}, {"_id": 0}).to_list(2000)
    caps = caps_of(user)
    return [product_public(d, caps) for d in docs]


@api_router.post("/products", status_code=201)
async def create_product(data: ProductInput, user: dict = Depends(require_perm("products.create"))):
    doc = product_doc(data, user)
    await db.products.insert_one(doc)
    await log_audit(user["business_id"], user, "product.created", "product", doc["product_id"], doc["name"])
    return product_public(doc, caps_of(user))


@api_router.get("/products/{product_id}")
async def get_product(product_id: str, user: dict = Depends(require_perm("products.view"))):
    doc = await db.products.find_one({"product_id": product_id, "business_id": user["business_id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Product not found")
    return product_public(doc, caps_of(user))


@api_router.put("/products/{product_id}")
async def update_product(product_id: str, data: ProductInput, user: dict = Depends(require_perm("products.edit"))):
    existing = await db.products.find_one({"product_id": product_id, "business_id": user["business_id"]}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Product not found")
    updates = data.model_dump()
    updates["sku"] = (updates.get("sku") or "").strip()
    updates["currency"] = (updates.get("currency") or "").strip() or None
    updates["launch_date"] = (updates.get("launch_date") or "").strip() or None
    updates["spec_unit"] = (updates.get("spec_unit") or "").strip() or None
    updates["updated_at"] = now_iso()
    await db.products.update_one({"product_id": product_id}, {"$set": updates})
    old_cost = existing.get("product_cost", 0) or 0
    new_cost = updates.get("product_cost", 0) or 0
    summary = updates["name"]
    action = "product.updated"
    if old_cost != new_cost:
        action = "product.cost_changed"
        summary = f"{updates['name']} · cost {old_cost}→{new_cost}"
    await log_audit(user["business_id"], user, action, "product", product_id, summary)
    doc = await db.products.find_one({"product_id": product_id}, {"_id": 0})
    return product_public(doc, caps_of(user))


@api_router.delete("/products/{product_id}")
async def delete_product(product_id: str, user: dict = Depends(require_perm("products.delete"))):
    result = await db.products.delete_one({"product_id": product_id, "business_id": user["business_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Product not found")
    await log_audit(user["business_id"], user, "product.deleted", "product", product_id, "")
    return {"ok": True}


# ---------- Dashboard ----------

@api_router.get("/dashboard")
async def dashboard(user: dict = Depends(get_current_user)):
    bid = user["business_id"]
    perms = user.get("permissions") or {}
    caps = caps_of(user)
    fin = caps["costs"] and caps["profit"] and caps["margin"]
    docs = await db.products.find({"business_id": bid}, {"_id": 0}).to_list(2000)
    products = [product_public(d, caps) for d in docs]

    total_sales = sum(p["revenue"] for p in products)
    low_stock = [
        p for p in products
        if (p.get("minimum_stock_level", 0) or 0) > 0 and (p.get("stock_qty", 0) or 0) <= (p.get("minimum_stock_level", 0) or 0)
    ]
    result = {
        "total_sales": round(total_sales, 2),
        "product_count": len(products),
        "has_demo": any(p.get("is_demo") for p in products),
        "finance": fin,
        "low_stock": sorted(low_stock, key=lambda p: p.get("stock_qty", 0))[:10],
        "low_stock_count": len(low_stock),
        "products": products,
    }
    if not fin:
        return result

    total_additional_costs = sum(
        (p["unit_cost"] - p["product_cost"]) * (p.get("quantity_sold", 0) or 0) for p in products
    )

    # Per-product profitability from POSTED records only: actual sale-line revenue (net of
    # line discounts), WAC COGS captured at sale time, minus return reversals. Product master
    # cost is NEVER used here. Products whose sold lines lack a positive recorded cost are
    # flagged cost_available=False (profit/margin null) instead of showing a misleading zero.
    sale_lines = await db.sales.aggregate([
        {"$match": {"business_id": bid, "status": "confirmed"}},
        {"$unwind": "$items"},
        {"$group": {
            "_id": "$items.product_id",
            "revenue": {"$sum": "$items.total"},
            "cogs": {"$sum": {"$ifNull": ["$items.cogs", 0]}},
            "lines": {"$sum": 1},
            "lines_with_cost": {"$sum": {"$cond": [{"$gt": [{"$ifNull": ["$items.cogs", 0]}, 0]}, 1, 0]}},
        }},
    ]).to_list(5000)
    ret_lines = await db.returns.aggregate([
        {"$match": {"business_id": bid}},
        {"$unwind": "$items"},
        {"$group": {
            "_id": "$items.product_id",
            "refund": {"$sum": "$items.total"},
            "cogs_rev": {"$sum": {"$multiply": [{"$ifNull": ["$items.unit_cost", 0]}, "$items.quantity"]}},
        }},
    ]).to_list(5000)
    posted = {}
    for r in sale_lines:
        posted[r["_id"]] = {"revenue": r["revenue"], "cogs": r["cogs"], "lines": r["lines"],
                            "lines_with_cost": r["lines_with_cost"], "refund": 0.0, "cogs_rev": 0.0}
    for r in ret_lines:
        e = posted.setdefault(r["_id"], {"revenue": 0.0, "cogs": 0.0, "lines": 0,
                                         "lines_with_cost": 0, "refund": 0.0, "cogs_rev": 0.0})
        e["refund"] += r["refund"]
        e["cogs_rev"] += r["cogs_rev"]
    for p in products:
        a = posted.get(p["product_id"])
        if not a:
            continue
        net_rev = round(a["revenue"] - a["refund"], 2)
        net_cogs = round(a["cogs"] - a["cogs_rev"], 2)
        p["revenue"] = net_rev
        p["cost_available"] = a["lines"] > 0 and a["lines_with_cost"] == a["lines"]
        if p["cost_available"]:
            p["actual_cogs"] = net_cogs
            p["net_profit"] = round(net_rev - net_cogs, 2)
            p["profit_margin"] = round(p["net_profit"] / net_rev * 100, 2) if net_rev > 0 else 0
        else:
            p["net_profit"] = None
            p["profit_margin"] = None

    by_profit = sorted(products, key=lambda p: (p["net_profit"] is None, -(p["net_profit"] or 0)))
    by_margin = sorted((p for p in products if p["profit_margin"] is not None), key=lambda p: p["profit_margin"])
    avg_qty = (sum((p.get("quantity_sold", 0) or 0) for p in products) / len(products)) if products else 0
    volume_low_margin = [p for p in sorted(products, key=lambda p: (p.get("quantity_sold", 0) or 0), reverse=True)
                         if (p.get("quantity_sold", 0) or 0) >= avg_qty
                         and p["profit_margin"] is not None and p["profit_margin"] < 15][:5]

    sales = await db.sales.find({"business_id": bid, "status": "confirmed"}, {"_id": 0}).to_list(10000)
    returns = await db.returns.find({"business_id": bid}, {"_id": 0}).to_list(10000)
    expenses = await db.expenses.find({"business_id": bid}, {"_id": 0}).to_list(10000)
    sales_revenue = sum(s["total"] for s in sales)  # Σ posted invoices only
    cogs = sum(s.get("cogs", 0) for s in sales)     # Σ posted COGS records (weighted cost at sale time)
    refunds = sum(r["refund_total"] for r in returns)
    cogs_reversed = sum(r.get("cogs_reversed", 0) for r in returns)
    cogs_net = round(cogs - cogs_reversed, 2)
    gross_profit = sales_revenue - refunds - cogs_net
    expenses_total = sum(e["amount"] for e in expenses)
    inventory_value = sum((d.get("stock_qty", 0) or 0) * (d.get("product_cost", 0) or 0) for d in docs)

    # KPI source audit: Total Sales and COGS are independent pipelines.
    # total_sales := Σ confirmed invoice totals (NEVER derived from costs)
    # total_product_costs := Σ posted COGS records (NEVER derived from sales)
    total_sales = sales_revenue
    total_product_costs = cogs_net
    net_profit = total_sales - refunds - cogs_net - total_additional_costs
    margin = (net_profit / total_sales * 100) if total_sales > 0 else 0

    result.update({
        "total_sales": round(total_sales, 2),
        "total_product_costs": round(total_product_costs, 2),
        "total_additional_costs": round(total_additional_costs, 2),
        "net_profit": round(net_profit, 2),
        "profit_margin": round(margin, 2),
        "top_profitable": by_profit[:5],
        "lowest_margin": by_margin[:5],
        "volume_low_margin": volume_low_margin,
        "sales_revenue": round(sales_revenue, 2),
        "cogs": cogs_net,
        "gross_profit": round(gross_profit, 2),
        "operating_expenses": round(expenses_total, 2),
        "net_profit_business": round(gross_profit - expenses_total, 2),
        "inventory_value": round(inventory_value, 2) if caps["costs"] else None,
        "returns_count": len(returns),
        "returns_total": round(refunds, 2) if caps["profit"] else None,
        "cash_balance": (await compute_cash_balance(bid)) if perms.get("cash.view") else None,
    })
    return result


# ---------- Demo data ----------

@api_router.get("/dashboard/drilldown")
async def dashboard_drilldown(metric: str, user: dict = Depends(get_current_user)):
    """Source records behind each dashboard KPI — everything derived live from the DB."""
    bid = user["business_id"]
    caps = caps_of(user)
    fin = caps["costs"] and caps["profit"] and caps["margin"]

    if metric == "total_sales":
        rows = await db.sales.find({"business_id": bid, "status": "confirmed"},
                                   {"_id": 0, "sale_number": 1, "date": 1, "customer": 1, "total": 1, "payment_method": 1}).sort("created_at", -1).to_list(500)
        return {"metric": metric, "rows": rows}
    if metric == "cogs":
        if not fin:
            raise HTTPException(status_code=403, detail="Not authorized")
        rows = await db.sales.find({"business_id": bid, "status": "confirmed", "cogs": {"$gt": 0}},
                                   {"_id": 0, "sale_number": 1, "date": 1, "cogs": 1, "total": 1}).sort("created_at", -1).to_list(500)
        return {"metric": metric, "rows": rows}
    if metric == "additional_costs":
        if not fin:
            raise HTTPException(status_code=403, detail="Not authorized")
        docs = await db.products.find({"business_id": bid}, {"_id": 0}).to_list(2000)
        products = [product_public(d, caps) for d in docs]
        rows = [{"name": p["name"], "quantity_sold": p.get("quantity_sold", 0) or 0,
                 "additional_per_unit": round(p["unit_cost"] - p["product_cost"], 2),
                 "total": round((p["unit_cost"] - p["product_cost"]) * (p.get("quantity_sold", 0) or 0), 2)}
                for p in products if (p["unit_cost"] - p["product_cost"]) > 0 and (p.get("quantity_sold", 0) or 0) > 0]
        return {"metric": metric, "rows": sorted(rows, key=lambda r: -r["total"])}
    if metric in ("net_profit", "profit_margin"):
        if not fin:
            raise HTTPException(status_code=403, detail="Not authorized")
        sales = await db.sales.find({"business_id": bid, "status": "confirmed"}, {"_id": 0}).to_list(10000)
        returns = await db.returns.find({"business_id": bid}, {"_id": 0}).to_list(10000)
        expenses = await db.expenses.find({"business_id": bid}, {"_id": 0}).to_list(10000)
        docs = await db.products.find({"business_id": bid}, {"_id": 0}).to_list(2000)
        products = [product_public(d, caps) for d in docs]
        revenue = round(sum(s["total"] for s in sales), 2)
        refunds = round(sum(r["refund_total"] for r in returns), 2)
        cogs_net = round(sum(s.get("cogs", 0) for s in sales) - sum(r.get("cogs_reversed", 0) for r in returns), 2)
        additional = round(sum((p["unit_cost"] - p["product_cost"]) * (p.get("quantity_sold", 0) or 0) for p in products), 2)
        expenses_total = round(sum(e["amount"] for e in expenses), 2)
        net = round(revenue - refunds - cogs_net - additional, 2)
        net_business = round(revenue - refunds - cogs_net - expenses_total, 2)
        return {"metric": metric, "rows": [], "summary": {
            "sales_revenue": revenue, "refunds": refunds, "cogs_net": cogs_net,
            "additional_costs": additional, "operating_expenses": expenses_total,
            "net_profit": net, "net_profit_business": net_business,
            "profit_margin": round(net / revenue * 100, 2) if revenue > 0 else 0,
        }}
    if metric == "inventory_value":
        if not caps["costs"]:
            raise HTTPException(status_code=403, detail="Not authorized")
        docs = await db.products.find({"business_id": bid}, {"_id": 0, "name": 1, "sku": 1, "stock_qty": 1, "product_cost": 1}).to_list(2000)
        rows = [{"name": d["name"], "sku": d.get("sku", ""), "stock_qty": d.get("stock_qty", 0) or 0,
                 "product_cost": d.get("product_cost", 0) or 0,
                 "value": round((d.get("stock_qty", 0) or 0) * (d.get("product_cost", 0) or 0), 2)}
                for d in docs if (d.get("stock_qty", 0) or 0) != 0]
        return {"metric": metric, "rows": sorted(rows, key=lambda r: -r["value"])}
    if metric == "cash_balance":
        if not (user.get("permissions") or {}).get("cash.view") and user.get("role") != "OWNER":
            raise HTTPException(status_code=403, detail="Not authorized")
        balance = await compute_cash_balance(bid)
        closings = await db.cash_closings.find({"business_id": bid}, {"_id": 0}).sort("created_at", -1).to_list(50)
        return {"metric": metric, "rows": closings, "summary": {"balance": balance}}
    if metric == "returns":
        rows = await db.returns.find({"business_id": bid}, {"_id": 0, "return_number": 1, "return_date": 1, "refund_total": 1, "reason": 1, "status": 1}).sort("created_at", -1).to_list(500)
        return {"metric": metric, "rows": rows}
    if metric == "low_stock":
        docs = await db.products.find({"business_id": bid}, {"_id": 0, "name": 1, "sku": 1, "stock_qty": 1, "minimum_stock_level": 1}).to_list(2000)
        rows = [{"name": d["name"], "sku": d.get("sku", ""), "stock_qty": d.get("stock_qty", 0) or 0,
                 "minimum_stock_level": d.get("minimum_stock_level", 0) or 0}
                for d in docs if (d.get("minimum_stock_level", 0) or 0) > 0 and (d.get("stock_qty", 0) or 0) <= (d.get("minimum_stock_level", 0) or 0)]
        return {"metric": metric, "rows": sorted(rows, key=lambda r: r["stock_qty"])}
    if metric in ("top_profitable", "revenue_distribution"):
        if not fin:
            raise HTTPException(status_code=403, detail="Not authorized")
        docs = await db.products.find({"business_id": bid}, {"_id": 0}).to_list(2000)
        products = [product_public(d, caps) for d in docs]
        total_rev = sum(p["revenue"] for p in products) or 1
        rows = [{"name": p["name"], "revenue": p["revenue"], "net_profit": p["net_profit"],
                 "profit_margin": p["profit_margin"], "share": round(p["revenue"] / total_rev * 100, 2)}
                for p in products if p["revenue"] > 0]
        rows.sort(key=lambda r: -(r["net_profit"] if metric == "top_profitable" else r["revenue"]))
        return {"metric": metric, "rows": rows[:50]}
    raise HTTPException(status_code=400, detail="Unknown metric")


DEMO_PRODUCTS = [
    {"name": "Wireless Earbuds Pro", "sku": "DEMO-EAR-01", "selling_price": 45, "product_cost": 18, "shipping_cost": 3, "advertising_cost": 5, "payment_fee": 1.5, "discount": 0, "other_costs": 1, "quantity_sold": 120},
    {"name": "Organic Cotton T-Shirt", "sku": "DEMO-TSH-02", "selling_price": 25, "product_cost": 8, "shipping_cost": 2, "advertising_cost": 3, "payment_fee": 1, "discount": 2, "other_costs": 0.5, "quantity_sold": 200},
    {"name": "Smart Watch Fit", "sku": "DEMO-WCH-03", "selling_price": 89, "product_cost": 40, "shipping_cost": 4, "advertising_cost": 8, "payment_fee": 3, "discount": 5, "other_costs": 2, "quantity_sold": 65},
    {"name": "Silicone Phone Case", "sku": "DEMO-CAS-04", "selling_price": 12, "product_cost": 4, "shipping_cost": 1.5, "advertising_cost": 2.5, "payment_fee": 0.8, "discount": 1, "other_costs": 0.5, "quantity_sold": 320},
    {"name": "Ceramic Coffee Mug", "sku": "DEMO-MUG-05", "selling_price": 18, "product_cost": 6, "shipping_cost": 4, "advertising_cost": 3, "payment_fee": 1, "discount": 0, "other_costs": 1, "quantity_sold": 80},
    {"name": "Travel Backpack 30L", "sku": "DEMO-BPK-06", "selling_price": 65, "product_cost": 28, "shipping_cost": 5, "advertising_cost": 6, "payment_fee": 2.5, "discount": 0, "other_costs": 1, "quantity_sold": 45},
    {"name": "LED Desk Lamp", "sku": "DEMO-LMP-07", "selling_price": 32, "product_cost": 12, "shipping_cost": 6, "advertising_cost": 7, "payment_fee": 1.5, "discount": 3, "other_costs": 2, "quantity_sold": 110},
    {"name": "USB Charging Cable", "sku": "DEMO-CBL-08", "selling_price": 9, "product_cost": 5, "shipping_cost": 2, "advertising_cost": 2, "payment_fee": 0.5, "discount": 1, "other_costs": 0.5, "quantity_sold": 150},
]


@api_router.post("/demo/seed")
async def seed_demo(user: dict = Depends(require_perm("products.create"))):
    await db.products.delete_many({"business_id": user["business_id"], "is_demo": True})
    now = now_iso()
    docs = []
    for i, p in enumerate(DEMO_PRODUCTS):
        docs.append(
            {
                "product_id": f"prod_{uuid.uuid4().hex[:12]}",
                "user_id": user["user_id"],
                "business_id": user["business_id"],
                **p,
                "is_demo": True,
                "stock_qty": 0,
                "minimum_stock_level": 0,
                "launch_date": None,
                "created_at": now,
                "updated_at": now,
            }
        )
    await db.products.insert_many(docs)
    await log_audit(user["business_id"], user, "demo.seeded", "product", "", "8 demo products")
    return {"inserted": len(docs)}


@api_router.delete("/demo/clear")
async def clear_demo(user: dict = Depends(require_perm("products.delete"))):
    result = await db.products.delete_many({"business_id": user["business_id"], "is_demo": True})
    return {"deleted": result.deleted_count}


from imports import products_bulk_router as _products_bulk_router  # noqa: E402
from purchases_import import router as _purchases_import_router  # noqa: E402

app.include_router(_purchases_import_router)  # before purchases router: /purchases/export.xlsx and /purchases/import/* must beat /purchases/{purchase_id}
app.include_router(_products_bulk_router)  # before api_router: /products/export.xlsx must beat /products/{product_id}
app.include_router(api_router)

from business import router as business_router
from team import router as team_router
from inventory import router as inventory_router
from purchases import router as purchases_router
from sales import router as sales_router
from returns import router as returns_router
from expenses import router as expenses_router
from cash import router as cash_router
from partners import router as partners_router
from reports import router as reports_router
from audit import router as audit_router
from assistant import router as assistant_router
from subscriptions import router as subscriptions_router
from accounts import router as accounts_router
from ledger import router as ledger_router
from password_reset import router as password_reset_router
from imports import router as imports_router, products_bulk_router
from sales_import import router as sales_import_router
from purchase_returns import router as purchase_returns_router
from backup import router as backup_router
from onboarding import router as onboarding_router
from reset import router as reset_router
from drafts import router as drafts_router

for _r in (
    business_router, team_router, inventory_router, purchases_router, sales_router,
    returns_router, expenses_router, cash_router, partners_router, reports_router, audit_router,
    assistant_router, subscriptions_router, accounts_router, ledger_router, password_reset_router,
    imports_router, products_bulk_router, sales_import_router, purchase_returns_router,
    backup_router, onboarding_router, reset_router, drafts_router,
):
    app.include_router(_r)

frontend_url = os.environ.get("FRONTEND_URL", "")
origins = [o for o in os.environ.get("CORS_ORIGINS", "").split(",") if o and o != "*"]
if frontend_url:
    origins.append(frontend_url)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=(origins if origins else ["http://localhost:3000"]),
    allow_methods=["*"],
    allow_headers=["*"],
)


async def seed_admin():
    admin_email = os.environ["ADMIN_EMAIL"].lower().strip()
    admin_password = os.environ["ADMIN_PASSWORD"]
    existing = await db.users.find_one({"email": admin_email})
    if existing is None:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        bid = f"biz_{uuid.uuid4().hex[:12]}"
        now = now_iso()
        await db.businesses.insert_one({
            "business_id": bid,
            "name": "Rabee Al Sofrage",
            "owner_user_id": user_id,
            "base_currency": "USD",
            "timezone": "UTC",
            "allow_negative_stock": False,
            "cash_opening": 0,
            "setup_completed": True,
            "created_at": now,
            "updated_at": now,
        })
        await db.users.insert_one(
            {
                "user_id": user_id,
                "email": admin_email,
                "name": "Rabee Al Sofrage",
                "password_hash": hash_password(admin_password),
                "picture": None,
                "role": "OWNER",
                "business_id": bid,
                "permission_overrides": {},
                "status": "active",
                "language": "ar",
                "created_at": now,
            }
        )
        logger.info("Admin user seeded")


async def migrate_businesses():
    await db.users.update_many({"role": "admin"}, {"$set": {"role": "OWNER"}})
    async for u in db.users.find({"business_id": {"$exists": False}}):
        bid = f"biz_{uuid.uuid4().hex[:12]}"
        now = now_iso()
        await db.businesses.insert_one({
            "business_id": bid,
            "name": u.get("name", "My Business"),
            "owner_user_id": u["user_id"],
            "base_currency": "USD",
            "timezone": "UTC",
            "allow_negative_stock": False,
            "cash_opening": 0,
            "setup_completed": True,
            "created_at": now,
            "updated_at": now,
        })
        await db.users.update_one({"user_id": u["user_id"]}, {"$set": {"business_id": bid, "role": "OWNER"}})
        logger.info(f"Migrated user {u.get('email')} -> business {bid}")
    async for u in db.users.find({"business_id": {"$exists": True}, "role": {"$exists": False}}):
        await db.users.update_one({"user_id": u["user_id"]}, {"$set": {"role": "OWNER"}})
    # migrate old broad permission override keys to granular keys
    from core import KEY_MIGRATION, PERMISSION_KEYS
    async for u in db.users.find({"permission_overrides": {"$exists": True, "$ne": {}}}):
        old = u.get("permission_overrides") or {}
        new = {}
        changed = False
        for k, v in old.items():
            if k in PERMISSION_KEYS:
                new[k] = v
            elif k in KEY_MIGRATION:
                changed = True
                for nk in KEY_MIGRATION[k]:
                    new[nk] = v
            else:
                changed = True
        if changed:
            await db.users.update_one({"user_id": u["user_id"]}, {"$set": {"permission_overrides": new}})
    async for p in db.products.find({"business_id": {"$exists": False}}):
        owner = await db.users.find_one({"user_id": p.get("user_id")}, {"_id": 0, "business_id": 1})
        if owner and owner.get("business_id"):
            await db.products.update_one(
                {"_id": p["_id"]},
                {"$set": {
                    "business_id": owner["business_id"],
                    "stock_qty": p.get("stock_qty", 0) or 0,
                    "minimum_stock_level": p.get("minimum_stock_level", 0) or 0,
                }},
            )
    await db.products.update_many(
        {"stock_qty": {"$exists": False}},
        {"$set": {"stock_qty": 0, "minimum_stock_level": 0}},
    )


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.products.create_index("user_id")
    await db.products.create_index("business_id")
    await db.login_attempts.create_index("identifier")
    await db.businesses.create_index("business_id", unique=True)
    await db.inventory_movements.create_index("business_id")
    await db.sales.create_index("business_id")
    await db.purchases.create_index("business_id")
    _ref_filter = {"client_ref": {"$type": "string"}}
    await db.sales.create_index([("business_id", 1), ("client_ref", 1)], unique=True, partialFilterExpression=_ref_filter)
    await db.purchases.create_index([("business_id", 1), ("client_ref", 1)], unique=True, partialFilterExpression=_ref_filter)
    await db.returns.create_index([("business_id", 1), ("client_ref", 1)], unique=True, partialFilterExpression=_ref_filter)
    await db.purchase_returns.create_index([("business_id", 1), ("client_ref", 1)], unique=True, partialFilterExpression=_ref_filter)
    await db.invoice_drafts.create_index([("business_id", 1), ("user_id", 1), ("kind", 1)], unique=True)
    await db.returns.create_index("business_id")
    await db.expenses.create_index("business_id")
    await db.withdrawals.create_index("business_id")
    await db.partners.create_index("business_id")
    await db.reset_requests.create_index("email")
    await db.reset_requests.create_index("ip")
    await db.reset_requests.create_index("created_at", expireAfterSeconds=3600)
    await db.reset_requests.create_index("created_at", expireAfterSeconds=3600)
    await db.journal_entries.create_index("business_id")
    await db.journal_entries.create_index(
        [("business_id", 1), ("source_type", 1), ("source_id", 1)],
        unique=True,
        partialFilterExpression={"kind": "posted", "is_reversed": False},
        name="uniq_active_source_entry",
    )
    await db.audit_logs.create_index("business_id")
    try:
        await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    except Exception:
        pass
    await seed_admin()
    await migrate_businesses()


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
