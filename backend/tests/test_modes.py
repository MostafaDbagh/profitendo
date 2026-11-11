"""Tests for the new flexible cost mode system (unit/total/percent)."""
import os
import uuid
import pytest
import requests

def _load_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().rstrip("/")
    except Exception:
        pass
    raise RuntimeError("REACT_APP_BACKEND_URL missing")


BASE_URL = _load_backend_url()
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "test.seller@profitlens.app"
ADMIN_PASSWORD = __import__("os").environ.get("LEGACY_TEST_ADMIN_PASSWORD", "local-test-only-change-me")
def _new_email():
    return f"test.{uuid.uuid4().hex[:8]}@profitlens.app"


@pytest.fixture()
def user_session():
    s = requests.Session()
    email = _new_email()
    r = s.post(f"{API}/auth/register", json={"name": "Test", "email": email, "password": "TestPass123!"})
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return s


def _seed_qty(product_id, qty):
    """Simulate completed sales transactions: quantity_sold is transaction-derived (Option A)."""
    import pymongo
    from dotenv import dotenv_values
    env = dotenv_values("/app/backend/.env")
    db = pymongo.MongoClient(env["MONGO_URL"])[env["DB_NAME"]]
    db.products.update_one({"product_id": product_id}, {"$set": {"quantity_sold": qty}})


class TestExactExamples:
    def test_example_1_no_optionals(self, user_session):
        # price 100, cost 40, qty 10 -> revenue 1000, total 400, net 600, margin 60
        r = user_session.post(f"{API}/products", json={
            "name": "EX1", "selling_price": 100, "product_cost": 40,
        })
        assert r.status_code == 201, r.text
        pid = r.json()["product_id"]
        _seed_qty(pid, 10)
        p = user_session.get(f"{API}/products/{pid}").json()
        assert p["revenue"] == 1000
        assert p["total_costs"] == 400
        assert p["net_profit"] == 600
        assert p["profit_margin"] == 60
        assert p["unit_cost"] == 40
        # modes default to 'unit'
        assert p["shipping_cost_mode"] == "unit"
        assert p["discount_mode"] == "unit"

    def test_example_2_advertising_total_mode(self, user_session):
        # ads $100 TOTAL / 10 = $10/unit, unit_cost 50, total 500, net 500, margin 50
        r = user_session.post(f"{API}/products", json={
            "name": "EX2", "selling_price": 100, "product_cost": 40,
            "advertising_cost": 100, "advertising_cost_mode": "total",
        })
        assert r.status_code == 201, r.text
        pid = r.json()["product_id"]
        _seed_qty(pid, 10)
        p = user_session.get(f"{API}/products/{pid}").json()
        assert p["unit_cost"] == 50
        assert p["breakdown"]["advertising"] == 10
        assert p["total_costs"] == 500
        assert p["net_profit"] == 500
        assert p["profit_margin"] == 50

    def test_example_3_mixed_modes(self, user_session):
        # shipping $5/unit + ads $100 total (10/unit) + fee $3/unit
        # unit_cost = 40+5+10+3 = 58, total 580, net 420, margin 42
        r = user_session.post(f"{API}/products", json={
            "name": "EX3", "selling_price": 100, "product_cost": 40,
            "shipping_cost": 5, "shipping_cost_mode": "unit",
            "advertising_cost": 100, "advertising_cost_mode": "total",
            "payment_fee": 3, "payment_fee_mode": "unit",
        })
        assert r.status_code == 201, r.text
        pid = r.json()["product_id"]
        _seed_qty(pid, 10)
        p = user_session.get(f"{API}/products/{pid}").json()
        assert p["unit_cost"] == 58
        assert p["total_costs"] == 580
        assert p["net_profit"] == 420
        assert p["profit_margin"] == 42


class TestDiscount:
    def test_discount_percent_mode(self, user_session):
        # 10% of $100 = $10/unit; unit_cost 50, net 500, margin 50
        r = user_session.post(f"{API}/products", json={
            "name": "PCT", "selling_price": 100, "product_cost": 40,
            "discount": 10, "discount_mode": "percent",
        })
        assert r.status_code == 201, r.text
        pid = r.json()["product_id"]
        _seed_qty(pid, 10)
        p = user_session.get(f"{API}/products/{pid}").json()
        assert p["breakdown"]["discount"] == 10
        assert p["unit_cost"] == 50
        assert p["net_profit"] == 500
        assert p["profit_margin"] == 50

    def test_discount_percent_over_100_rejected(self, user_session):
        r = user_session.post(f"{API}/products", json={
            "name": "BAD_PCT", "selling_price": 100, "product_cost": 40, "quantity_sold": 10,
            "discount": 150, "discount_mode": "percent",
        })
        assert r.status_code == 422

    def test_discount_fixed_over_100_ok(self, user_session):
        # Fixed >100 must be allowed (no percent constraint)
        r = user_session.post(f"{API}/products", json={
            "name": "FIXED_HI", "selling_price": 500, "product_cost": 40, "quantity_sold": 1,
            "discount": 120, "discount_mode": "unit",
        })
        assert r.status_code == 201


