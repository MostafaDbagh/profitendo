import math
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from core import db, get_current_user, log_audit, now_iso

router = APIRouter(prefix="/api/subscription", tags=["subscription"])

TRIAL_DAYS = 30

# Schema stays flexible for a future yearly plan ($99 launch / $299 renewal).
PLANS = {
    "monthly": {"price": 29.0, "period_days": 30, "plan_id": os.environ.get("PAYPAL_PLAN_MONTHLY")},
    "yearly": {"price": 299.0, "launch_price": 99.0, "period_days": 365, "plan_id": os.environ.get("PAYPAL_PLAN_YEARLY") or None},
}

PAYPAL_CLIENT_ID = os.environ.get("PAYPAL_CLIENT_ID")
PAYPAL_CLIENT_SECRET = os.environ.get("PAYPAL_CLIENT_SECRET")
PAYPAL_WEBHOOK_ID = os.environ.get("PAYPAL_WEBHOOK_ID")
PAYPAL_BASE = "https://api-m.sandbox.paypal.com" if os.environ.get("PAYPAL_MODE", "sandbox") == "sandbox" else "https://api-m.paypal.com"

_token_cache = {"token": None, "expires_at": 0.0}


def paypal_configured() -> bool:
    return bool(PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET)


async def _paypal_token() -> str:
    now = time.time()
    if _token_cache["token"] and now < _token_cache["expires_at"] - 60:
        return _token_cache["token"]
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(
            f"{PAYPAL_BASE}/v1/oauth2/token",
            auth=(PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET),
            data={"grant_type": "client_credentials"},
            headers={"Accept": "application/json"},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail="Payment provider authentication failed")
    data = r.json()
    _token_cache["token"] = data["access_token"]
    _token_cache["expires_at"] = now + int(data.get("expires_in", 3000))
    return _token_cache["token"]


async def _paypal_request(method: str, path: str, body: Optional[dict] = None) -> httpx.Response:
    token = await _paypal_token()
    async with httpx.AsyncClient(timeout=20) as client:
        return await client.request(
            method,
            f"{PAYPAL_BASE}{path}",
            json=body,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )


async def paypal_get_subscription(subscription_id: str) -> dict:
    r = await _paypal_request("GET", f"/v1/billing/subscriptions/{subscription_id}")
    if r.status_code == 404:
        raise HTTPException(status_code=400, detail="Unknown PayPal subscription")
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail="Payment provider verification failed")
    return r.json()


async def _paypal_action(subscription_id: str, action: str, reason: str) -> None:
    r = await _paypal_request("POST", f"/v1/billing/subscriptions/{subscription_id}/{action}", {"reason": reason})
    if r.status_code not in (200, 202, 204):
        raise HTTPException(status_code=502, detail=f"Payment provider {action} failed")


def _parse(iso):
    if not iso:
        return None
    if isinstance(iso, datetime):
        return iso if iso.tzinfo else iso.replace(tzinfo=timezone.utc)
    dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _mask_paypal_id(pid: Optional[str]) -> Optional[str]:
    """Masked form (e.g. I-0JU***LI) — the full PayPal subscription ID is never exposed via the API."""
    if not pid:
        return None
    if len(pid) <= 7:
        return pid[:2] + "***"
    return f"{pid[:5]}***{pid[-2:]}"


def _billing_interval(plan: Optional[str]) -> str:
    return "year" if plan == "yearly" else "month"


def _period_end(sub_doc: dict) -> Optional[datetime]:
    return _parse(sub_doc.get("current_period_end"))


