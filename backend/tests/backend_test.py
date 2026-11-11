"""Backend tests for ProfitLens (auth, products, dashboard, demo)"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://product-profit-3.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "test.seller@profitlens.app"
ADMIN_PASSWORD = __import__("os").environ.get("LEGACY_TEST_ADMIN_PASSWORD", "local-test-only-change-me")
def _new_email():
    return f"test.{uuid.uuid4().hex[:8]}@profitlens.app"


def _seed_qty(product_id, qty):
    """Simulate completed sales transactions: quantity_sold is transaction-derived (Option A)."""
    import pymongo
    from dotenv import dotenv_values
    env = dotenv_values("/app/backend/.env")
    db = pymongo.MongoClient(env["MONGO_URL"])[env["DB_NAME"]]
    db.products.update_one({"product_id": product_id}, {"$set": {"quantity_sold": qty}})


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    assert "access_token" in s.cookies
    return s


@pytest.fixture()
def new_user_session():
    s = requests.Session()
    email = _new_email()
    r = s.post(f"{API}/auth/register", json={"name": "Test User", "email": email, "password": "TestPass123!"})
    assert r.status_code == 200, r.text
    s.email = email
    return s


# ---------- Auth ----------

class TestAuth:
    def test_login_admin_success(self, admin_session):
        r = admin_session.get(f"{API}/auth/me")
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN_EMAIL

    def test_login_wrong_password(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong-pass-xxx"})
        assert r.status_code == 401

    def test_register_and_me(self, new_user_session):
        r = new_user_session.get(f"{API}/auth/me")
        assert r.status_code == 200
        data = r.json()
        assert data["email"] == new_user_session.email
        assert data["language"] == "ar"

    def test_duplicate_registration(self, new_user_session):
        r = requests.post(f"{API}/auth/register", json={"name": "Dup", "email": new_user_session.email, "password": "Whatever123"})
        assert r.status_code == 400

    def test_me_without_auth_401(self):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_logout_clears_cookie(self, new_user_session):
        r = new_user_session.post(f"{API}/auth/logout")
        assert r.status_code == 200
        # Cookie should be cleared; subsequent /me returns 401
        s = requests.Session()  # fresh session, don't send old cookie
        r2 = s.get(f"{API}/auth/me")
        assert r2.status_code == 401

    def test_set_language(self, new_user_session):
        r = new_user_session.put(f"{API}/auth/language", json={"language": "en"})
        assert r.status_code == 200
        assert r.json()["language"] == "en"
        me = new_user_session.get(f"{API}/auth/me").json()
        assert me["language"] == "en"


# ---------- Products CRUD ----------

class TestProducts:
    def test_create_get_update_delete(self, new_user_session):
        payload = {
            "name": "TEST_Widget",
            "sku": "TEST-001",
            "selling_price": 50,
            "product_cost": 20,
            "shipping_cost": 5,
            "advertising_cost": 5,
            "payment_fee": 2,
            "discount": 3,
            "other_costs": 2,
        }
        r = new_user_session.post(f"{API}/products", json=payload)
        assert r.status_code == 201, r.text
        p = r.json()
        assert p["name"] == "TEST_Widget"
        # quantity_sold is transaction-derived (Option A): simulate 10 completed sales
        _seed_qty(p["product_id"], 10)
        p = new_user_session.get(f"{API}/products/{p['product_id']}").json()
        # unit_cost = 20+5+5+2+3+2 = 37; unit_profit = 50-37 = 13; margin = 13/50 = 26%
        assert p["unit_cost"] == 37
        assert p["unit_profit"] == 13
        assert p["profit_margin"] == 26.0
        assert p["net_profit"] == 130  # 13 * 10
        pid = p["product_id"]

        # GET
        r = new_user_session.get(f"{API}/products/{pid}")
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Widget"

        # UPDATE
        payload["selling_price"] = 60
        r = new_user_session.put(f"{API}/products/{pid}", json=payload)
        assert r.status_code == 200
        assert r.json()["selling_price"] == 60
        assert r.json()["unit_profit"] == 23

        # DELETE
        r = new_user_session.delete(f"{API}/products/{pid}")
        assert r.status_code == 200
        r = new_user_session.get(f"{API}/products/{pid}")
        assert r.status_code == 404

    def test_list_products_empty_for_new_user(self, new_user_session):
        r = new_user_session.get(f"{API}/products")
        assert r.status_code == 200
        assert r.json() == []

    def test_products_require_auth(self):
        r = requests.get(f"{API}/products")
        assert r.status_code == 401


# ---------- Data isolation ----------

class TestIsolation:
    def test_user_b_cannot_see_user_a_products(self):
        # user A
        sa = requests.Session()
        emailA = _new_email()
        rar = sa.post(f"{API}/auth/register", json={"name": "UserA", "email": emailA, "password": "PassA123!"})
        assert rar.status_code == 200, rar.text
        ra = sa.post(f"{API}/products", json={
            "name": "TEST_UserA", "selling_price": 10, "product_cost": 3, "quantity_sold": 1
        })
        assert ra.status_code == 201
        pid = ra.json()["product_id"]

        # user B
        sb = requests.Session()
        emailB = _new_email()
        sb.post(f"{API}/auth/register", json={"name": "UserB", "email": emailB, "password": "PassB123!"})
        rb = sb.get(f"{API}/products")
        assert rb.status_code == 200
        ids = [p["product_id"] for p in rb.json()]
        assert pid not in ids

        # user B cannot access A's product
        r = sb.get(f"{API}/products/{pid}")
        assert r.status_code == 404
        r = sb.delete(f"{API}/products/{pid}")
        assert r.status_code == 404


# ---------- Demo + Dashboard ----------

class TestDemoAndDashboard:
    def test_demo_seed_and_clear(self, new_user_session):
        r = new_user_session.post(f"{API}/demo/seed")
        assert r.status_code == 200
        assert r.json()["inserted"] == 8

        r = new_user_session.get(f"{API}/products")
        products = r.json()
        assert len([p for p in products if p.get("is_demo")]) == 8

        r = new_user_session.get(f"{API}/dashboard")
        assert r.status_code == 200
        dash = r.json()
        assert dash["has_demo"] is True
        assert dash["product_count"] >= 8
        # Total Sales KPI = Σ POSTED invoices only (iter29 KPI audit). Demo products carry
        # simulated quantity_sold but no invoice records -> invoice-based total is 0.
        assert dash["total_sales"] == 0
        assert dash["sales_revenue"] == 0
        # product-level simulated stats still feed charts
        assert sum(p["revenue"] for p in dash["products"] if p.get("is_demo")) > 0
        assert len(dash["top_profitable"]) <= 5
        assert len(dash["lowest_margin"]) <= 5
        # Manual math check on first demo product (Wireless Earbuds Pro):
        # unit_cost = 18+3+5+1.5+0+1 = 28.5, price=45, qty=120 -> revenue 5400
        earbuds = next((p for p in products if p["sku"] == "DEMO-EAR-01"), None)
        assert earbuds is not None
        assert earbuds["unit_cost"] == 28.5
        assert earbuds["revenue"] == 5400.0

        # Clear
        r = new_user_session.delete(f"{API}/demo/clear")
        assert r.status_code == 200
        assert r.json()["deleted"] == 8
        r = new_user_session.get(f"{API}/products")
        assert all(not p.get("is_demo") for p in r.json())

    def test_dashboard_empty_user(self, new_user_session):
        r = new_user_session.get(f"{API}/dashboard")
        assert r.status_code == 200
        d = r.json()
        assert d["product_count"] == 0
        assert d["total_sales"] == 0
        assert d["net_profit"] == 0
        assert d["has_demo"] is False
