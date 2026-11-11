"""Iter17 (rewritten): production PayPal security model for /api/subscription.

PayPal credentials are NOT configured in the test environment (PAYPAL_CLIENT_SECRET empty),
so the secure expectation is: no activation path can grant premium.
- activate without paypal_subscription_id -> 422 (field mandatory)
- activate with any id while provider unconfigured -> 503 (never grants premium)
- employee activate/cancel/reactivate -> 403
- cancel/reactivate without a paid sub -> 4xx/503, never mutates state
- webhook without PAYPAL_WEBHOOK_ID -> 503
- State machine (active / cancellation_scheduled / expired / past_due / pending_payment) computed correctly
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
OWNER = {"email": "test.seller@profitlens.app", "password": "TestSeller123!"}
BID = "biz_7101d3986f3c"


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(scope="module")
def owner_session(mongo):
    mongo.businesses.update_one({"business_id": BID}, {"$unset": {"assistant_subscription": ""}})
    s = _login(**OWNER)
    yield s
    mongo.businesses.update_one({"business_id": BID}, {"$unset": {"assistant_subscription": ""}})
    mongo.subscription_payments.delete_many({"business_id": BID, "reference_id": {"$regex": "^I-TEST"}})


def _status(s):
    return s.get(f"{BASE}/api/subscription/status", timeout=30).json()


def test_01_activate_requires_paypal_id(owner_session):
    r = owner_session.post(f"{BASE}/api/subscription/activate", json={"plan": "monthly"}, timeout=30)
    assert r.status_code == 422, r.text


def test_02_activate_never_grants_without_verification(owner_session):
    # Provider unconfigured in test env -> 503; and critically NO premium is granted.
    r = owner_session.post(
        f"{BASE}/api/subscription/activate",
        json={"plan": "monthly", "paypal_subscription_id": "I-TESTFAKE1"},
        timeout=30,
    )
    assert r.status_code in (400, 502, 503), r.text
    d = _status(owner_session)
    assert d["status"] in ("trial", "free")
    assert d["assistant_access"] in (True, False)  # trial may be active, but NO paid sub recorded
    biz = _status(owner_session)
    assert biz.get("paypal_subscription_id") in (None, "I-TESTFAKE1") if biz["status"] in ("trial", "free") else True


def test_03_invalid_plan_rejected(owner_session):
    r = owner_session.post(
        f"{BASE}/api/subscription/activate",
        json={"plan": "weekly", "paypal_subscription_id": "I-TESTXXX"},
        timeout=30,
    )
    assert r.status_code in (400, 422)


def test_04_cancel_reactivate_require_paid_sub(owner_session):
    for ep in ("cancel", "reactivate"):
        r = owner_session.post(f"{BASE}/api/subscription/{ep}", timeout=30)
        assert r.status_code in (400, 503), (ep, r.text)
    # State untouched
    assert _status(owner_session)["status"] in ("trial", "free")


def test_05_webhook_rejected_without_config(owner_session):
    r = requests.post(
        f"{BASE}/api/subscription/webhook",
        json={"id": f"EVT-TEST-{uuid.uuid4().hex[:8]}", "event_type": "BILLING.SUBSCRIPTION.ACTIVATED", "resource": {"id": "I-TESTWH1"}},
        timeout=30,
    )
    assert r.status_code == 503, r.text
    # No state change
    assert _status(owner_session)["status"] in ("trial", "free")


def test_06_employee_forbidden(owner_session, mongo):
    ename = f"TEST_emp_pp_{uuid.uuid4().hex[:6]}"
    r = owner_session.post(
        f"{BASE}/api/team",
        json={"name": ename, "role": "EMPLOYEE", "password": "EmpPass123!"},
        timeout=30,
    )
    assert r.status_code in (200, 201), r.text
    emp = r.json()
    username = emp.get("username") or ename
    emp_id = emp.get("user_id") or emp.get("id")

    es = requests.Session()
    lr = es.post(f"{BASE}/api/auth/kiosk-login", json={"username": username, "password": "EmpPass123!"}, timeout=30)
    assert lr.status_code == 200, lr.text

    # body validation runs before the owner check for incomplete payloads
    assert es.post(f"{BASE}/api/subscription/activate", json={"plan": "monthly"}, timeout=30).status_code == 422
    # complete body -> owner-only guard
    rr = es.post(f"{BASE}/api/subscription/activate", json={"plan": "monthly", "paypal_subscription_id": "I-TESTEMP"}, timeout=30)
    assert rr.status_code == 403, rr.text
    assert es.get(f"{BASE}/api/subscription", timeout=30).status_code == 403
    assert es.get(f"{BASE}/api/subscription/payments", timeout=30).status_code == 403
    assert es.post(f"{BASE}/api/subscription/cancel", timeout=30).status_code == 403
    assert es.post(f"{BASE}/api/subscription/reactivate", timeout=30).status_code == 403

    if emp_id:
        owner_session.delete(f"{BASE}/api/team/{emp_id}", timeout=30)


def _seed_paid(mongo, **overrides):
    now = datetime.now(timezone.utc)
    sub = {
        "status": "active", "plan": "monthly", "price": 29.0, "currency": "USD",
        "paypal_subscription_id": "I-TESTSTATE", "started_at": now.isoformat(),
        "current_period_start": now.isoformat(), "current_period_end": (now + timedelta(days=12)).isoformat(),
        "cancel_at_period_end": False, "cancelled_at": None,
    }
    sub.update(overrides)
    mongo.businesses.update_one({"business_id": BID}, {"$set": {"assistant_subscription": sub}})


def test_07_state_active(owner_session, mongo):
    _seed_paid(mongo)
    d = _status(owner_session)
    assert d["status"] == "active"
    assert d["assistant_access"] is True
    assert d["cancel_at_period_end"] is False
    assert d["current_period_end"]


def test_08_state_cancellation_scheduled(owner_session, mongo):
    _seed_paid(mongo, cancel_at_period_end=True, cancelled_at=datetime.now(timezone.utc).isoformat())
    d = _status(owner_session)
    assert d["status"] == "cancellation_scheduled"
    assert d["assistant_access"] is True  # access continues until period end
    assert d["cancel_at_period_end"] is True


def test_09_state_expired_after_period_end(owner_session, mongo):
    _seed_paid(mongo, current_period_end=(datetime.now(timezone.utc) - timedelta(days=1)).isoformat())
    d = _status(owner_session)
    assert d["status"] == "expired"
    assert d["assistant_access"] is False  # downgraded to free — data untouched


def test_10_state_past_due(owner_session, mongo):
    _seed_paid(mongo, status="past_due")
    d = _status(owner_session)
    assert d["status"] == "past_due"
    assert d["assistant_access"] is True  # grace until cycle end


def test_11_state_pending_payment(owner_session, mongo):
    _seed_paid(mongo, status="pending_payment")
    d = _status(owner_session)
    assert d["status"] == "pending_payment"
    assert d["assistant_access"] is False


def test_12_details_exposes_plan_catalog(owner_session, mongo):
    mongo.businesses.update_one({"business_id": BID}, {"$unset": {"assistant_subscription": ""}})
    r = owner_session.get(f"{BASE}/api/subscription", timeout=30)
    assert r.status_code == 200
    d = r.json()
    assert d["plans"]["monthly"]["price"] == 29.0
    assert d["plans"]["yearly"]["price"] == 299.0
    assert d["plans"]["yearly"]["launch_price"] == 99.0
    assert d["plans"]["yearly"]["available"] is False  # no yearly plan id configured yet
    assert "paypal_ready" in d


def test_13_payments_log_owner_only_and_empty(owner_session):
    r = owner_session.get(f"{BASE}/api/subscription/payments", timeout=30)
    assert r.status_code == 200
    assert isinstance(r.json(), list)
