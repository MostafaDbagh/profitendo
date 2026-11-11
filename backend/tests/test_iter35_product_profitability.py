"""Iter35: dashboard per-product profitability from POSTED records (not product master cost).

Scenario:
- Product A: master product_cost deliberately 0 (wrong/missing). Purchase 10 @ 60 (WAC=60).
  Sell 2 @ total 300 (posted COGS 120). Return 1 unit (refund 150, cogs reversed 60).
  Expected A: net revenue 150, net COGS 60, profit 90.00, margin 60.0%.
- Product B: purchased at 0 cost, sold @ 50 -> sold line has no reliable cost
  -> cost_available=False, profit/margin null (never a misleading zero).
"""
import os
import uuid

import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


@pytest.fixture(scope="module")
def tenant():
    tag = uuid.uuid4().hex[:6]
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/register", json={
        "name": f"TEST_pp_{tag}", "email": f"test.pp.{tag}@profitlens.app", "password": "TestPp123!",
    }, timeout=30)
    assert r.status_code in (200, 201), r.text
    s.post(f"{BASE}/api/business/setup", json={"name": f"TEST PP {tag}", "base_currency": "USD"}, timeout=30)

    r = s.post(f"{BASE}/api/products", json={"name": f"TEST_ppA_{tag}", "selling_price": 150, "product_cost": 0}, timeout=30)
    pa = r.json()["product_id"]
    r = s.post(f"{BASE}/api/products", json={"name": f"TEST_ppB_{tag}", "selling_price": 50, "product_cost": 0}, timeout=30)
    pb = r.json()["product_id"]

    # real purchase costs (A=60/unit, B=0/unit)
    assert s.post(f"{BASE}/api/purchases", json={"supplier": "S", "payment_method": "cash",
                  "items": [{"product_id": pa, "quantity": 10, "unit_cost": 60}]}, timeout=30).status_code in (200, 201)
    assert s.post(f"{BASE}/api/purchases", json={"supplier": "S", "payment_method": "cash",
                  "items": [{"product_id": pb, "quantity": 1, "unit_cost": 0}]}, timeout=30).status_code in (200, 201)

    # sales
    r = s.post(f"{BASE}/api/sales", json={"payment_method": "cash",
               "items": [{"product_id": pa, "quantity": 2, "unit_price": 150, "total": 300}]}, timeout=30)
    assert r.status_code in (200, 201), r.text
    sale_a = r.json()["sale_id"]
    assert s.post(f"{BASE}/api/sales", json={"payment_method": "cash",
                  "items": [{"product_id": pb, "quantity": 1, "unit_price": 50, "total": 50}]}, timeout=30).status_code in (200, 201)

    # return 1 unit of A (refund 150, WAC 60 restocked)
    r = s.post(f"{BASE}/api/returns", json={"sale_id": sale_a, "reason": "changed_mind", "refund_method": "cash",
               "restock": True, "items": [{"product_id": pa, "quantity": 1}]}, timeout=30)
    assert r.status_code in (200, 201), r.text
    return {"s": s, "pa": pa, "pb": pb}


def test_product_profit_uses_posted_costs(tenant):
    d = tenant["s"].get(f"{BASE}/api/dashboard", timeout=30).json()
    prods = {p["product_id"]: p for p in d["products"]}
    a, b = prods[tenant["pa"]], prods[tenant["pb"]]

    # A: 150 revenue - 60 posted WAC COGS = 90 profit, 60% margin (master cost 0 ignored)
    assert a["revenue"] == 150.0
    assert a["actual_cogs"] == 60.0
    assert a["net_profit"] == 90.0
    assert a["profit_margin"] == 60.0
    assert a["cost_available"] is True

    # B: no reliable cost -> flagged, never a misleading number
    assert b["cost_available"] is False
    assert b["net_profit"] is None and b["profit_margin"] is None


def test_dashboard_sections_consistent(tenant):
    d = tenant["s"].get(f"{BASE}/api/dashboard", timeout=30).json()
    # most profitable = A; unknown-cost B never ranks as "lowest margin" zero
    assert d["top_profitable"][0]["product_id"] == tenant["pa"]
    assert d["top_profitable"][0]["net_profit"] == 90.0
    assert all(p["product_id"] != tenant["pb"] for p in d["lowest_margin"])
    # business KPIs from verified pipelines stay intact: 350 sales, 120-60=60 COGS
    assert d["total_sales"] == 350.0
    assert d["total_product_costs"] == 60.0
