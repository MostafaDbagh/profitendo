"""Iter22: webhook handler verification (production-readiness).

The signature gate itself is covered elsewhere (503 when PAYPAL_WEBHOOK_ID unset).
Here we verify the HANDLER LOGIC for the 5 required PayPal event types plus
idempotency, by running the real FastAPI route in-process with signature
verification mocked (a real signature check requires the LIVE secret, which
must never enter test code/logs).

Uses a dedicated throwaway business (biz_webhook_test) so the shared tenants'
subscription state is never touched. Run serially (-n 0) with the full suite.
"""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv  # noqa: E402

load_dotenv("/app/backend/.env")

from pymongo import MongoClient  # noqa: E402
from starlette.requests import Request  # noqa: E402

import subscriptions  # noqa: E402

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
BID = "biz_webhook_test"
PP_SUB = "I-TESTWH22"


_LOOP = asyncio.new_event_loop()


def _run(coro):
    # Single persistent loop: Motor (core.db) binds to the first loop it runs on.
    return _LOOP.run_until_complete(coro)


def _request(event: dict) -> Request:
    import json as _json

    body = _json.dumps(event).encode()
    scope = {"type": "http", "method": "POST", "headers": [], "query_string": b""}

    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    return Request(scope, receive)


@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(MONGO_URL)
    db = c[DB_NAME]
    yield db
    db.businesses.delete_one({"business_id": BID})
    db.subscription_payments.delete_many({"business_id": BID})
    db.webhook_events.delete_many({"_id": {"$regex": "^EVT-TEST22-"}})
    c.close()


@pytest.fixture(autouse=True)
def no_signature_check(monkeypatch):
    async def _ok(request, event):
        return None

    monkeypatch.setattr(subscriptions, "_verify_webhook", _ok)


def _seed(mongo, **sub_overrides):
    sub = {
        "plan": "monthly",
        "price": 29.0,
        "currency": "USD",
        "paypal_subscription_id": PP_SUB,
        "status": "pending_payment",
        "cancel_at_period_end": False,
        "cancelled_at": None,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "current_period_start": datetime.now(timezone.utc).isoformat(),
        "current_period_end": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
    }
    sub.update(sub_overrides)
    mongo.businesses.delete_one({"business_id": BID})
    mongo.businesses.insert_one({"business_id": BID, "name": "WH Test", "assistant_subscription": sub})


def _biz(mongo):
    return mongo.businesses.find_one({"business_id": BID})["assistant_subscription"]


def _post(event):
    return _run(subscriptions.paypal_webhook(_request(event)))


def test_activated_flips_pending_to_active(mongo):
    _seed(mongo, status="pending_payment")
    out = _post({"id": f"EVT-TEST22-{uuid.uuid4().hex[:8]}", "event_type": "BILLING.SUBSCRIPTION.ACTIVATED", "resource": {"id": PP_SUB}})
    assert out["handled"] is True
    sub = _biz(mongo)
    assert sub["status"] == "active"
    assert sub["cancel_at_period_end"] is False
    assert sub["cancelled_at"] is None


def test_payment_failed_marks_past_due(mongo):
    _seed(mongo, status="active")
    out = _post({"id": f"EVT-TEST22-{uuid.uuid4().hex[:8]}", "event_type": "BILLING.SUBSCRIPTION.PAYMENT.FAILED", "resource": {"id": PP_SUB}})
    assert out["handled"] is True
    assert _biz(mongo)["status"] == "past_due"


def test_cancelled_keeps_access_until_period_end(mongo):
    _seed(mongo, status="active")
    out = _post({"id": f"EVT-TEST22-{uuid.uuid4().hex[:8]}", "event_type": "BILLING.SUBSCRIPTION.CANCELLED", "resource": {"id": PP_SUB}})
    assert out["handled"] is True
    sub = _biz(mongo)
    assert sub["cancel_at_period_end"] is True
    assert sub["cancelled_at"]
    assert sub["status"] == "active"  # access retained until current_period_end


def test_suspended_marks_past_due_unless_cancel_scheduled(mongo):
    _seed(mongo, status="active", cancel_at_period_end=False)
    _post({"id": f"EVT-TEST22-{uuid.uuid4().hex[:8]}", "event_type": "BILLING.SUBSCRIPTION.SUSPENDED", "resource": {"id": PP_SUB}})
    assert _biz(mongo)["status"] == "past_due"

    _seed(mongo, status="active", cancel_at_period_end=True)
    _post({"id": f"EVT-TEST22-{uuid.uuid4().hex[:8]}", "event_type": "BILLING.SUBSCRIPTION.SUSPENDED", "resource": {"id": PP_SUB}})
    assert _biz(mongo)["status"] == "active"  # our own cancel-suspend must not downgrade access


def test_sale_completed_extends_period_and_logs_payment_once(mongo):
    _seed(mongo, status="past_due")
    eid = f"EVT-TEST22-{uuid.uuid4().hex[:8]}"
    event = {
        "id": eid,
        "event_type": "PAYMENT.SALE.COMPLETED",
        "resource": {"id": "9XJ00000000000000", "billing_agreement_id": PP_SUB, "amount": {"total": "29.00", "currency": "USD"}},
    }
    out = _post(event)
    assert out["handled"] is True
    sub = _biz(mongo)
    assert sub["status"] == "active"
    end = datetime.fromisoformat(sub["current_period_end"])
    assert end > datetime.now(timezone.utc) + timedelta(days=28)

    payments = list(mongo.subscription_payments.find({"business_id": BID, "paypal_event_id": eid}))
    assert len(payments) == 1
    assert payments[0]["status"] == "completed"
    assert payments[0]["amount"] == 29.0

    # Idempotency: redelivery of the SAME event is acked but never re-processed
    dup = _post(event)
    assert dup.get("duplicate") is True
    payments = list(mongo.subscription_payments.find({"business_id": BID, "paypal_event_id": eid}))
    assert len(payments) == 1


def test_unknown_subscription_is_acked_without_side_effects(mongo):
    _seed(mongo)
    out = _post({"id": f"EVT-TEST22-{uuid.uuid4().hex[:8]}", "event_type": "BILLING.SUBSCRIPTION.ACTIVATED", "resource": {"id": "I-DOESNOTEXIST"}})
    assert out["received"] is True
    assert out.get("matched") is False
    assert _biz(mongo)["status"] == "pending_payment"  # untouched


def test_unhandled_event_type_is_acked(mongo):
    _seed(mongo)
    out = _post({"id": f"EVT-TEST22-{uuid.uuid4().hex[:8]}", "event_type": "BILLING.SUBSCRIPTION.CREATED", "resource": {"id": PP_SUB}})
    assert out["received"] is True
    assert out.get("handled") is False
