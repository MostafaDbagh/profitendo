import uuid
import re
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel, Field

from core import (
    db, require_perm, log_audit, now_iso, hash_password, pin_ok,
    effective_permissions, PERMISSION_KEYS, ROLE_DEFAULTS, KEY_MIGRATION,
)

router = APIRouter(prefix="/api/team", tags=["team"])

USERNAME_PATTERN = "^[a-zA-Z0-9_.-]{3,30}$"


async def unique_username(base: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "", (base or "").lower())[:20] or "user"
    candidate = slug
    i = 1
    while await db.users.find_one({"username": candidate}):
        i += 1
        candidate = f"{slug}{i}"
    return candidate


class EmployeeCreate(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: Optional[str] = ""
    password: Optional[str] = Field(default=None, min_length=6, max_length=100)
    role: str = Field(pattern="^(MANAGER|EMPLOYEE|ACCOUNTANT)$")
    username: Optional[str] = Field(default=None, pattern=USERNAME_PATTERN)
    phone: Optional[str] = ""
    salary: Optional[float] = Field(default=None, ge=0)
    commission: Optional[float] = Field(default=None, ge=0)
    hire_date: Optional[str] = None
    status: str = Field(default="active", pattern="^(active|inactive)$")


class EmployeeUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=80)
    phone: Optional[str] = None
    salary: Optional[float] = Field(default=None, ge=0)
    commission: Optional[float] = Field(default=None, ge=0)
    hire_date: Optional[str] = None
    status: Optional[str] = Field(default=None, pattern="^(active|inactive)$")
    role: Optional[str] = Field(default=None, pattern="^(MANAGER|EMPLOYEE|ACCOUNTANT)$")
    username: Optional[str] = Field(default=None, pattern=USERNAME_PATTERN)


class PermissionsUpdate(BaseModel):
    overrides: dict


def member_public(u: dict, include_salary: bool) -> dict:
    out = {
        "user_id": u["user_id"],
        "name": u.get("name", ""),
        "email": u.get("email", ""),
        "username": u.get("username"),
        "role": u.get("role", "EMPLOYEE"),
        "status": u.get("status", "active"),
        "phone": u.get("phone", ""),
        "hire_date": u.get("hire_date"),
        "permissions": effective_permissions(u),
        "permission_overrides": u.get("permission_overrides") or {},
        "created_at": u.get("created_at"),
    }
    if include_salary:
        out["salary"] = u.get("salary")
        out["commission"] = u.get("commission")
    return out


@router.get("")
async def list_team(request: Request, user: dict = Depends(require_perm("employees.view"))):
    see_salary = bool(user["permissions"].get("salaries.view")) and await pin_ok(request, user)
    members = await db.users.find({"business_id": user["business_id"]}, {"_id": 0}).to_list(500)
    return [member_public(m, see_salary) for m in members]


@router.post("", status_code=201)
async def create_employee(data: EmployeeCreate, user: dict = Depends(require_perm("users.manage"))):
    if user.get("role") != "OWNER":
        raise HTTPException(status_code=403, detail="Only the owner can create employees")
    email = (data.email or "").lower().strip()
    if email and await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    if not email:
        email = f"{uuid.uuid4().hex[:10]}@noemail.profitlens.local"
    if data.username:
        uname = data.username.lower().strip()
        if await db.users.find_one({"username": uname}):
            raise HTTPException(status_code=400, detail="Username already taken")
    else:
        uname = await unique_username(data.name)
    password = (data.password or "").strip()
    if password and len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    uid = f"user_{uuid.uuid4().hex[:12]}"
    doc = {
        "user_id": uid,
        "email": email,
        "username": uname,
        "name": data.name.strip(),
        "picture": None,
        "language": "ar",
        "business_id": user["business_id"],
        "role": data.role,
        "phone": data.phone or "",
        "salary": data.salary,
        "commission": data.commission,
        "hire_date": data.hire_date,
        "status": data.status,
        "permission_overrides": {},
        "created_at": now_iso(),
    }
    if password:
        doc["password_hash"] = hash_password(password)
    await db.users.insert_one(doc)
    await log_audit(user["business_id"], user, "employee.created", "user", uid, f"{doc['name']} ({data.role})")
    return member_public(doc, True)


@router.put("/{target_id}")
async def update_employee(target_id: str, data: EmployeeUpdate, request: Request, user: dict = Depends(require_perm("users.manage"))):
    target = await db.users.find_one({"user_id": target_id, "business_id": user["business_id"]}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Employee not found")
    if target.get("role") == "OWNER":
        raise HTTPException(status_code=403, detail="Cannot edit the owner")
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    if "username" in updates:
        uname = updates["username"].lower().strip()
        clash = await db.users.find_one({"username": uname, "user_id": {"$ne": target_id}})
        if clash:
            raise HTTPException(status_code=400, detail="Username already taken")
        updates["username"] = uname
    if ("salary" in updates or "commission" in updates) and not await pin_ok(request, user):
        raise HTTPException(status_code=403, detail="PIN_REQUIRED")
    await db.users.update_one({"user_id": target_id}, {"$set": updates})
    if "salary" in updates or "commission" in updates:
        await log_audit(user["business_id"], user, "employee.salary_changed", "user", target_id, target.get("name", ""))
    else:
        await log_audit(user["business_id"], user, "employee.updated", "user", target_id, ", ".join(updates.keys()))
    updated = await db.users.find_one({"user_id": target_id}, {"_id": 0})
    return member_public(updated, True)


@router.put("/{target_id}/permissions")
async def update_permissions(target_id: str, data: PermissionsUpdate, user: dict = Depends(require_perm("permissions.manage"))):
    target = await db.users.find_one({"user_id": target_id, "business_id": user["business_id"]}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Employee not found")
    if target.get("role") == "OWNER":
        raise HTTPException(status_code=403, detail="Owner permissions cannot be changed")
    clean = {}
    for k, v in (data.overrides or {}).items():
        if k in PERMISSION_KEYS:
            clean[k] = bool(v)
        elif k in KEY_MIGRATION:
            for nk in KEY_MIGRATION[k]:
                clean[nk] = bool(v)
    old = target.get("permission_overrides") or {}
    changes = []
    for k, v in clean.items():
        if old.get(k) != v:
            changes.append(f"{k}: {old.get(k)}→{v}")
    await db.users.update_one({"user_id": target_id}, {"$set": {"permission_overrides": clean}})
    await log_audit(user["business_id"], user, "permission.changed", "user", target_id, "; ".join(changes) or "permissions reset")
    updated = await db.users.find_one({"user_id": target_id}, {"_id": 0})
    return member_public(updated, True)


@router.get("/catalog")
async def permission_catalog(user: dict = Depends(require_perm("permissions.manage", "users.manage"))):
    return {"keys": PERMISSION_KEYS, "role_defaults": ROLE_DEFAULTS}
