"""Secure forgot/reset password flow.

- Single-use tokens (secrets.token_urlsafe), stored ONLY as SHA-256 hashes on the
  user doc with a 30-minute expiry; invalidated immediately on use.
- Anti-enumeration: forgot-password always returns the same generic response.
- Rate limited: 5 requests/hour per IP+email pair (reset_requests, TTL index).
- Email via Emergent-managed Resend proxy; key and sender stay server-side.
"""
import hashlib
import ipaddress
import logging
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from core import db, hash_password, now_iso

router = APIRouter(prefix="/api/auth", tags=["auth"])
logger = logging.getLogger(__name__)

EMAIL_BASE_URL = "https://integrations.emergentagent.com"  # constant by design
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY")
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "ProfitLens")
EMAIL_REPLY_TO = os.environ.get("EMAIL_REPLY_TO")

RESET_TTL_MINUTES = 30
RATE_LIMIT = 5  # requests per hour per email
IP_RATE_LIMIT = 30  # per hour per client IP (backstop; ingress IPs can be shared)


# ---------------------------------------------------------------- email guardrail gate (playbook)

_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv",
             "send us your password", "enter your password below", "confirm your card number",
             "your full card number", "seed phrase", "recovery phrase", "verify your card",
             "social security number", "confirm your bank details")
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan()
    scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} != real link host {real!r} (G3)")


async def send_email(*, to: str, subject: str, html: str) -> None:
    if not EMAIL_KEY:
        logger.error("EMERGENT_EMAIL_KEY not configured — email skipped")
        return
    _assert_safe_email(subject, html)
    payload = {"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME}
    if EMAIL_REPLY_TO:
        payload["contact_email"] = EMAIL_REPLY_TO
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(f"{EMAIL_BASE_URL}/api/v1/email/send", headers={"X-Email-Key": EMAIL_KEY}, json=payload)
    resp.raise_for_status()


# ---------------------------------------------------------------- templates

def _reset_email_html(link: str) -> str:
    safe_link = escape(link, quote=True)
    brand = escape(EMAIL_FROM_NAME)
    return (
        '<table role="presentation" width="100%" dir="rtl" style="background:#0f172a;padding:32px 16px;font-family:Tahoma,Arial,sans-serif">'
        '<tr><td align="center"><table role="presentation" width="480" style="background:#1e293b;border-radius:16px;padding:32px;border:1px solid #334155">'
        f'<tr><td style="color:#f59e0b;font-size:20px;font-weight:bold;padding-bottom:8px">{brand}</td></tr>'
        '<tr><td style="color:#f1f5f9;font-size:16px;font-weight:bold;padding-bottom:12px">إعادة تعيين كلمة المرور</td></tr>'
        '<tr><td style="color:#94a3b8;font-size:13px;line-height:1.8;padding-bottom:20px">'
        'تلقّينا طلباً لإعادة تعيين كلمة مرور حسابك. اضغط الزر أدناه لاختيار كلمة مرور جديدة. '
        'هذا الرابط صالح لمدة 30 دقيقة ويُستخدم مرة واحدة فقط.</td></tr>'
        f'<tr><td align="center" style="padding-bottom:20px"><a href="{safe_link}" '
        'style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:bold;font-size:14px;'
        'padding:12px 32px;border-radius:12px;text-decoration:none">تعيين كلمة مرور جديدة</a></td></tr>'
        '<tr><td style="color:#64748b;font-size:12px;line-height:1.8">إن لم تطلب ذلك، تجاهل هذه الرسالة — ستبقى كلمة مرورك كما هي.</td></tr>'
        '<tr><td dir="ltr" style="color:#475569;font-size:11px;padding-top:16px;border-top:1px solid #334155">'
        f'Password reset request — link valid for 30 minutes, single use. Sent by {brand}. '
        'We never ask for your password by email.</td></tr>'
        '</table></td></tr></table>'
    )


# ---------------------------------------------------------------- endpoints

class ForgotInput(BaseModel):
    email: EmailStr


class ResetInput(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    new_password: str = Field(min_length=6, max_length=100)


@router.post("/forgot-password")
async def forgot_password(data: ForgotInput, request: Request):
    email = data.email.strip().lower()
    fwd = request.headers.get("x-forwarded-for", "")
    ip = fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "unknown")
    since = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    email_attempts = await db.reset_requests.count_documents({"email": email, "created_at": {"$gte": since}})
    ip_attempts = await db.reset_requests.count_documents({"ip": ip, "created_at": {"$gte": since}})
    if email_attempts >= RATE_LIMIT or ip_attempts >= IP_RATE_LIMIT:
        raise HTTPException(status_code=429, detail="RATE_LIMITED")
    await db.reset_requests.insert_one({"email": email, "ip": ip, "created_at": now_iso()})

    user = await db.users.find_one({"email": email})
    if user and user.get("password_hash") and user.get("is_active", True):
        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        expires = (datetime.now(timezone.utc) + timedelta(minutes=RESET_TTL_MINUTES)).isoformat()
        await db.users.update_one(
            {"user_id": user["user_id"]},
            {"$set": {"reset_token_hash": token_hash, "reset_token_expires": expires}},
        )
        base = os.environ.get("APP_URL", "").rstrip("/")
        if base:
            try:
                await send_email(to=email, subject="إعادة تعيين كلمة المرور — ProfitLens",
                                 html=_reset_email_html(f"{base}/reset-password?token={token}"))
            except Exception:
                logger.exception("password reset email failed for a user")
    # identical generic response either way — no account enumeration
    return {"ok": True, "message": "RESET_EMAIL_GENERIC"}


@router.post("/reset-password")
async def reset_password(data: ResetInput):
    token_hash = hashlib.sha256(data.token.encode()).hexdigest()
    user = await db.users.find_one({"reset_token_hash": token_hash})
    if not user:
        raise HTTPException(status_code=400, detail="RESET_LINK_INVALID")
    exp = user.get("reset_token_expires")
    if not exp or datetime.fromisoformat(str(exp)) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="RESET_LINK_EXPIRED")
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {
            "$set": {"password_hash": hash_password(data.new_password), "updated_at": now_iso()},
            "$unset": {"reset_token_hash": "", "reset_token_expires": ""},
        },
    )
    return {"ok": True, "message": "RESET_SUCCESS"}
