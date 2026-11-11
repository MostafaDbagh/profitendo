"""Iter26: General Ledger integration — automatic double-entry posting.

Scenarios (per requirement):
 cash sale (Revenue + COGS/Inventory legs), credit sale (AR), inventory purchase
 cash & credit (AP), cash expense posting, edit/delete reversal workflows,
 return posting, idempotent backfill, trial-balance equilibrium, GL-derived
 income statement & balance sheet.
"""
import os
import uuid

import pytest
import requests
from pymongo import MongoClient

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
OWNER = {"email": "test.seller@profitlens.app", "password": "TestSeller123!"}
PIN = "4321"
BID = "biz_7101d3986f3c"

CODE = {"cash": "1100", "bank": "1200", "ar": "1300", "inventory": "1400",
        "ap": "2100", "revenue": "4100", "cogs": "5100", "rent": "6100", "utilities": "6810"}


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
    me = s.get(f"{BASE}/api/auth/me", timeout=30).json()
    if not me["business"].get("pin_enabled"):
        sr = s.post(f"{BASE}/api/auth/pin", json={"pin": PIN}, timeout=30)
        assert sr.status_code in (200, 201), sr.text
    return s


@pytest.fixture(scope="module")
def product(owner):
    tag = uuid.uuid4().hex[:6]
    r = owner.post(f"{BASE}/api/products", json={"name": f"TEST_gl_{tag}", "selling_price": 50, "product_cost": 10}, timeout=30)
    assert r.status_code in (200, 201), r.text
    p = r.json()
    sp = owner.post(f"{BASE}/api/purchases", json={
        "supplier": "TEST_gl_seed",
        "items": [{"product_id": p["product_id"], "quantity": 100, "unit_cost": 10}],
    }, timeout=30)
    assert sp.status_code == 201, sp.text
    p["_seed_purchase"] = sp.json()
    yield p
    owner.delete(f"{BASE}/api/products/{p['product_id']}", timeout=30)