async def get_status(bid: str) -> dict:
    """Business-level AI assistant subscription status. Trial starts on first activation."""
    biz = await db.businesses.find_one(
        {"business_id": bid}, {"_id": 0, "assistant_trial_started_at": 1, "assistant_subscription": 1}
    ) or {}
    sub = biz.get("assistant_subscription") or {}
    now = datetime.now(timezone.utc)

    paid_status = sub.get("status")
    if paid_status in ("active", "past_due", "pending_payment"):
        if not sub.get("paypal_subscription_id"):
            # Legacy/locally-seeded paid state without a verified PayPal subscription:
            # NEVER grants Premium. Data is left untouched; user must subscribe via PayPal.
            return {
                "status": "unverified",
                "plan": sub.get("plan", "monthly"),
                "price": sub.get("price"),
                "renewal_price": sub.get("renewal_price"),
                "currency": sub.get("currency", "USD"),
                "paypal_subscription_id": None,
                "billing_interval": _billing_interval(sub.get("plan")),
                "auto_renew": False,
                "next_renewal_date": None,
                "assistant_access": False,
                "cancel_at_period_end": False,
                "cancelled_at": sub.get("cancelled_at"),
                "current_period_start": sub.get("current_period_start"),
                "current_period_end": sub.get("current_period_end"),
                "trial_days_remaining": 0,
                "trial_started_at": None,
                "trial_ends_at": None,
                "subscribed_at": sub.get("started_at"),
            }
        period_end = _period_end(sub)
        ended = bool(period_end and period_end <= now)
        if ended:
            effective = "expired"
            access = False
        elif paid_status == "pending_payment":
            effective = "pending_payment"
            access = False
        elif paid_status == "past_due":
            effective = "past_due"
            access = True  # grace period until cycle end / provider retry
        elif sub.get("cancel_at_period_end"):
            effective = "cancellation_scheduled"
            access = True
        else:
            effective = "active"
            access = True
        auto_renew = bool(access and not sub.get("cancel_at_period_end"))
        return {
            "status": effective,
            "plan": sub.get("plan", "monthly"),
            "price": sub.get("price"),
            "renewal_price": sub.get("renewal_price"),
            "currency": sub.get("currency", "USD"),
            "paypal_subscription_id": _mask_paypal_id(sub.get("paypal_subscription_id")),
            "billing_interval": _billing_interval(sub.get("plan")),
            "auto_renew": auto_renew,
            "next_renewal_date": sub.get("current_period_end") if auto_renew else None,
            "assistant_access": access,
            "cancel_at_period_end": bool(sub.get("cancel_at_period_end")),
            "cancelled_at": sub.get("cancelled_at"),
            "current_period_start": sub.get("current_period_start"),
            "current_period_end": sub.get("current_period_end"),
            "trial_days_remaining": 0,
            "trial_started_at": None,
            "trial_ends_at": None,
            "subscribed_at": sub.get("started_at"),
        }

    started = _parse(biz.get("assistant_trial_started_at"))
    if not started:
        started = now
        await db.businesses.update_one({"business_id": bid}, {"$set": {"assistant_trial_started_at": now_iso()}})
    ends = started + timedelta(days=TRIAL_DAYS)
    delta = ends - now
    remaining = max(0, math.ceil(delta.total_seconds() / 86400))
    expired = delta.total_seconds() <= 0
    return {
        "status": "free" if expired else "trial",
        "plan": "trial",
        "assistant_access": not expired,
        "cancel_at_period_end": False,
        "current_period_start": None,
        "current_period_end": None,
        "trial_days_remaining": 0 if expired else remaining,
        "trial_started_at": started.isoformat(),
        "trial_ends_at": ends.isoformat(),
        "subscribed_at": None,
    }


async def _set_subscription(bid: str, sub_doc: dict) -> None:
    sub_doc["updated_at"] = now_iso()
    await db.businesses.update_one({"business_id": bid}, {"$set": {"assistant_subscription": sub_doc}})


async def _log_payment(bid: str, user: Optional[dict], *, reference_id: str, status: str, plan: str,
                       amount: float, currency: str, billing_period: str, start: Optional[str],
                       expires: Optional[str], source: str, paypal_event_id: Optional[str] = None) -> None:
    await db.subscription_payments.insert_one({
        "payment_id": f"pay_{uuid.uuid4().hex[:12]}",
        "business_id": bid,
        "reference_id": reference_id,
        "status": status,
        "plan": plan,
        "amount": amount,
        "currency": currency,
        "billing_period": billing_period,
        "period_start": start,
        "period_end": expires,
        "source": source,
        "paypal_event_id": paypal_event_id,
        "recorded_by": (user or {}).get("user_id"),
        "created_at": now_iso(),
    })


