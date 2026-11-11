"""Tests for launch_date/created_at/updated_at/age_days feature."""
import os
import uuid
import time
import pytest
import requests
from datetime import date, timedelta


def _load_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL missing")


BASE_URL = _load_backend_url()
API = f"{BASE_URL}/api"


def _new_email():
    return f"test.{uuid.uuid4().hex[:8]}@profitlens.app"


@pytest.fixture()
def user_session():
    s = requests.Session()
    email = _new_email()
    r = s.post(f"{API}/auth/register", json={"name": "Tester", "email": email, "password": "TestPass123!"})
    assert r.status_code == 200, r.text
    return s


# ---------- Auto timestamps ----------

class TestAutoTimestamps:
    def test_create_auto_sets_created_and_updated(self, user_session):
        # User cannot supply created_at - even if sent, ignored
        r = user_session.post(f"{API}/products", json={
            "name": "AUTO_TS", "selling_price": 10, "product_cost": 5, "quantity_sold": 1,
            "created_at": "2000-01-01T00:00:00+00:00",  # extra field ignored by Pydantic
        })
        assert r.status_code == 201, r.text
        p = r.json()
        assert "created_at" in p and p["created_at"]
        assert "updated_at" in p and p["updated_at"]
        assert p["created_at"] == p["updated_at"]
        # Must be a fresh timestamp, not 2000
        assert not p["created_at"].startswith("2000")

    def test_edit_bumps_updated_preserves_created_and_launch(self, user_session):
        r = user_session.post(f"{API}/products", json={
            "name": "EDIT_TS", "selling_price": 10, "product_cost": 5, "quantity_sold": 1,
            "launch_date": "2026-08-15",
        })
        p = r.json()
        pid = p["product_id"]
        created_at = p["created_at"]
        original_updated = p["updated_at"]
        launch = p["launch_date"]

        time.sleep(1.1)

        r = user_session.put(f"{API}/products/{pid}", json={
            "name": "EDIT_TS2", "selling_price": 12, "product_cost": 5, "quantity_sold": 1,
            "launch_date": "2026-08-15",
        })
        assert r.status_code == 200
        p2 = r.json()
        assert p2["created_at"] == created_at, "created_at must be preserved"
        assert p2["updated_at"] != original_updated, "updated_at must bump"
        assert p2["updated_at"] > original_updated
        assert p2["launch_date"] == launch


# ---------- launch_date behavior ----------

class TestLaunchDate:
    def test_null_launch_date(self, user_session):
        r = user_session.post(f"{API}/products", json={
            "name": "NULL_LD", "selling_price": 10, "product_cost": 5, "quantity_sold": 1,
        })
        assert r.status_code == 201
        p = r.json()
        assert p["launch_date"] is None
        assert p["age_days"] is None

    def test_empty_string_launch_date_normalized_to_null(self, user_session):
        r = user_session.post(f"{API}/products", json={
            "name": "EMPTY_LD", "selling_price": 10, "product_cost": 5, "quantity_sold": 1,
            "launch_date": "",
        })
        assert r.status_code == 201
        p = r.json()
        assert p["launch_date"] is None
        assert p["age_days"] is None

    def test_valid_launch_date_and_age(self, user_session):
        seven_ago = (date.today() - timedelta(days=7)).isoformat()
        r = user_session.post(f"{API}/products", json={
            "name": "AGE7", "selling_price": 10, "product_cost": 5, "quantity_sold": 1,
            "launch_date": seven_ago,
        })
        assert r.status_code == 201
        p = r.json()
        assert p["launch_date"] == seven_ago
        assert p["age_days"] == 7

    def test_future_launch_date_age_zero(self, user_session):
        future = (date.today() + timedelta(days=5)).isoformat()
        r = user_session.post(f"{API}/products", json={
            "name": "FUTURE", "selling_price": 10, "product_cost": 5, "quantity_sold": 1,
            "launch_date": future,
        })
        assert r.status_code == 201
        p = r.json()
        assert p["age_days"] == 0  # clamped to 0

    def test_today_age_zero(self, user_session):
        today = date.today().isoformat()
        r = user_session.post(f"{API}/products", json={
            "name": "TODAY", "selling_price": 10, "product_cost": 5, "quantity_sold": 1,
            "launch_date": today,
        })
        assert r.status_code == 201
        assert r.json()["age_days"] == 0

    def test_invalid_launch_date_returns_422(self, user_session):
        r = user_session.post(f"{API}/products", json={
            "name": "BAD_LD", "selling_price": 10, "product_cost": 5, "quantity_sold": 1,
            "launch_date": "not-a-date",
        })
        assert r.status_code == 422

    def test_update_to_null_clears_launch(self, user_session):
        r = user_session.post(f"{API}/products", json={
            "name": "CLR", "selling_price": 10, "product_cost": 5, "quantity_sold": 1,
            "launch_date": "2026-01-01",
        })
        pid = r.json()["product_id"]
        r = user_session.put(f"{API}/products/{pid}", json={
            "name": "CLR", "selling_price": 10, "product_cost": 5, "quantity_sold": 1,
            "launch_date": None,
        })
        assert r.status_code == 200
        p = r.json()
        assert p["launch_date"] is None
        assert p["age_days"] is None


# ---------- Profit math regression (spec example) ----------

def _seed_qty(product_id, qty):
    """Simulate completed sales transactions: quantity_sold is transaction-derived (Option A)."""
    import pymongo
    from dotenv import dotenv_values
    env = dotenv_values("/app/backend/.env")
    db = pymongo.MongoClient(env["MONGO_URL"])[env["DB_NAME"]]
    db.products.update_one({"product_id": product_id}, {"$set": {"quantity_sold": qty}})

class TestProfitRegression:
    def test_spec_example_mixed_modes(self, user_session):
        r = user_session.post(f"{API}/products", json={
            "name": "SPEC", "selling_price": 100, "product_cost": 40,
            "shipping_cost": 5, "shipping_cost_mode": "unit",
            "advertising_cost": 100, "advertising_cost_mode": "total",
            "payment_fee": 3, "payment_fee_mode": "unit",
        })
        assert r.status_code == 201, r.text
        pid = r.json()["product_id"]
        _seed_qty(pid, 10)
        p = user_session.get(f"{API}/products/{pid}").json()
        assert p["total_costs"] == 580
        assert p["net_profit"] == 420
        assert p["profit_margin"] == 42

    def test_percent_discount_10(self, user_session):
        r = user_session.post(f"{API}/products", json={
            "name": "PCT10", "selling_price": 100, "product_cost": 40, "quantity_sold": 10,
            "discount": 10, "discount_mode": "percent",
        })
        p = r.json()
        assert p["breakdown"]["discount"] == 10

    def test_percent_discount_over_100_rejected(self, user_session):
        r = user_session.post(f"{API}/products", json={
            "name": "BAD", "selling_price": 100, "product_cost": 40, "quantity_sold": 1,
            "discount": 150, "discount_mode": "percent",
        })
        assert r.status_code == 422