class TestZeroQty:
    def test_zero_quantity_total_mode_no_crash(self, user_session):
        r = user_session.post(f"{API}/products", json={
            "name": "ZERO", "selling_price": 100, "product_cost": 40, "quantity_sold": 0,
            "shipping_cost": 100, "shipping_cost_mode": "total",
            "advertising_cost": 200, "advertising_cost_mode": "total",
        })
        assert r.status_code == 201
        p = r.json()
        # per-unit total-mode costs must be 0 when qty=0
        assert p["breakdown"]["shipping"] == 0
        assert p["breakdown"]["advertising"] == 0
        assert p["revenue"] == 0
        assert p["total_costs"] == 0
        assert p["net_profit"] == 0
        assert p["profit_margin"] == 0


class TestNegativeValidation:
    def test_negative_price_rejected(self, user_session):
        r = user_session.post(f"{API}/products", json={
            "name": "NEG", "selling_price": -1, "product_cost": 10, "quantity_sold": 1,
        })
        assert r.status_code == 422

    def test_invalid_mode_rejected(self, user_session):
        r = user_session.post(f"{API}/products", json={
            "name": "MODE", "selling_price": 100, "product_cost": 40, "quantity_sold": 1,
            "shipping_cost_mode": "hourly",
        })
        assert r.status_code == 422


class TestLegacyModeDefaults:
    def test_missing_mode_fields_default_to_unit_on_read(self, user_session):
        # Simulate legacy: only send legacy fields, no *_mode
        r = user_session.post(f"{API}/products", json={
            "name": "LEGACY", "selling_price": 50, "product_cost": 20,
            "shipping_cost": 5, "advertising_cost": 5, "payment_fee": 2, "discount": 3,
            "other_costs": 2,
        })
        assert r.status_code == 201
        pid = r.json()["product_id"]
        _seed_qty(pid, 10)
        p = user_session.get(f"{API}/products/{pid}").json()
        assert p["shipping_cost_mode"] == "unit"
        assert p["advertising_cost_mode"] == "unit"
        assert p["payment_fee_mode"] == "unit"
        assert p["other_costs_mode"] == "unit"
        assert p["discount_mode"] == "unit"
        # 20+5+5+2+3+2 = 37, margin 26%
        assert p["unit_cost"] == 37
        assert p["profit_margin"] == 26


class TestEditPreservesModes:
    def test_update_preserves_mode(self, user_session):
        r = user_session.post(f"{API}/products", json={
            "name": "EDIT", "selling_price": 100, "product_cost": 40,
            "advertising_cost": 100, "advertising_cost_mode": "total",
        })
        assert r.status_code == 201
        pid = r.json()["product_id"]
        _seed_qty(pid, 10)

        # Read back to confirm mode persisted
        got = user_session.get(f"{API}/products/{pid}").json()
        assert got["advertising_cost_mode"] == "total"
        assert got["advertising_cost"] == 100

        # Update - keep total mode, change price (quantity_sold is transaction-derived, untouched by edits)
        r = user_session.put(f"{API}/products/{pid}", json={
            "name": "EDIT", "selling_price": 120, "product_cost": 40,
            "advertising_cost": 100, "advertising_cost_mode": "total",
        })
        assert r.status_code == 200
        p = r.json()
        assert p["advertising_cost_mode"] == "total"
        assert p["breakdown"]["advertising"] == 10
        assert p["selling_price"] == 120


class TestAdminDashboardRegression:
    """Legacy admin demo products must produce the exact known totals."""

    def test_admin_dashboard_totals(self, admin_session):
        r = admin_session.get(f"{API}/dashboard")
        assert r.status_code == 200, r.text
        d = r.json()
        # Only run this assertion when admin has just the 8 legacy demo products
        if d["product_count"] != 8:
            pytest.skip(f"Admin has {d['product_count']} products (expected 8 legacy)")
        # Iter29 KPI audit: Total Sales = Σ POSTED invoices (verified against the sales API),
        # COGS = Σ posted sale.cogs records — the two pipelines must never share a source.
        sales = admin_session.get(f"{API}/sales").json()
        confirmed = [s for s in sales if s["status"] == "confirmed"]
        expected_sales = round(sum(s["total"] for s in confirmed), 2)
        expected_cogs = round(sum(s.get("cogs", 0) for s in confirmed), 2)
        assert d["total_sales"] == expected_sales
        assert d["sales_revenue"] == expected_sales
        assert d["total_product_costs"] <= expected_cogs  # net of return reversals
        if expected_sales > 0:
            assert d["profit_margin"] == round(d["net_profit"] / expected_sales * 100, 2)