@router.get("/status")
async def subscription_status(user: dict = Depends(get_current_user)):
    s = await get_status(user["business_id"])
    s["is_owner"] = user.get("role") == "OWNER"
    return s


@router.get("")
async def subscription_details(user: dict = Depends(get_current_user)):
    if user.get("role") != "OWNER":
        raise HTTPException(status_code=403, detail="Only the owner can view subscription details")
    s = await get_status(user["business_id"])
    biz = await db.businesses.find_one({"business_id": user["business_id"]}, {"_id": 0, "name": 1, "base_currency": 1})
    s["business_name"] = (biz or {}).get("name", "")
    s["trial_days_total"] = TRIAL_DAYS
    s["paypal_ready"] = paypal_configured()
    # plan_id is public (it is sent to PayPal from the browser anyway) — safe to expose to the owner.
    s["plans"] = {
        k: {"price": v["price"], "launch_price": v.get("launch_price"), "period_days": v["period_days"],
            "available": bool(v.get("plan_id")), "plan_id": v.get("plan_id")}
        for k, v in PLANS.items()
    }
    return s


@router.get("/payments")
async def subscription_payments(user: dict = Depends(get_current_user)):
    if user.get("role") != "OWNER":
        raise HTTPException(status_code=403, detail="Only the owner can view payment history")
    docs = await db.subscription_payments.find(
        {"business_id": user["business_id"]}, {"_id": 0, "business_id": 0}
    ).sort("created_at", -1).to_list(100)
    return docs


class ActivateInput(BaseModel):
    plan: str = Field(default="monthly", pattern="^(monthly|yearly)$")
    paypal_subscription_id: str = Field(min_length=5, max_length=64)


@router.post("/activate")
async def activate_subscription(data: ActivateInput, user: dict = Depends(get_current_user)):
    """Premium is granted ONLY after server-side PayPal verification of the subscription."""
    if user.get("role") != "OWNER":
        raise HTTPException(status_code=403, detail="Only the owner can manage the subscription")
    if not paypal_configured():
        raise HTTPException(status_code=503, detail="Payment provider is not configured")
    plan_cfg = PLANS[data.plan]
    if not plan_cfg.get("plan_id"):
        raise HTTPException(status_code=400, detail="Plan is not available")

    bid = user["business_id"]
    biz = await db.businesses.find_one({"business_id": bid}, {"_id": 0, "assistant_subscription": 1}) or {}
    existing = (biz.get("assistant_subscription") or {})
    # Idempotency: same PayPal subscription already recorded as active → return state, no double-charge of state.
    if existing.get("paypal_subscription_id") == data.paypal_subscription_id and existing.get("status") in ("active", "past_due"):
        return await get_status(bid)

    pp_sub = await paypal_get_subscription(data.paypal_subscription_id)
    pp_status = (pp_sub.get("status") or "").upper()
    if pp_sub.get("plan_id") != plan_cfg["plan_id"]:
        raise HTTPException(status_code=400, detail="Subscription plan does not match")

    now = datetime.now(timezone.utc)
    next_billing = _parse((pp_sub.get("billing_info") or {}).get("next_billing_time"))
    price = plan_cfg.get("launch_price") if data.plan == "yearly" else plan_cfg["price"]
    base_doc = {
        "plan": data.plan,
        "price": price,
        "currency": "USD",
        "paypal_subscription_id": data.paypal_subscription_id,
        "started_at": existing.get("started_at") or now_iso(),
        "current_period_start": now_iso(),
        "current_period_end": (next_billing or now + timedelta(days=plan_cfg["period_days"])).isoformat(),
        "cancel_at_period_end": False,
        "cancelled_at": None,
    }
    if data.plan == "yearly":
        base_doc["renewal_price"] = plan_cfg["price"]

    if pp_status != "ACTIVE":
        # Approved but not yet active — no access until webhook/verification confirms ACTIVE.
        await _set_subscription(bid, {**base_doc, "status": "pending_payment"})
        await _log_payment(bid, user, reference_id=data.paypal_subscription_id, status="pending",
                           plan=data.plan, amount=price, currency="USD", billing_period=data.plan,
                           start=base_doc["current_period_start"], expires=base_doc["current_period_end"],
                           source="checkout")
        await log_audit(bid, user, "subscription.pending", "business", bid, f"{data.plan} · {data.paypal_subscription_id} · PayPal status {pp_status}")
        return await get_status(bid)

    await _set_subscription(bid, {**base_doc, "status": "active"})
    await _log_payment(bid, user, reference_id=data.paypal_subscription_id, status="completed",
                       plan=data.plan, amount=price, currency="USD", billing_period=data.plan,
                       start=base_doc["current_period_start"], expires=base_doc["current_period_end"],
                       source="checkout")
    await log_audit(bid, user, "subscription.activated", "business", bid, f"{data.plan} · {data.paypal_subscription_id}")
    return await get_status(bid)


