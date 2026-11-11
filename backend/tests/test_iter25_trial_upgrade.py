"""Iter25: trial -> immediate paid subscription path (no trial gate).

Proves the state machine lets an active-TRIAL business enter the paid checkout
flow immediately: /api/subscription exposes both plans, and /activate proceeds
straight to server-side PayPal verification (fails on a fake ID with 4xx/5xx
provider errors — NEVER a trial-related block, and NEVER grants fake Premium).
"""
import os

import pytest
import requests
from pymongo import MongoClient

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
OWNER = {"email": "test.seller@profitlens.app", "password": "TestSeller123!"}
BID = "biz_7101d3986f3c"


@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(scope="module")
def owner(mongo):
    mongo.businesses.update_one({"business_id": BID}, {"$unset": {"assistant_subscription": ""}})
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json=OWNER, timeout=30)
    assert r.status_code == 200, r.text
    yield s
    mongo.businesses.update_one({"business_id": BID}, {"$unset": {"assistant_subscription": ""}})


def test_trial_state_active_with_plans_available(owner):
    r = owner.get(f"{BASE}/api/subscription", timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "trial"
    assert d["assistant_access"] is True
    assert d["trial_days_remaining"] > 0
    # Both plans are offered to trial accounts (monthly configured in preview)
    assert d["plans"]["monthly"]["available"] is True
    assert "yearly" in d["plans"]


def test_trial_activate_not_blocked_by_trial_gate(owner, mongo):
    for plan in ("monthly", "yearly"):
        r = owner.post(
            f"{BASE}/api/subscription/activate",
            json={"plan": plan, "paypal_subscription_id": f"I-FAKETRIAL{plan.upper()}"},
            timeout=30,
        )
        # Reaches PayPal verification (or provider guard) — never a trial gate.
        assert r.status_code in (400, 502, 503), (plan, r.text)
        assert "trial" not in r.text.lower()
    # No fake premium, no duplicate state written
    biz = mongo.businesses.find_one({"business_id": BID})
    assert not (biz.get("assistant_subscription") or {})
    st = owner.get(f"{BASE}/api/subscription/status", timeout=30).json()
    assert st["status"] == "trial"
    assert st["assistant_access"] is True
