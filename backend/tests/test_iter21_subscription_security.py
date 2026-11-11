"""Iter21 targeted: security surface + state machine + payments log + zero-data-disruption.

Exercises the production-grade subscription model:
 - activate strictly requires paypal_subscription_id (422) and NEVER grants access when provider is unconfigured (503)
 - invalid plans rejected (422)
 - webhook rejected when PAYPAL_WEBHOOK_ID unset (503) with no side-effects
 - cancel/reactivate w/o paid sub -> 4xx/503, state untouched
 - employee -> 403 on all owner-only subscription endpoints
 - state machine: active / cancellation_scheduled / expired / past_due / pending_payment
 - subscription_payments log surfaces seeded rows, owner-only
 - /api/products still 200 after every seed mutation (no data disruption)
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
def owner(mongo):
    mongo.businesses.update_one({"business_id": BID}, {"$unset": {"assistant_subscription": ""}})
    mongo.subscription_payments.delete_many({"business_id": BID, "reference_id": {"$regex": "^I-TEST"}})
    mongo.webhook_events.delete_many({"event_id": {"$regex": "^EVT-TEST-"}})
    s = _login(**OWNER)
    yield s
    mongo.businesses.update_one({"business_id": BID}, {"$unset": {"assistant_subscription": ""}})
    mongo.subscription_payments.delete_many({"business_id": BID, "reference_id": {"$regex": "^I-TEST"}})
    mongo.webhook_events.delete_many({"event_id": {"$regex": "^EVT-TEST-"}})


def _status(s):
    r = s.get(f"{BASE}/api/subscription/status", timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _assert_no_data_disruption(s):
    r = s.get(f"{BASE}/api/products", timeout=30)
    assert r.status_code == 200, r.text


# --- SECURITY ---

def test_activate_no_id_422(owner):
    r = owner.post(f"{BASE}/api/subscription/activate", json={"plan": "monthly"}, timeout=30)
    assert r.status_code == 422, r.text


def test_activate_fake_id_never_grants(owner, mongo):
    before = mongo.businesses.find_one({"business_id": BID}).get("assistant_subscription")
    r = owner.post(
        f"{BASE}/api/subscription/activate",
        json={"plan": "monthly", "paypal_subscription_id": "I-TESTFAKESEC"},
        timeout=30,
    )
    assert r.status_code in (400, 502, 503), r.text
    after = mongo.businesses.find_one({"business_id": BID}).get("assistant_subscription")
    assert before == after  # untouched
    st = _status(owner)
    assert st["status"] in ("trial", "free")


def test_activate_weekly_plan_422(owner):
    r = owner.post(
        f"{BASE}/api/subscription/activate",
        json={"plan": "weekly", "paypal_subscription_id": "I-TESTWEEKLY"},
        timeout=30,
    )
    assert r.status_code in (400, 422), r.text


def test_cancel_reactivate_no_paid_sub(owner, mongo):
    mongo.businesses.update_one({"business_id": BID}, {"$unset": {"assistant_subscription": ""}})
    for ep in ("cancel", "reactivate"):
        r = owner.post(f"{BASE}/api/subscription/{ep}", timeout=30)
        assert r.status_code in (400, 503), (ep, r.text)
    biz = mongo.businesses.find_one({"business_id": BID})
    assert "assistant_subscription" not in biz or not biz["assistant_subscription"]


def test_webhook_503_and_no_side_effects(owner, mongo):
    eid = f"EVT-TEST-{uuid.uuid4().hex[:8]}"
    r = requests.post(
        f"{BASE}/api/subscription/webhook",
        json={"id": eid, "event_type": "BILLING.SUBSCRIPTION.ACTIVATED", "resource": {"id": "I-TESTWH"}},
        timeout=30,
    )
    assert r.status_code == 503, r.text
    # No webhook_events row created
    assert mongo.webhook_events.find_one({"event_id": eid}) is None
    st = _status(owner)
    assert st["status"] in ("trial", "free")


def test_employee_403_on_all_paths(owner, mongo):
    ename = f"TEST_emp_sec_{uuid.uuid4().hex[:6]}"
    r = owner.post(f"{BASE}/api/team", json={"name": ename, "role": "EMPLOYEE", "password": "EmpPass123!"}, timeout=30)
    assert r.status_code in (200, 201), r.text
    emp = r.json()
    username = emp.get("username") or ename
    emp_id = emp.get("user_id") or emp.get("id")

    es = requests.Session()
    lr = es.post(f"{BASE}/api/auth/kiosk-login", json={"username": username, "password": "EmpPass123!"}, timeout=30)
    assert lr.status_code == 200, lr.text

    # activate with complete body
    r1 = es.post(f"{BASE}/api/subscription/activate", json={"plan": "monthly", "paypal_subscription_id": "I-TESTEMPSEC"}, timeout=30)
    assert r1.status_code == 403, r1.text
    # incomplete body -> 422 (validation before guard is acceptable per spec)
    r2 = es.post(f"{BASE}/api/subscription/activate", json={"plan": "monthly"}, timeout=30)
    assert r2.status_code in (403, 422)
    assert es.post(f"{BASE}/api/subscription/cancel", timeout=30).status_code == 403
    assert es.post(f"{BASE}/api/subscription/reactivate", timeout=30).status_code == 403
    assert es.get(f"{BASE}/api/subscription/payments", timeout=30).status_code == 403
    assert es.get(f"{BASE}/api/subscription", timeout=30).status_code == 403

    if emp_id:
        owner.delete(f"{BASE}/api/team/{emp_id}", timeout=30)


# --- STATE MACHINE ---

def _seed(mongo, **overrides):
    now = datetime.now(timezone.utc)
    sub = {
        "status": "active", "plan": "monthly", "price": 29.0, "currency": "USD",
        "paypal_subscription_id": "I-TESTSTATE21", "started_at": now.isoformat(),
        "current_period_start": now.isoformat(),
        "current_period_end": (now + timedelta(days=10)).isoformat(),
        "cancel_at_period_end": False, "cancelled_at": None,
    }
    sub.update(overrides)
    mongo.businesses.update_one({"business_id": BID}, {"$set": {"assistant_subscription": sub}})


@pytest.mark.parametrize("overrides,expected_status,expected_access", [
    ({}, "active", True),
    ({"cancel_at_period_end": True, "cancelled_at": datetime.now(timezone.utc).isoformat()}, "cancellation_scheduled", True),
    ({"current_period_end": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()}, "expired", False),
    ({"status": "past_due"}, "past_due", True),
    ({"status": "pending_payment"}, "pending_payment", False),
])
def test_state_machine(owner, mongo, overrides, expected_status, expected_access):
    _seed(mongo, **overrides)
    d = _status(owner)
    assert d["status"] == expected_status, d
    assert d["assistant_access"] is expected_access, d
    _assert_no_data_disruption(owner)


def test_state_removed_returns_to_trial_or_free(owner, mongo):
    mongo.businesses.update_one({"business_id": BID}, {"$unset": {"assistant_subscription": ""}})
    d = _status(owner)
    assert d["status"] in ("trial", "free")
    _assert_no_data_disruption(owner)


# --- PAYMENTS LOG ---

def test_payments_log_returns_seeded_rows(owner, mongo):
    # Seed two payment rows
    now = datetime.now(timezone.utc)
    rows = [
        {
            "business_id": BID, "reference_id": "I-TESTPAY1", "status": "COMPLETED",
            "plan": "monthly", "amount": 29.0, "currency": "USD",
            "period_start": now.isoformat(), "period_end": (now + timedelta(days=30)).isoformat(),
            "created_at": now.isoformat(),
        },
        {
            "business_id": BID, "reference_id": "I-TESTPAY2", "status": "COMPLETED",
            "plan": "monthly", "amount": 29.0, "currency": "USD",
            "period_start": now.isoformat(), "period_end": (now + timedelta(days=30)).isoformat(),
            "created_at": now.isoformat(),
        },
    ]
    mongo.subscription_payments.insert_many(rows)
    r = owner.get(f"{BASE}/api/subscription/payments", timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    refs = {p.get("reference_id") for p in data}
    assert "I-TESTPAY1" in refs and "I-TESTPAY2" in refs
    # Ensure no ObjectId leak
    assert all("_id" not in p for p in data), data