async def _paid_sub_or_404(bid: str) -> tuple:
    biz = await db.businesses.find_one({"business_id": bid}, {"_id": 0, "assistant_subscription": 1}) or {}
    sub = biz.get("assistant_subscription") or {}
    if sub.get("status") in ("active", "past_due") and not sub.get("paypal_subscription_id"):
        raise HTTPException(status_code=400, detail="SUBSCRIPTION_NOT_LINKED")
    if sub.get("status") not in ("active", "past_due") or not sub.get("paypal_subscription_id"):
        raise HTTPException(status_code=400, detail="No active paid subscription")
    period_end = _period_end(sub)
    if period_end and period_end <= datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Subscription period has already ended")
    return biz, sub


@router.post("/cancel")
async def cancel_subscription(user: dict = Depends(get_current_user)):
    """Cancel at period end: billing stops on PayPal side, access stays until the paid cycle ends. No data is touched."""
    if user.get("role") != "OWNER":
        raise HTTPException(status_code=403, detail="Only the owner can manage the subscription")
    bid = user["business_id"]
    _, sub = await _paid_sub_or_404(bid)
    if not paypal_configured():
        raise HTTPException(status_code=503, detail="Payment provider is not configured")
    if sub.get("cancel_at_period_end"):
        return await get_status(bid)

    # Suspend stops future billing while remaining resumable (undo) until the cycle ends.
    await _paypal_action(sub["paypal_subscription_id"], "suspend", "Customer requested cancellation at period end")
    sub["cancel_at_period_end"] = True
    sub["cancelled_at"] = now_iso()
    await _set_subscription(bid, sub)
    await _log_payment(bid, user, reference_id=sub["paypal_subscription_id"], status="cancel_scheduled",
                       plan=sub.get("plan", "monthly"), amount=sub.get("price") or 0, currency=sub.get("currency", "USD"),
                       billing_period=sub.get("plan", "monthly"), start=sub.get("current_period_start"),
                       expires=sub.get("current_period_end"), source="cancel")
    await log_audit(bid, user, "subscription.cancel_scheduled", "business", bid, f"{sub.get('plan')} · ends {sub.get('current_period_end')}")
    return await get_status(bid)


@router.post("/reactivate")
async def reactivate_subscription(user: dict = Depends(get_current_user)):
    """Undo a scheduled cancellation before the paid cycle ends."""
    if user.get("role") != "OWNER":
        raise HTTPException(status_code=403, detail="Only the owner can manage the subscription")
    bid = user["business_id"]
    _, sub = await _paid_sub_or_404(bid)
    if not paypal_configured():
        raise HTTPException(status_code=503, detail="Payment provider is not configured")
    if not sub.get("cancel_at_period_end"):
        return await get_status(bid)

    await _paypal_action(sub["paypal_subscription_id"], "activate", "Customer reactivated subscription")
    sub["cancel_at_period_end"] = False
    sub["cancelled_at"] = None
    if sub.get("status") == "past_due":
        sub["status"] = "active"
    await _set_subscription(bid, sub)
    await _log_payment(bid, user, reference_id=sub["paypal_subscription_id"], status="reactivated",
                       plan=sub.get("plan", "monthly"), amount=sub.get("price") or 0, currency=sub.get("currency", "USD"),
                       billing_period=sub.get("plan", "monthly"), start=sub.get("current_period_start"),
                       expires=sub.get("current_period_end"), source="reactivate")
    await log_audit(bid, user, "subscription.reactivated", "business", bid, sub.get("plan", ""))
    return await get_status(bid)


