"""Iter34: invoice draft autosave API + client_ref idempotency for sales/purchases/returns/purchase-returns."""
import os
import uuid

import pytest
import requests
from pymongo import MongoClient

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(scope="module")
def tenant():
    tag = uuid.uuid4().hex[:6]
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/register", json={
        "name": f"TEST_dr_{tag}", "email": f"test.dr.{tag}@profitlens.app", "password": "TestDr123!",
    }, timeout=30)
    assert r.status_code in (200, 201), r.text
    bid = r.json()["business_id"]
    s.post(f"{BASE}/api/business/setup", json={"name": f"TEST DR {tag}", "base_currency": "USD"}, timeout=30)
    r = s.post(f"{BASE}/api/products", json={"name": f"TEST_dr_p_{tag}", "selling_price": 50, "product_cost": 30}, timeout=30)
    return {"s": s, "bid": bid, "pid": r.json()["product_id"]}


def test_draft_crud_and_upsert(tenant, mongo):
    s, bid = tenant["s"], tenant["bid"]
    assert requests.put(f"{BASE}/api/drafts/sale", json={"payload": {}}, timeout=30).status_code == 401

    p1 = {"customer": "شركة الأمل", "items": [{"product_id": tenant["pid"], "quantity": 2}]}
    r = s.put(f"{BASE}/api/drafts/sale", json={"payload": p1}, timeout=30)
    assert r.status_code == 200 and r.json()["ok"]

    got = s.get(f"{BASE}/api/drafts/sale", timeout=30).json()
    assert got["payload"]["customer"] == "شركة الأمل"

    # second save upserts (no duplicates) — one doc per user+kind
    p2 = {"customer": "شركة النور", "items": [{"product_id": tenant["pid"], "quantity": 5}]}
    s.put(f"{BASE}/api/drafts/sale", json={"payload": p2}, timeout=30)
    got = s.get(f"{BASE}/api/drafts/sale", timeout=30).json()
    assert got["payload"]["customer"] == "شركة النور"
    uid = mongo.users.find_one({"business_id": bid})["user_id"]
    assert mongo.invoice_drafts.count_documents({"business_id": bid, "user_id": uid, "kind": "sale"}) == 1

    # invalid kind rejected
    assert s.put(f"{BASE}/api/drafts/hack", json={"payload": {}}, timeout=30).status_code == 404

    # delete clears
    s.delete(f"{BASE}/api/drafts/sale", timeout=30)
    assert s.get(f"{BASE}/api/drafts/sale", timeout=30).json()["payload"] is None


def test_sale_client_ref_idempotent(tenant, mongo):
    s, bid, pid = tenant["s"], tenant["bid"], tenant["pid"]
    r = s.post(f"{BASE}/api/purchases", json={"supplier": "TEST stock", "payment_method": "cash",
               "items": [{"product_id": pid, "quantity": 20, "unit_cost": 30}]}, timeout=30)
    assert r.status_code in (200, 201), r.text
    ref = f"test-ref-{uuid.uuid4().hex[:8]}"
    payload = {"payment_method": "cash", "client_ref": ref,
               "items": [{"product_id": pid, "quantity": 2, "unit_price": 50, "total": 100}]}
    stock0 = mongo.products.find_one({"product_id": pid})["stock_qty"]
    r1 = s.post(f"{BASE}/api/sales", json=payload, timeout=30)
    assert r1.status_code in (200, 201), r1.text
    # ensure stock for sale
    if "Insufficient" in r1.text:
        pytest.skip("no stock")
    r2 = s.post(f"{BASE}/api/sales", json=payload, timeout=30)  # retry (e.g. after network error)
    assert r2.status_code in (200, 201), r2.text
    assert r1.json()["sale_id"] == r2.json()["sale_id"]
    assert mongo.sales.count_documents({"business_id": bid, "client_ref": ref}) == 1
    je = mongo.journal_entries.count_documents({"business_id": bid, "source_type": "sale", "source_id": r1.json()["sale_id"]})
    assert je == 1  # compound sale entry (revenue + COGS lines) posted exactly once


def test_purchase_client_ref_idempotent(tenant, mongo):
    s, bid, pid = tenant["s"], tenant["bid"], tenant["pid"]
    ref = f"test-ref-{uuid.uuid4().hex[:8]}"
    payload = {"supplier": "TEST S", "payment_method": "cash", "client_ref": ref,
               "items": [{"product_id": pid, "quantity": 4, "unit_cost": 30}]}
    stock0 = mongo.products.find_one({"product_id": pid}).get("stock_qty", 0)
    r1 = s.post(f"{BASE}/api/purchases", json=payload, timeout=30)
    assert r1.status_code in (200, 201), r1.text
    r2 = s.post(f"{BASE}/api/purchases", json=payload, timeout=30)
    assert r1.json()["purchase_id"] == r2.json()["purchase_id"]
    assert mongo.purchases.count_documents({"business_id": bid, "client_ref": ref}) == 1
    stock1 = mongo.products.find_one({"product_id": pid})["stock_qty"]
    assert stock1 - stock0 == 4  # stock incremented exactly once despite retry


def test_return_client_ref_idempotent(tenant, mongo):
    s, bid, pid = tenant["s"], tenant["bid"], tenant["pid"]
    ref = f"test-ref-{uuid.uuid4().hex[:8]}"
    payload = {"reason": "changed_mind", "refund_method": "cash", "restock": True, "client_ref": ref,
               "items": [{"product_id": pid, "quantity": 1}]}
    r1 = s.post(f"{BASE}/api/returns", json=payload, timeout=30)
    assert r1.status_code in (200, 201), r1.text
    r2 = s.post(f"{BASE}/api/returns", json=payload, timeout=30)
    assert r1.json()["return_id"] == r2.json()["return_id"]
    assert mongo.returns.count_documents({"business_id": bid, "client_ref": ref}) == 1


def test_purchase_return_client_ref_idempotent(tenant, mongo):
    s, bid, pid = tenant["s"], tenant["bid"], tenant["pid"]
    pr = s.post(f"{BASE}/api/purchases", json={"supplier": "TEST S2", "payment_method": "cash",
                "items": [{"product_id": pid, "quantity": 3, "unit_cost": 30}]}, timeout=30).json()
    ref = f"test-ref-{uuid.uuid4().hex[:8]}"
    payload = {"purchase_id": pr["purchase_id"], "reason": "t", "refund_method": "cash", "client_ref": ref,
               "items": [{"product_id": pid, "quantity": 1}]}
    r1 = s.post(f"{BASE}/api/purchase-returns", json=payload, timeout=30)
    assert r1.status_code in (200, 201), r1.text
    r2 = s.post(f"{BASE}/api/purchase-returns", json=payload, timeout=30)
    assert r1.json()["return_id"] == r2.json()["return_id"]
    assert mongo.purchase_returns.count_documents({"business_id": bid, "client_ref": ref}) == 1


def test_draft_isolated_per_user(tenant):
    tag = uuid.uuid4().hex[:6]
    s2 = requests.Session()
    r = s2.post(f"{BASE}/api/auth/register", json={
        "name": f"TEST_dr2_{tag}", "email": f"test.dr2.{tag}@profitlens.app", "password": "TestDr123!",
    }, timeout=30)
    assert r.status_code in (200, 201)
    s2.post(f"{BASE}/api/business/setup", json={"name": f"TEST DR2 {tag}", "base_currency": "USD"}, timeout=30)
    # tenant A saved a draft earlier flow; new tenant must see none
    assert s2.get(f"{BASE}/api/drafts/sale", timeout=30).json()["payload"] is None
