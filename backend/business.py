from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from core import db, get_current_user, require_perm, log_audit, now_iso, CURRENCIES, COUNTRY_CODES, DATE_FORMATS, NUMBER_FORMATS

router = APIRouter(prefix="/api/business", tags=["business"])

TIMEZONES = [
    "UTC", "Asia/Damascus", "Asia/Riyadh", "Asia/Dubai", "Africa/Cairo",
    "Asia/Amman", "Asia/Baghdad", "Asia/Beirut", "Asia/Kuwait", "Asia/Qatar",
    "Asia/Bahrain", "Asia/Muscat", "Asia/Aden", "Europe/Istanbul",
    "Europe/London", "Europe/Berlin", "America/New_York",
]

BUSINESS_TYPES = ["retail", "ecommerce", "services", "food", "wholesale", "other"]


class SetupInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    base_currency: str
    timezone: str = "UTC"
    country: Optional[str] = None
    date_format: Optional[str] = None
    number_format: Optional[str] = None


class BusinessUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    business_type: Optional[str] = None
    base_currency: Optional[str] = None
    timezone: Optional[str] = None
    country: Optional[str] = None
    date_format: Optional[str] = None
    number_format: Optional[str] = None
    allow_negative_stock: Optional[bool] = None
    cash_opening: Optional[float] = Field(default=None, ge=0)
    lock_timeout_minutes: Optional[int] = None


def biz_public(b: dict) -> dict:
    return {k: b.get(k) for k in (
        "business_id", "name", "business_type", "base_currency", "timezone",
        "country", "date_format", "number_format",
        "allow_negative_stock", "cash_opening", "setup_completed", "created_at",
        "lock_timeout_minutes",
    )} | {"pin_enabled": bool(b.get("pin_hash"))}


@router.get("")
async def get_business(user: dict = Depends(get_current_user)):
    b = await db.businesses.find_one({"business_id": user["business_id"]}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Business not found")
    return biz_public(b)


@router.post("/setup")
async def setup_business(data: SetupInput, user: dict = Depends(require_perm("settings.business"))):
    if data.base_currency not in CURRENCIES:
        raise HTTPException(status_code=400, detail="Unsupported currency")
    if data.country is not None and data.country not in COUNTRY_CODES:
        raise HTTPException(status_code=400, detail="Unsupported country")
    if data.date_format is not None and data.date_format not in DATE_FORMATS:
        raise HTTPException(status_code=400, detail="Invalid date format")
    if data.number_format is not None and data.number_format not in NUMBER_FORMATS:
        raise HTTPException(status_code=400, detail="Invalid number format")
    bid = user["business_id"]
    await db.businesses.update_one(
        {"business_id": bid},
        {"$set": {
            "name": data.name.strip(),
            "base_currency": data.base_currency,
            "timezone": data.timezone,
            "country": data.country,
            "date_format": data.date_format or "dmy",
            "number_format": data.number_format or "western",
            "setup_completed": True,
            "updated_at": now_iso(),
        }},
    )
    await log_audit(bid, user, "business.updated", "business", bid, "Business setup completed")
    return biz_public(await db.businesses.find_one({"business_id": bid}, {"_id": 0}))


_UPDATE_RULES = (
    ("base_currency", CURRENCIES, "Unsupported currency"),
    ("country", COUNTRY_CODES, "Unsupported country"),
    ("date_format", DATE_FORMATS, "Invalid date format"),
    ("number_format", NUMBER_FORMATS, "Invalid number format"),
    ("business_type", BUSINESS_TYPES, "Invalid business type"),
)


def _validate_business_updates(updates: dict) -> None:
    for field, allowed, detail in _UPDATE_RULES:
        if field in updates and updates[field] not in allowed:
            raise HTTPException(status_code=400, detail=detail)
    if "lock_timeout_minutes" in updates and updates["lock_timeout_minutes"] not in (0, 5, 10, 15, 30):
        raise HTTPException(status_code=400, detail="Invalid lock timeout")


@router.put("")
async def update_business(data: BusinessUpdate, user: dict = Depends(require_perm("settings.business"))):
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    _validate_business_updates(updates)
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    updates["updated_at"] = now_iso()
    bid = user["business_id"]
    await db.businesses.update_one({"business_id": bid}, {"$set": updates})
    await log_audit(bid, user, "business.updated", "business", bid, ", ".join(f"{k}={v}" for k, v in updates.items() if k != "updated_at"))
    return biz_public(await db.businesses.find_one({"business_id": bid}, {"_id": 0}))