async def _verify_webhook(request: Request, event: dict) -> None:
    if not paypal_configured() or not PAYPAL_WEBHOOK_ID:
        raise HTTPException(status_code=503, detail="Webhooks are not configured")
    h = request.headers
    body = {
        "auth_algo": h.get("paypal-auth-algo"),
        "cert_url": h.get("paypal-cert-url"),
        "transmission_id": h.get("paypal-transmission-id"),
        "transmission_sig": h.get("paypal-transmission-sig"),
        "transmission_time": h.get("paypal-transmission-time"),
        "webhook_id": PAYPAL_WEBHOOK_ID,
        "webhook_event": event,
    }
    r = await _paypal_request("POST", "/v1/notifications/verify-webhook-signature", body)
    if r.status_code != 200 or (r.json().get("verification_status") or "").upper() != "SUCCESS":
        raise HTTPException(status_code=401, detail="Invalid webhook signature")


async def _biz_by_paypal_sub(pp_sub_id: str) -> Optional[dict]:
    return await db.businesses.find_one(
        {"assistant_subscription.paypal_subscription_id": pp_sub_id},
        {"_id": 0, "business_id": 1, "assistant_subscription": 1},
    )


@router.post("/webhook")
async def paypal_webhook(request: Request):
    event = await request.json()
    await _verify_webhook(request, event)

    event_id = event.get("id")
    event_type = event.get("event_type") or ""
    resource = event.get("resource") or {}

    # Idempotency: a repeated delivery of the same event is acknowledged but never processed twice.
    if event_id:
        try:
            await db.webhook_events.insert_one({"_id": event_id, "provider": "paypal", "received_at": now_iso()})
        except Exception:
            return {"received": True, "duplicate": True}

    pp_sub_id = resource.get("id") if str(resource.get("id", "")).startswith("I-") else resource.get("billing_agreement_id")
    if event_type == "PAYMENT.SALE.COMPLETED":
        pp_sub_id = resource.get("billing_agreement_id")
    biz = await _biz_by_paypal_sub(pp_sub_id) if pp_sub_id else None
    if not biz:
        return {"received": True, "matched": False}

    bid = biz["business_id"]
    sub = dict(biz.get("assistant_subscription") or {})
    now = datetime.now(timezone.utc)

    if event_type == "BILLING.SUBSCRIPTION.ACTIVATED":
        sub["status"] = "active"
        sub["cancel_at_period_end"] = False
        sub["cancelled_at"] = None
    elif event_type == "BILLING.SUBSCRIPTION.PAYMENT.FAILED":
        sub["status"] = "past_due"
    elif event_type == "BILLING.SUBSCRIPTION.CANCELLED":
        sub["cancel_at_period_end"] = True
        sub["cancelled_at"] = now_iso()
    elif event_type == "BILLING.SUBSCRIPTION.SUSPENDED":
        if not sub.get("cancel_at_period_end"):
            sub["status"] = "past_due"
    elif event_type == "PAYMENT.SALE.COMPLETED":
        plan = sub.get("plan", "monthly")
        period_days = PLANS.get(plan, PLANS["monthly"])["period_days"]
        sub["status"] = "active"
        sub["current_period_start"] = now_iso()
        sub["current_period_end"] = (now + timedelta(days=period_days)).isoformat()
        sub["cancel_at_period_end"] = False
        sub["cancelled_at"] = None
        amount = (resource.get("amount") or {})
        await _log_payment(bid, None, reference_id=resource.get("id", pp_sub_id), status="completed",
                           plan=plan, amount=float(amount.get("total", 0) or 0), currency=amount.get("currency", "USD"),
                           billing_period=plan, start=sub["current_period_start"], expires=sub["current_period_end"],
                           source="webhook", paypal_event_id=event_id)
    else:
        return {"received": True, "handled": False}

    await _set_subscription(bid, sub)
    await db.webhook_events.update_one({"_id": event_id}, {"$set": {"event_type": event_type, "business_id": bid, "handled": True}})
    return {"received": True, "handled": True}
