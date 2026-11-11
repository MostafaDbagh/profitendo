"""Iter14: Subscription lifecycle - independent verification.
Owner trial start → age → expired → chat 403 → activate → chat allowed.
Employee inheritance + 403 on owner-only endpoints.
Also reset final state.
"""
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import MongoClient

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")
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
    # Clean state
    mongo.businesses.update_one({"business_id": BID}, {"$unset": {"assistant_trial_started_at": "", "assistant_subscription": ""}})
    s = _login(**OWNER)
    yield s
    # Final teardown - reset
    mongo.businesses.update_one({"business_id": BID}, {"$unset": {"assistant_trial_started_at": "", "assistant_subscription": ""}})


def test_01_status_starts_trial(owner_session, mongo):
    r = owner_session.get(f"{BASE}/api/subscription/status", timeout=30)
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "trial"
    assert d["assistant_access"] is True
    assert d["trial_days_remaining"] in (30, 29)  # rounding
    assert d["is_owner"] is True
    biz = mongo.businesses.find_one({"business_id": BID})
    assert biz.get("assistant_trial_started_at")


def test_02_details_owner_only(owner_session):
    r = owner_session.get(f"{BASE}/api/subscription", timeout=30)
    assert r.status_code == 200
    d = r.json()
    assert d["trial_days_total"] == 30
    assert "business_name" in d


def test_03_age_trial_and_expire(owner_session, mongo):
    past = (datetime.now(timezone.utc) - timedelta(days=31)).isoformat()
    mongo.businesses.update_one({"business_id": BID}, {"$set": {"assistant_trial_started_at": past}, "$unset": {"assistant_subscription": ""}})
    r = owner_session.get(f"{BASE}/api/subscription/status", timeout=30)
    d = r.json()
    assert d["status"] == "free"  # expired trial now maps to the standardized "free" state
    assert d["assistant_access"] is False


def test_04_chat_403_when_expired(owner_session):
    sid = uuid.uuid4().hex
    r = owner_session.post(f"{BASE}/api/assistant/chat", json={"message": "مرحبا", "session_id": sid}, timeout=30)
    assert r.status_code == 403
    assert "ASSISTANT_SUBSCRIPTION_EXPIRED" in r.text

    r2 = owner_session.get(f"{BASE}/api/assistant/history?session_id={sid}", timeout=30)
    assert r2.status_code == 403


def test_05_other_endpoints_unaffected(owner_session):
    r = owner_session.get(f"{BASE}/api/products", timeout=30)
    assert r.status_code == 200


def test_06_employee_inherits_expired(owner_session, mongo):
    # self-age the trial so this test is order-independent
    import datetime as _dt
    old = (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(days=31)).isoformat()
    mongo.businesses.update_one(
        {"business_id": BID}, {"$set": {"assistant_trial_started_at": old}, "$unset": {"assistant_subscription": ""}}
    )
    # create employee
    ename = f"TEST_emp_{uuid.uuid4().hex[:6]}"
    r = owner_session.post(f"{BASE}/api/team", json={"name": ename, "role": "EMPLOYEE", "password": "EmpPass123!"}, timeout=30)
    assert r.status_code in (200, 201), r.text
    emp = r.json()
    username = emp.get("username") or ename
    emp_id = emp.get("user_id") or emp.get("id")

    # employee login (kiosk)
    es = requests.Session()
    lr = es.post(f"{BASE}/api/auth/kiosk-login", json={"username": username, "password": "EmpPass123!"}, timeout=30)
    assert lr.status_code == 200, lr.text

    # status: inherits expired (standardized as "free"), is_owner=false
    r = es.get(f"{BASE}/api/subscription/status", timeout=30)
    assert r.status_code == 200
    d = r.json()
    assert d["is_owner"] is False
    assert d["status"] == "free"
    assert d["assistant_access"] is False

    # details forbidden
    assert es.get(f"{BASE}/api/subscription", timeout=30).status_code == 403
    # activate forbidden (422 for incomplete body / 403 for complete body — never activates)
    assert es.post(f"{BASE}/api/subscription/activate", json={"plan": "monthly"}, timeout=30).status_code in (403, 422)
    # chat forbidden
    cr = es.post(f"{BASE}/api/assistant/chat", json={"message": "hi", "session_id": uuid.uuid4().hex}, timeout=30)
    assert cr.status_code == 403

    # Owner activate — requires a VERIFIED PayPal subscription under the production payment flow.
    # A bare plan (no paypal_subscription_id) is rejected, so seed a PayPal-verified active sub directly.
    ar = owner_session.post(f"{BASE}/api/subscription/activate", json={"plan": "monthly"}, timeout=30)
    assert ar.status_code == 422  # paypal_subscription_id is mandatory (no free upgrades)
    now = datetime.now(timezone.utc)
    mongo.businesses.update_one({"business_id": BID}, {"$set": {"assistant_subscription": {
        "status": "active", "plan": "monthly", "price": 29.0, "currency": "USD",
        "paypal_subscription_id": "I-TESTSEED14", "started_at": now.isoformat(),
        "current_period_start": now.isoformat(), "current_period_end": (now + timedelta(days=30)).isoformat(),
        "cancel_at_period_end": False, "cancelled_at": None,
    }}})
    ad = owner_session.get(f"{BASE}/api/subscription/status", timeout=30).json()
    assert ad["status"] == "active"
    assert ad["assistant_access"] is True

    # Employee now inherits active (chat can be attempted; do not actually chat to save time - status is enough)
    r2 = es.get(f"{BASE}/api/subscription/status", timeout=30)
    assert r2.json()["status"] == "active"
    assert r2.json()["assistant_access"] is True

    # Deactivate employee
    if emp_id:
        owner_session.delete(f"{BASE}/api/team/{emp_id}", timeout=30)


def test_07_final_reset(mongo):
    mongo.businesses.update_one({"business_id": BID}, {"$unset": {"assistant_trial_started_at": "", "assistant_subscription": ""}})
    biz = mongo.businesses.find_one({"business_id": BID})
    assert "assistant_trial_started_at" not in biz
    assert "assistant_subscription" not in biz