def _journal(sess):
    r = sess.get(f"{BASE}/api/ledger/journal", timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _entries_for(sess, source_id):
    return [e for e in _journal(sess) if e.get("source_id") == source_id]


def _active_for(sess, source_id):
    return [e for e in _entries_for(sess, source_id) if e["kind"] == "posted" and not e.get("is_reversed")]


def _legs(entry):
    return {l["code"]: {"debit": l["debit"], "credit": l["credit"]} for l in entry["lines"]}


def _net_for_source(sess, source_id):
    net = {}
    for e in _entries_for(sess, source_id):
        for l in e["lines"]:
            d = net.setdefault(l["code"], 0.0)
            net[l["code"]] = round(d + l["debit"] - l["credit"], 2)
    return net


# ---------------------------------------------------------------- backfill & idempotency

def test_01_backfill_historical_idempotent(owner, mongo):
    mongo.journal_entries.delete_many({"business_id": BID})  # clean slate for deterministic counts
    r1 = owner.post(f"{BASE}/api/ledger/backfill", timeout=60)
    assert r1.status_code == 200, r1.text
    s1 = r1.json()
    assert sum(s1.values()) > 0  # tenant has historical docs from earlier suites
    n1 = mongo.journal_entries.count_documents({"business_id": BID})
    assert mongo.journal_entries.count_documents({"business_id": BID, "backfilled": True}) == n1
    r2 = owner.post(f"{BASE}/api/ledger/backfill", timeout=60)
    assert all(v == 0 for v in r2.json().values())  # idempotent re-run
    assert mongo.journal_entries.count_documents({"business_id": BID}) == n1


# ---------------------------------------------------------------- posting scenarios

def test_02_cash_sale_posts_revenue_and_cogs(owner, product):
    r = owner.post(f"{BASE}/api/sales", json={
        "payment_method": "cash",
        "items": [{"product_id": product["product_id"], "quantity": 2, "unit_price": 50}],
    }, timeout=30)
    assert r.status_code == 201, r.text
    sale = r.json()
    active = _active_for(owner, sale["sale_id"])
    assert len(active) == 1
    e = active[0]
    assert e["total_debit"] == e["total_credit"] == 120.0
    legs = _legs(e)
    assert legs[CODE["cash"]] == {"debit": 100.0, "credit": 0.0}
    assert legs[CODE["revenue"]] == {"debit": 0.0, "credit": 100.0}
    assert legs[CODE["cogs"]] == {"debit": 20.0, "credit": 0.0}
    assert legs[CODE["inventory"]] == {"debit": 0.0, "credit": 20.0}
    product["_cash_sale"] = sale


def test_03_credit_sale_posts_receivable(owner, product):
    r = owner.post(f"{BASE}/api/sales", json={
        "payment_method": "credit",
        "items": [{"product_id": product["product_id"], "quantity": 1, "unit_price": 50}],
    }, timeout=30)
    assert r.status_code == 201, r.text
    sale = r.json()
    legs = _legs(_active_for(owner, sale["sale_id"])[0])
    assert legs[CODE["ar"]]["debit"] == 50.0
    assert legs[CODE["revenue"]]["credit"] == 50.0
    assert CODE["cash"] not in legs
    product["_credit_sale"] = sale


def test_04_purchase_cash_and_credit(owner, product):
    # cash purchase (the seed purchase, backfilled in test_01 is for other docs — this one posts live)
    r = owner.post(f"{BASE}/api/purchases", json={
        "supplier": "TEST_gl_cash", "payment_method": "cash",
        "items": [{"product_id": product["product_id"], "quantity": 5, "unit_cost": 10}],
        "additional_costs": 5,
    }, timeout=30)
    assert r.status_code == 201, r.text
    pur = r.json()
    legs = _legs(_active_for(owner, pur["purchase_id"])[0])
    assert legs[CODE["inventory"]]["debit"] == 50.0
    assert legs["5200"]["debit"] == 5.0  # purchase shipping
    assert legs[CODE["cash"]]["credit"] == 55.0

    r2 = owner.post(f"{BASE}/api/purchases", json={
        "supplier": "TEST_gl_credit", "payment_method": "credit",
        "items": [{"product_id": product["product_id"], "quantity": 3, "unit_cost": 10}],
    }, timeout=30)
    assert r2.status_code == 201, r2.text
    legs2 = _legs(_active_for(owner, r2.json()["purchase_id"])[0])
    assert legs2[CODE["ap"]]["credit"] == 30.0
    assert legs2[CODE["inventory"]]["debit"] == 30.0


def test_05_cash_expense_posts_category_account(owner):
    r = owner.post(f"{BASE}/api/expenses", json={"amount": 75, "category": "rent", "payment_method": "cash"}, timeout=30)
    assert r.status_code == 201, r.text
    exp = r.json()
    legs = _legs(_active_for(owner, exp["expense_id"])[0])
    assert legs[CODE["rent"]] == {"debit": 75.0, "credit": 0.0}
    assert legs[CODE["cash"]]["credit"] == 75.0

    r2 = owner.post(f"{BASE}/api/expenses", json={"amount": 15, "category": "utilities", "payment_method": "card"}, timeout=30)
    assert r2.status_code == 201, r2.text
    legs2 = _legs(_active_for(owner, r2.json()["expense_id"])[0])
    assert legs2[CODE["utilities"]]["debit"] == 15.0  # auto-created category account
    assert legs2[CODE["bank"]]["credit"] == 15.0
    r2.json() and owner.delete(f"{BASE}/api/expenses/{r2.json()['expense_id']}", timeout=30)


def test_06_return_posts_reversal_legs(owner, product):
    sale = product["_cash_sale"]
    r = owner.post(f"{BASE}/api/returns", json={
        "sale_id": sale["sale_id"], "reason": "defect", "restock": True, "refund_method": "cash",
        "items": [{"product_id": product["product_id"], "quantity": 1}],
    }, timeout=30)
    assert r.status_code == 201, r.text
    ret = r.json()
    legs = _legs(_active_for(owner, ret["return_id"])[0])
    assert legs[CODE["revenue"]]["debit"] == 50.0
    assert legs[CODE["cash"]]["credit"] == 50.0
    assert legs[CODE["inventory"]]["debit"] == 10.0
    assert legs[CODE["cogs"]]["credit"] == 10.0


# ---------------------------------------------------------------- mutation safety

def test_07_sale_edit_reverses_and_reposts(owner, product):
    sale = product["_credit_sale"]
    r = owner.put(f"{BASE}/api/sales/{sale['sale_id']}", json={
        "pin": PIN,
        "items": [{"product_id": product["product_id"], "quantity": 3, "unit_price": 50}],
    }, timeout=30)
    assert r.status_code == 200, r.text
    entries = _entries_for(owner, sale["sale_id"])
    kinds = sorted((e["kind"], e.get("is_reversed", False)) for e in entries)
    assert ("posted", True) in kinds and ("posted", False) in kinds and ("reversal", False) in kinds
    active = _active_for(owner, sale["sale_id"])
    assert len(active) == 1 and active[0]["total_debit"] == 180.0  # AR 150 + COGS 30 legs
    net = _net_for_source(owner, sale["sale_id"])
    assert net[CODE["ar"]] == 150.0 and net[CODE["revenue"]] == -150.0  # net effect = new entry only
    assert net[CODE["cogs"]] == 30.0 and net[CODE["inventory"]] == -30.0


def test_08_sale_cancel_posts_reversal_net_zero(owner, product):
    sale = product["_cash_sale"]
    r = owner.post(f"{BASE}/api/sales/{sale['sale_id']}/cancel", timeout=30)
    assert r.status_code == 200, r.text
    net = _net_for_source(owner, sale["sale_id"])
    assert all(abs(v) < 0.005 for v in net.values())  # fully reversed
    assert _active_for(owner, sale["sale_id"]) == []


def test_09_expense_delete_posts_reversal(owner):
    r = owner.post(f"{BASE}/api/expenses", json={"amount": 40, "category": "other", "payment_method": "cash"}, timeout=30)
    exp = r.json()
    assert len(_active_for(owner, exp["expense_id"])) == 1
    d = owner.delete(f"{BASE}/api/expenses/{exp['expense_id']}", timeout=30)
    assert d.status_code == 200, d.text
    assert _active_for(owner, exp["expense_id"]) == []
    net = _net_for_source(owner, exp["expense_id"])
    assert all(abs(v) < 0.005 for v in net.values())


def test_10_no_duplicate_active_entry_per_source(owner, product, mongo):
    # resubmitting the same source (e.g. page refresh of backfill) never duplicates
    sale = product["_credit_sale"]
    assert mongo.journal_entries.count_documents(
        {"business_id": BID, "source_id": sale["sale_id"], "kind": "posted", "is_reversed": False}
    ) == 1


# ---------------------------------------------------------------- statements

def test_11_trial_balance_balanced(owner):
    r = owner.get(f"{BASE}/api/ledger/trial-balance", timeout=60)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["balanced"] is True
    assert d["total_debit"] == d["total_credit"] > 0
    codes = {row["code"] for row in d["rows"]}
    assert {CODE["cash"], CODE["revenue"], CODE["cogs"], CODE["inventory"], CODE["ar"], CODE["ap"]} <= codes


def test_12_income_statement_gl_derived(owner):
    d = owner.get(f"{BASE}/api/ledger/income-statement", timeout=60).json()
    assert d["revenue_total"] > 0
    assert d["gross_profit"] == round(d["revenue_total"] - d["cogs_total"], 2)
    assert d["net_income"] == round(d["gross_profit"] - d["expenses_total"], 2)


def test_13_balance_sheet_balances(owner):
    d = owner.get(f"{BASE}/api/ledger/balance-sheet", timeout=60).json()
    assert d["balanced"] is True
    assert d["total_assets"] == round(d["total_liabilities"] + d["total_equity"] + d["current_earnings"], 2)


def test_14_income_statement_date_range(owner):
    d = owner.get(f"{BASE}/api/ledger/income-statement", params={"from_date": "2999-01-01"}, timeout=30).json()
    assert d["revenue_total"] == 0 and d["expenses_total"] == 0 and d["net_income"] == 0
    d2 = owner.get(f"{BASE}/api/ledger/income-statement", params={"to_date": "2000-01-01"}, timeout=30).json()
    assert d2["revenue_total"] == 0
