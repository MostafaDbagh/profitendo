"""Iter32: Danger Zone — owner-only full company data reset (DELETE /api/business/data)."""
import os
import uuid

import pytest
import requests
from pymongo import MongoClient

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
PHRASE = "DELETE ALL DATA"

WIPE_COLLECTIONS = [
    "sales", "returns", "purchases", "purchase_returns", "expenses",
    "inventory_movements", "cash_closings", "withdrawals",
    "partners", "partner_transactions", "products",
    "journal_entries", "accounts", "assistant_messages",
]


@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(scope="module")
def tenant(mongo):
    """Fresh populated company: owner + employee + product/purchase/sale/expense."""
    tag = uuid.uuid4().hex[:6]
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/register", json={
        "name": f"TEST_dz_{tag}", "email": f"test.dz.{tag}@profitlens.app", "password": "TestDz123!",
    }, timeout=30)
    assert r.status_code in (200, 201), r.text
    s.post(f"{BASE}/api/business/setup", json={"name": f"TEST DZ {tag}", "base_currency": "USD"}, timeout=30)
    bid = r.json()["business_id"]

    # populate operational data
    r = s.post(f"{BASE}/api/products", json={"name": f"TEST_dz_p_{tag}", "selling_price": 100, "product_cost": 60}, timeout=30)
    assert r.status_code in (200, 201), r.text
    pid = r.json()["product_id"]
    r = s.post(f"{BASE}/api/purchases", json={
        "supplier": "TEST Supplier", "payment_method": "cash",
        "items": [{"product_id": pid, "quantity": 10, "unit_cost": 60}],
    }, timeout=30)
    assert r.status_code in (200, 201), r.text
    r = s.post(f"{BASE}/api/sales", json={
        "payment_method": "cash", "items": [{"product_id": pid, "quantity": 3, "unit_price": 100}],
    }, timeout=30)
    assert r.status_code in (200, 201), r.text
    r = s.post(f"{BASE}/api/expenses", json={"amount": 50, "category": "rent", "description": "TEST"}, timeout=30)
    assert r.status_code in (200, 201), r.text

    # employee for 403 check
    uname = f"testdz{tag}"
    r = s.post(f"{BASE}/api/team", json={
        "name": f"TEST_dz_emp_{tag}", "role": "EMPLOYEE", "username": uname, "password": "TestDz123!",
    }, timeout=30)
    assert r.status_code == 201, r.text
    emp = requests.Session()
    lr = emp.post(f"{BASE}/api/auth/kiosk-login", json={"username": uname, "password": "TestDz123!"}, timeout=30)
    assert lr.status_code == 200, lr.text

    # sanity: data exists before wipe
    for coll in ("products", "sales", "purchases", "expenses", "journal_entries", "inventory_movements"):
        assert mongo[coll].count_documents({"business_id": bid}) > 0, coll
    return {"owner": s, "employee": emp, "bid": bid, "pid": pid}


def test_employee_forbidden(tenant):
    r = tenant["employee"].delete(f"{BASE}/api/business/data", json={"confirmation": PHRASE}, timeout=30)
    assert r.status_code == 403


def test_unauthenticated_rejected():
    assert requests.delete(f"{BASE}/api/business/data", json={"confirmation": PHRASE}, timeout=30).status_code == 401


def test_wrong_phrase_rejected(tenant, mongo):
    r = tenant["owner"].delete(f"{BASE}/api/business/data", json={"confirmation": "delete all data"}, timeout=30)
    assert r.status_code == 400
    assert mongo.products.count_documents({"business_id": tenant["bid"]}) > 0


def test_owner_reset_wipes_operational_data(tenant, mongo):
    bid = tenant["bid"]
    r = tenant["owner"].delete(f"{BASE}/api/business/data", json={"confirmation": PHRASE}, timeout=60)
    assert r.status_code == 200, r.text
    deleted = r.json()["deleted"]
    assert deleted["sales"] >= 1 and deleted["products"] >= 1

    for coll in WIPE_COLLECTIONS:
        if coll == "accounts":
            continue
        assert mongo[coll].count_documents({"business_id": bid}) == 0, coll
    assert mongo.counters.count_documents({"_id": {"$regex": f"^{bid}:"}}) == 0

    # chart of accounts re-seeded like a fresh instance, GL empty
    accts = list(mongo.accounts.find({"business_id": bid}))
    assert len(accts) > 0 and all(a.get("is_system") for a in accts)
    assert mongo.journal_entries.count_documents({"business_id": bid}) == 0

    # KEEP: business, owner user, settings intact (name/currency), cash_opening zeroed
    biz = mongo.businesses.find_one({"business_id": bid})
    assert biz is not None and biz["name"].startswith("TEST DZ") and biz["base_currency"] == "USD"
    assert (biz.get("cash_opening") or 0) == 0
    assert mongo.users.count_documents({"business_id": bid}) == 2  # owner + employee

    # audit trail preserved + reset action logged
    assert mongo.audit_logs.find_one({"business_id": bid, "action": "business.data_reset"}) is not None


def test_fresh_state_after_reset(tenant, mongo):
    bid = tenant["bid"]
    s = tenant["owner"]

    # re-login still works (auth intact)
    r = s.post(f"{BASE}/api/auth/login", json={
        "email": mongo.users.find_one({"business_id": bid, "role": "OWNER"})["email"], "password": "TestDz123!",
    }, timeout=30)
    assert r.status_code == 200, r.text

    # KPIs zero
    d = s.get(f"{BASE}/api/dashboard", timeout=30).json()
    assert d["total_sales"] == 0 and d["total_product_costs"] == 0 and d["net_profit"] == 0

    # trial balance empty & balanced
    tb = s.get(f"{BASE}/api/ledger/trial-balance", timeout=30).json()
    assert sum(rw["debit"] for rw in tb["rows"]) == sum(rw["credit"] for rw in tb["rows"])

    # onboarding reset to fresh-instance state
    ob = s.get(f"{BASE}/api/onboarding", timeout=30).json()
    assert ob["required"] is True and ob["step"] == 0

    # backup feature still functional post-reset
    assert s.get(f"{BASE}/api/backup/export", timeout=30).status_code == 200

    # owner can transact immediately; invoice numbering restarted
    r = s.post(f"{BASE}/api/products", json={"name": "TEST_dz_new", "selling_price": 10, "product_cost": 5}, timeout=30)
    assert r.status_code in (200, 201), r.text
    pid = r.json()["product_id"]
    s.post(f"{BASE}/api/purchases", json={
        "supplier": "S", "payment_method": "cash", "items": [{"product_id": pid, "quantity": 5, "unit_cost": 5}],
    }, timeout=30)
    r = s.post(f"{BASE}/api/sales", json={
        "payment_method": "cash", "items": [{"product_id": pid, "quantity": 1, "unit_price": 10}],
    }, timeout=30)
    assert r.status_code in (200, 201), r.text
    sale = r.json()
    assert sale["sale_number"].endswith("0001")
    # GL posts again on the fresh chart
    assert mongo.journal_entries.count_documents({"business_id": bid}) >= 2  # purchase + sale
