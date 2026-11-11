"""Iter31: first-time onboarding wizard — state persistence, existing-user guard,
skip/complete/restart lifecycle, business_type field."""
import os
import uuid

import pytest
import requests
from pymongo import MongoClient

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
OWNER = {"email": "test.seller@profitlens.app", "password": "TestSeller123!"}


@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(scope="module")
def owner():
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json=OWNER, timeout=30)
    assert r.status_code == 200, r.text
    return s


def _register(tag):
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/register", json={
        "name": f"TEST_ob_{tag}", "email": f"test.ob.{tag}@profitlens.app", "password": "TestOnb123!",
    }, timeout=30)
    assert r.status_code in (200, 201), r.text
    return s


def test_unauthenticated_rejected():
    assert requests.get(f"{BASE}/api/onboarding", timeout=30).status_code == 401


def test_existing_business_auto_bypassed(owner, mongo):
    r = owner.post(f"{BASE}/api/products", json={
        "name": f"TEST_ob_{uuid.uuid4().hex[:6]}", "selling_price": 10, "product_cost": 5,
    }, timeout=30)
    assert r.status_code in (200, 201), r.text
    mongo.users.update_one({"email": OWNER["email"]}, {"$unset": {"onboarding": ""}})
    r = owner.get(f"{BASE}/api/onboarding", timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["required"] is False
    assert d["status"] == "auto_bypassed"
    assert d["checklist"]["products"] is True


def test_restart_enables_guided_tour_for_existing_user(owner):
    r = owner.post(f"{BASE}/api/onboarding/restart", timeout=30)
    d = r.json()
    assert d["required"] is True and d["step"] == 0 and d["status"] == "in_progress"
    r2 = owner.put(f"{BASE}/api/onboarding", json={"status": "skipped"}, timeout=30)
    assert r2.json()["required"] is False
    r3 = owner.get(f"{BASE}/api/onboarding", timeout=30)
    assert r3.json()["status"] == "skipped" and r3.json()["required"] is False


def test_fresh_user_full_lifecycle(mongo):
    s = _register(uuid.uuid4().hex[:6])
    d = s.get(f"{BASE}/api/onboarding", timeout=30).json()
    assert d["required"] is True and d["step"] == 0 and d["status"] == "in_progress"
    assert d["checklist"]["business"] is False and d["checklist"]["products"] is False

    s.post(f"{BASE}/api/business/setup", json={"name": "TEST Ob Biz", "base_currency": "USD"}, timeout=30)
    d = s.get(f"{BASE}/api/onboarding", timeout=30).json()
    assert d["checklist"]["business"] is True

    d = s.put(f"{BASE}/api/onboarding", json={"step": 2}, timeout=30).json()
    assert d["step"] == 2
    d = s.get(f"{BASE}/api/onboarding", timeout=30).json()
    assert d["step"] == 2, "step must persist across requests (refresh-safe)"

    d = s.put(f"{BASE}/api/onboarding", json={"step": 3, "skip_step": "products"}, timeout=30).json()
    assert "products" in d["skipped_steps"]

    assert s.put(f"{BASE}/api/onboarding", json={"step": 9}, timeout=30).status_code == 422
    assert s.put(f"{BASE}/api/onboarding", json={"status": "bogus"}, timeout=30).status_code == 422
    assert s.put(f"{BASE}/api/onboarding", json={"skip_step": "welcome"}, timeout=30).status_code == 400

    d = s.put(f"{BASE}/api/onboarding", json={"status": "completed", "step": 5}, timeout=30).json()
    assert d["status"] == "completed" and d["required"] is False
    d = s.get(f"{BASE}/api/onboarding", timeout=30).json()
    assert d["status"] == "completed" and d["required"] is False


def test_operational_data_auto_bypass_for_new_account():
    s = _register(uuid.uuid4().hex[:6])
    s.post(f"{BASE}/api/business/setup", json={"name": "TEST Ob Data", "base_currency": "USD"}, timeout=30)
    r = s.post(f"{BASE}/api/products", json={"name": f"TEST_ob_{uuid.uuid4().hex[:6]}", "selling_price": 10, "product_cost": 5}, timeout=30)
    assert r.status_code in (200, 201), r.text
    d = s.get(f"{BASE}/api/onboarding", timeout=30).json()
    assert d["status"] == "auto_bypassed" and d["required"] is False
    assert d["checklist"]["products"] is True


def test_business_type_field(owner):
    r = owner.put(f"{BASE}/api/business", json={"business_type": "retail"}, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json()["business_type"] == "retail"
    r = owner.put(f"{BASE}/api/business", json={"business_type": "not-a-type"}, timeout=30)
    assert r.status_code == 400
    r = owner.get(f"{BASE}/api/business", timeout=30)
    assert r.json()["business_type"] == "retail"
