"""Iter23: verified-state hardening + subscription metadata + SUBSCRIPTION_NOT_LINKED.

Covers:
 - paid state WITHOUT paypal_subscription_id -> status "unverified", assistant_access False,
   premium routes (profit report) blocked with 403
 - verified active subscription -> masked PayPal ID (full ID never in payload), billing_interval,
   auto_renew, next_renewal_date
 - cancellation scheduled -> auto_renew False, next_renewal None
 - cancel/reactivate on unlinked subscription -> 400 SUBSCRIPTION_NOT_LINKED, state untouched
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


def _login():
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json=OWNER, timeout=30)
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
    s = _login()
    yield s
    mongo.businesses.update_one({"business_id": BID}, {"$unset": {"assistant_subscription": ""}})


def _seed(mongo, **overrides):
    now = datetime.now(timezone.utc)
    sub = {
        "plan": "monthly",
        "price": 29.0,
        "currency": "USD",
        "status": "active",
        "cancel_at_period_end": False,
        "cancelled_at": None,
        "started_at": now.isoformat(),
        "current_period_start": now.isoformat(),
        "current_period_end": (now + timedelta(days=30)).isoformat(),
    }
    sub.update(overrides)
    mongo.businesses.update_one({"business_id": BID}, {"$set": {"assistant_subscription": sub}})


def _status(s):
    r = s.get(f"{BASE}/api/subscription/status", timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def test_unverified_state_blocks_premium(owner, mongo):
    _seed(mongo, plan="yearly", price=99.0)  # NO paypal_subscription_id -> legacy/unverified
    st = _status(owner)
    assert st["status"] == "unverified"
    assert st["assistant_access"] is False
    assert st["paypal_subscription_id"] is None
    # Premium route must reject
    r = owner.get(f"{BASE}/api/reports/profit", timeout=30)
    assert r.status_code == 403, r.text
    assert "SUBSCRIPTION_REQUIRED" in r.text
    # Underlying data NOT deleted/modified
    doc = mongo.businesses.find_one({"business_id": BID})["assistant_subscription"]
    assert doc["status"] == "active" and doc["plan"] == "yearly"


def test_verified_metadata_masked_id(owner, mongo):
    ppid = f"I-TESTMETA{uuid.uuid4().hex[:10].upper()}"
    _seed(mongo, paypal_subscription_id=ppid)
    raw = owner.get(f"{BASE}/api/subscription/status", timeout=30)
    st = raw.json()
    assert st["status"] == "active"
    assert st["assistant_access"] is True
    assert ppid not in raw.text  # full ID never leaks
    assert st["paypal_subscription_id"].endswith(ppid[-2:])
    assert "***" in st["paypal_subscription_id"]
    assert st["billing_interval"] == "month"
    assert st["auto_renew"] is True
    assert st["next_renewal_date"] == st["current_period_end"]
    assert st["subscribed_at"]
    assert st["current_period_start"] and st["current_period_end"]


def test_cancellation_scheduled_auto_renew_off(owner, mongo):
    _seed(mongo, paypal_subscription_id=f"I-TESTCAN{uuid.uuid4().hex[:8].upper()}",
          cancel_at_period_end=True, cancelled_at=datetime.now(timezone.utc).isoformat())
    st = _status(owner)
    assert st["status"] == "cancellation_scheduled"
    assert st["assistant_access"] is True  # access retained until period end
    assert st["auto_renew"] is False
    assert st["next_renewal_date"] is None


def test_yearly_billing_interval(owner, mongo):
    _seed(mongo, plan="yearly", price=99.0, renewal_price=299.0,
          paypal_subscription_id=f"I-TESTYR{uuid.uuid4().hex[:8].upper()}")
    st = _status(owner)
    assert st["status"] == "active"
    assert st["billing_interval"] == "year"
    assert st["renewal_price"] == 299.0


def test_cancel_unlinked_returns_not_linked(owner, mongo):
    _seed(mongo)  # active but NO paypal_subscription_id
    r = owner.post(f"{BASE}/api/subscription/cancel", timeout=30)
    assert r.status_code == 400, r.text
    assert "SUBSCRIPTION_NOT_LINKED" in r.text
    # No silent local toggle
    doc = mongo.businesses.find_one({"business_id": BID})["assistant_subscription"]
    assert doc["status"] == "active"
    assert doc.get("cancel_at_period_end") in (False, None)


def test_reactivate_unlinked_returns_not_linked(owner, mongo):
    _seed(mongo, cancel_at_period_end=True)  # scheduled but unlinked
    r = owner.post(f"{BASE}/api/subscription/reactivate", timeout=30)
    assert r.status_code == 400, r.text
    assert "SUBSCRIPTION_NOT_LINKED" in r.text
    doc = mongo.businesses.find_one({"business_id": BID})["assistant_subscription"]
    assert doc["cancel_at_period_end"] is True  # untouched


def test_no_subscription_cancel_still_400(owner, mongo):
    mongo.businesses.update_one({"business_id": BID}, {"$unset": {"assistant_subscription": ""}})
    for ep in ("cancel", "reactivate"):
        r = owner.post(f"{BASE}/api/subscription/{ep}", timeout=30)
        assert r.status_code == 400, (ep, r.text)
        assert "SUBSCRIPTION_NOT_LINKED" not in r.text  # distinct from the unlinked case


def test_native_datetime_period_end_does_not_500(owner, mongo):
    # Regression: BSON date (native datetime, naive tz) must never crash get_status
    _seed(mongo, paypal_subscription_id=f"I-TESTDT{uuid.uuid4().hex[:8].upper()}",
          current_period_end=datetime.now(timezone.utc) + timedelta(days=30))
    r = owner.get(f"{BASE}/api/subscription", timeout=30)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "active"
    # Past native datetime -> expired, still 200
    _seed(mongo, paypal_subscription_id=f"I-TESTDT{uuid.uuid4().hex[:8].upper()}",
          current_period_end=datetime.now(timezone.utc) - timedelta(days=1))
    r = owner.get(f"{BASE}/api/subscription", timeout=30)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "expired"
