"""SaaS multi-user tests: business, roles, permissions, purchases/sales/returns/expenses/cash/partners/reports/audit.

Uses ephemeral owner sessions so admin data stays untouched. Uses the seeded
employee1@profitlens.app account for permission field-stripping tests.
"""
import os
import uuid
import pytest
import requests


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

ADMIN_EMAIL = "test.seller@profitlens.app"
ADMIN_PASSWORD = __import__("os").environ.get("LEGACY_TEST_ADMIN_PASSWORD", "local-test-only-change-me")
EMP_EMAIL = "employee1@profitlens.app"
EMP_PASSWORD = __import__("os").environ.get("LEGACY_TEST_EMPLOYEE_PASSWORD", "local-test-only-change-me")
def _new_email(prefix="owner"):
    return f"{prefix}.{uuid.uuid4().hex[:8]}@profitlens.app"


def _register_owner(name="Owner", currency="USD"):
    """Register a fresh owner and return an authenticated session."""
    s = requests.Session()
    email = _new_email()
    r = s.post(f"{API}/auth/register", json={"name": name, "email": email, "password": "OwnerPass123!"})
    assert r.status_code == 200, r.text
    # setup business
    r = s.post(f"{API}/business/setup", json={"name": f"Biz-{uuid.uuid4().hex[:4]}", "base_currency": currency})
    assert r.status_code == 200, r.text
    s.email = email
    return s


@pytest.fixture()
def owner_session():
    return _register_owner()


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def employee_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": EMP_EMAIL, "password": EMP_PASSWORD})
    if r.status_code != 200:
        pytest.skip(f"Employee account not available: {r.text}")
    return s


def _create_product(session, name="TEST_WAC", price=25, cost=0, stock=0, min_stock=0):
    r = session.post(f"{API}/products", json={
        "name": name, "selling_price": price, "product_cost": cost,
        "quantity_sold": 0, "stock_qty": stock, "minimum_stock_level": min_stock,
    })
    assert r.status_code == 201, r.text
    return r.json()


# ---------- Business setup ----------

class TestBusinessSetup:
    def test_new_user_has_business_and_owner_role(self):
        s = requests.Session()
        email = _new_email()
        r = s.post(f"{API}/auth/register", json={"name": "Fresh", "email": email, "password": "OwnerPass123!"})
        assert r.status_code == 200
        me = s.get(f"{API}/auth/me").json()
        assert me["role"] == "OWNER"
        assert me["business_id"]
        assert me["business"]["setup_completed"] is False
        assert me["permissions"]["settings.business"] is True

    def test_setup_and_currency(self, owner_session):
        # setup happened in fixture with USD
        me = owner_session.get(f"{API}/auth/me").json()
        assert me["business"]["base_currency"] == "USD"
        assert me["business"]["setup_completed"] is True
        # change currency
        r = owner_session.put(f"{API}/business", json={"base_currency": "SAR"})
        assert r.status_code == 200
        assert r.json()["base_currency"] == "SAR"

    def test_invalid_currency_rejected(self, owner_session):
        r = owner_session.put(f"{API}/business", json={"base_currency": "XYZ"})
        assert r.status_code == 400


# ---------- Owner full cycle: WAC + sale + return + cancel + expense + cash ----------

class TestOwnerFullCycle:
    def test_wac_and_sale_and_return_and_cancel(self, owner_session):
        # 1. Product w/ zero stock
        p = _create_product(owner_session, name="TEST_WAC_Widget", price=25)
        pid = p["product_id"]

        # 2. Purchase 10 @ $12
        r = owner_session.post(f"{API}/purchases", json={
            "supplier": "Sup1", "items": [{"product_id": pid, "quantity": 10, "unit_cost": 12}],
        })
        assert r.status_code == 201, r.text
        # 3. Purchase 20 @ $15 -> weighted avg = (10*12 + 20*15) / 30 = $14
        r = owner_session.post(f"{API}/purchases", json={
            "supplier": "Sup2", "items": [{"product_id": pid, "quantity": 20, "unit_cost": 15}],
        })
        assert r.status_code == 201
        p2 = owner_session.get(f"{API}/products/{pid}").json()
        assert p2["product_cost"] == 14, f"WAC should be $14, got {p2['product_cost']}"
        assert p2["stock_qty"] == 30

        # 4. Sale 5 @ $25 -> total 125, COGS 70, profit 55
        r = owner_session.post(f"{API}/sales", json={
            "items": [{"product_id": pid, "quantity": 5, "unit_price": 25}],
            "payment_method": "cash",
        })
        assert r.status_code == 201, r.text
        sale = r.json()
        sid = sale["sale_id"]
        assert sale["total"] == 125.0
        assert sale["cogs"] == 70.0
        assert sale["profit"] == 55.0
        p3 = owner_session.get(f"{API}/products/{pid}").json()
        assert p3["stock_qty"] == 25
        assert p3["quantity_sold"] == 5

        # 5. Return 1 -> refund $25, cogs_reversed $14, stock +1, quantity_sold -1
        r = owner_session.post(f"{API}/returns", json={
            "sale_id": sid, "reason": "damaged",
            "items": [{"product_id": pid, "quantity": 1}],
            "refund_method": "cash",
        })
        assert r.status_code == 201, r.text
        ret = r.json()
        assert ret["refund_total"] == 25.0
        assert ret["cogs_reversed"] == 14.0
        p4 = owner_session.get(f"{API}/products/{pid}").json()
        assert p4["stock_qty"] == 26
        assert p4["quantity_sold"] == 4

        # 6. Cancel a new sale reverses stock + qty_sold
        r = owner_session.post(f"{API}/sales", json={
            "items": [{"product_id": pid, "quantity": 2, "unit_price": 25}],
            "payment_method": "cash",
        })
        s2 = r.json()
        p5 = owner_session.get(f"{API}/products/{pid}").json()
        assert p5["stock_qty"] == 24
        assert p5["quantity_sold"] == 6

        r = owner_session.post(f"{API}/sales/{s2['sale_id']}/cancel")
        assert r.status_code == 200
        p6 = owner_session.get(f"{API}/products/{pid}").json()
        assert p6["stock_qty"] == 26, "stock restored on cancel"
        assert p6["quantity_sold"] == 4, "quantity_sold reduced on cancel"

    def test_expense_crud_and_cash_and_withdrawal(self, owner_session):
        # Seed a cash sale first so balance stays >= 0 for closing
        p = _create_product(owner_session, name="TEST_CashProd", price=50, stock=10)
        owner_session.post(f"{API}/purchases", json={
            "supplier": "S", "items": [{"product_id": p["product_id"], "quantity": 10, "unit_cost": 5}],
        })
        owner_session.post(f"{API}/sales", json={
            "items": [{"product_id": p["product_id"], "quantity": 5, "unit_price": 50}],
            "payment_method": "cash",
        })
        # create expense
        r = owner_session.post(f"{API}/expenses", json={
            "amount": 100, "category": "rent", "payment_method": "cash", "description": "TEST_RENT",
        })
        assert r.status_code == 201, r.text
        eid = r.json()["expense_id"]
        # update
        r = owner_session.put(f"{API}/expenses/{eid}", json={
            "amount": 120, "category": "rent", "payment_method": "cash", "description": "TEST_RENT2",
        })
        assert r.status_code == 200
        assert r.json()["amount"] == 120
        # cash summary reflects expense
        r = owner_session.get(f"{API}/cash/summary")
        assert r.status_code == 200
        summary = r.json()
        assert summary["cash_expenses"] >= 120

        # cash closing (expected balance == summary balance)
        expected = summary["balance"]
        r = owner_session.post(f"{API}/cash/closing", json={"actual_cash": expected + 5, "notes": "TEST"})
        assert r.status_code == 201, r.text
        closing = r.json()
        assert closing["expected"] == expected
        assert closing["difference"] == round((expected + 5) - expected, 2) == 5.0

        # withdrawal
        r = owner_session.post(f"{API}/withdrawals", json={
            "person": "Owner", "amount": 50, "source": "cash", "reason": "TEST",
        })
        assert r.status_code == 201, r.text

        # delete expense
        r = owner_session.delete(f"{API}/expenses/{eid}")
        assert r.status_code == 200

    def test_partner_and_transaction(self, owner_session):
        r = owner_session.post(f"{API}/partners", json={
            "name": "TEST_Partner", "ownership_percentage": 30,
        })
        assert r.status_code == 201, r.text
        prt = r.json()
        pid = prt["partner_id"]

        r = owner_session.post(f"{API}/partners/{pid}/transactions", json={
            "type": "allocation", "amount": 500,
        })
        assert r.status_code == 201

        r = owner_session.post(f"{API}/partners/{pid}/transactions", json={
            "type": "withdrawal", "amount": 100,
        })
        assert r.status_code == 201

        r = owner_session.get(f"{API}/partners/{pid}")
        assert r.status_code == 200
        d = r.json()
        assert d["balance"] == 400  # 500 - 100
        assert len(d["transactions"]) == 2

    def test_reports_and_audit(self, owner_session):
        # seed a sale+expense so reports have data
        p = _create_product(owner_session, name="TEST_RepProd", price=50, cost=0, stock=0)
        owner_session.post(f"{API}/purchases", json={
            "supplier": "S", "items": [{"product_id": p["product_id"], "quantity": 5, "unit_cost": 20}],
        })
        owner_session.post(f"{API}/sales", json={
            "items": [{"product_id": p["product_id"], "quantity": 2, "unit_price": 50}],
        })
        owner_session.post(f"{API}/expenses", json={"amount": 30, "category": "utilities"})

        # sales report
        r = owner_session.get(f"{API}/reports/sales")
        assert r.status_code == 200
        d = r.json()
        assert d["count"] >= 1
        assert "revenue" in d and "profit" in d  # owner has finance

        # profit report
        r = owner_session.get(f"{API}/reports/profit")
        assert r.status_code == 200
        p_rep = r.json()
        assert "net_profit" in p_rep
        assert "gross_profit" in p_rep

        # inventory report
        r = owner_session.get(f"{API}/reports/inventory")
        assert r.status_code == 200
        assert "inventory_value" in r.json()

        # audit log includes multiple actions
        r = owner_session.get(f"{API}/audit")
        assert r.status_code == 200
        logs = r.json()
        actions = {l["action"] for l in logs}
        assert "product.created" in actions
        assert "purchase.created" in actions
        assert "sale.created" in actions
        assert "expense.created" in actions


# ---------- Negative stock enforcement ----------

class TestNegativeStock:
    def test_sale_blocked_then_allowed(self, owner_session):
        p = _create_product(owner_session, name="TEST_NEG", price=10, stock=2)
        pid = p["product_id"]
        # sale qty > stock -> 400
        r = owner_session.post(f"{API}/sales", json={
            "items": [{"product_id": pid, "quantity": 5}],
        })
        assert r.status_code == 400
        # enable allow_negative_stock
        r = owner_session.put(f"{API}/business", json={"allow_negative_stock": True})
        assert r.status_code == 200
        assert r.json()["allow_negative_stock"] is True
        # retry sale -> succeeds
        r = owner_session.post(f"{API}/sales", json={
            "items": [{"product_id": pid, "quantity": 5}],
        })
        assert r.status_code == 201, r.text


# ---------- Cross-tenant isolation ----------

class TestTenantIsolation:
    def test_owner_a_cannot_see_owner_b(self):
        sa = _register_owner()
        pa = _create_product(sa, name="TEST_A_only", price=10, stock=5)
        sb = _register_owner()
        # B lists products -> A's product not visible
        r = sb.get(f"{API}/products")
        ids = [p["product_id"] for p in r.json()]
        assert pa["product_id"] not in ids
        # B cannot GET A's product
        r = sb.get(f"{API}/products/{pa['product_id']}")
        assert r.status_code == 404


# ---------- Team management + roles ----------

class TestTeamAndPermissions:
    def test_create_manager_defaults_and_grant_finance(self, owner_session):
        me = owner_session.get(f"{API}/auth/me").json()
        # create manager
        mgr_email = _new_email("mgr")
        r = owner_session.post(f"{API}/team", json={
            "name": "Manager1", "email": mgr_email, "password": "Mgr12345!", "role": "MANAGER",
        })
        assert r.status_code == 201, r.text
        mgr = r.json()
        mgr_id = mgr["user_id"]
        # MANAGER new granular defaults
        assert mgr["permissions"]["products.create"] is True
        assert mgr["permissions"]["products.edit"] is True
        assert mgr["permissions"]["products.delete"] is True
        assert mgr["permissions"]["cash.close"] is True
        assert mgr["permissions"]["products.costs"] is False
        assert mgr["permissions"]["finance.profit"] is False
        assert mgr["permissions"]["expenses.create"] is False
        assert mgr["permissions"]["audit.view"] is False

        # login as mgr -> stripped products (no product_cost/net_profit)
        ms = requests.Session()
        ms.post(f"{API}/auth/login", json={"email": mgr_email, "password": "Mgr12345!"})
        _create_product(owner_session, name="TEST_MgrView", price=10, cost=5, stock=3)
        prods = ms.get(f"{API}/products").json()
        assert len(prods) >= 1
        sample = prods[0]
        assert "product_cost" not in sample
        assert "net_profit" not in sample
        assert "profit_margin" not in sample
        assert "breakdown" not in sample
        assert "stock_qty" in sample

        # 403 on expenses/partners/audit
        assert ms.post(f"{API}/expenses", json={"amount": 5, "category": "rent"}).status_code == 403
        assert ms.get(f"{API}/audit").status_code == 403
        assert ms.get(f"{API}/partners").status_code == 403

        # Owner grants products.costs + finance.profit + finance.margin (equivalent to old finance.view)
        r = owner_session.put(f"{API}/team/{mgr_id}/permissions", json={"overrides": {
            "products.costs": True, "finance.profit": True, "finance.margin": True,
        }})
        assert r.status_code == 200
        assert r.json()["permissions"]["products.costs"] is True
        assert r.json()["permissions"]["finance.profit"] is True

        # Manager immediately sees costs
        prods2 = ms.get(f"{API}/products").json()
        sample2 = prods2[0]
        assert "product_cost" in sample2
        assert "net_profit" in sample2

    def test_accountant_defaults(self, owner_session):
        acc_email = _new_email("acc")
        r = owner_session.post(f"{API}/team", json={
            "name": "Acc1", "email": acc_email, "password": "Acc12345!", "role": "ACCOUNTANT",
        })
        assert r.status_code == 201
        perms = r.json()["permissions"]
        # ACCOUNTANT new granular defaults
        assert perms["products.costs"] is True
        assert perms["finance.profit"] is True
        assert perms["finance.reports"] is True
        assert perms["expenses.create"] is True
        assert perms["expenses.delete"] is True
        assert perms["products.create"] is False
        assert perms["settings.business"] is False

        # login as accountant -> 403 on POST products and PUT business
        ax = requests.Session()
        ax.post(f"{API}/auth/login", json={"email": acc_email, "password": "Acc12345!"})
        r = ax.post(f"{API}/products", json={"name": "X", "selling_price": 10, "product_cost": 1, "quantity_sold": 0})
        assert r.status_code == 403
        r = ax.put(f"{API}/business", json={"name": "NewName"})
        assert r.status_code == 403


# ---------- Employee permission matrix (uses seeded employee1) ----------

class TestEmployeePermissions:
    def test_employee_products_stripped(self, employee_session):
        r = employee_session.get(f"{API}/products")
        assert r.status_code == 200
        prods = r.json()
        if prods:
            p = prods[0]
            for f in ("product_cost", "net_profit", "profit_margin", "breakdown", "unit_cost", "unit_profit"):
                assert f not in p, f"Employee saw sensitive field {f}"
            assert "stock_qty" in p

    def test_employee_403_matrix(self, employee_session):
        expect_403 = [
            ("POST", f"{API}/products", {"name": "X", "selling_price": 10, "product_cost": 1, "quantity_sold": 0}),
            ("POST", f"{API}/expenses", {"amount": 5, "category": "rent"}),
            ("POST", f"{API}/partners", {"name": "X", "ownership_percentage": 10}),
            ("POST", f"{API}/withdrawals", {"person": "X", "amount": 5}),
            ("GET",  f"{API}/audit", None),
            ("GET",  f"{API}/team", None),
            ("GET",  f"{API}/reports/profit", None),
        ]
        for method, url, body in expect_403:
            if method == "POST":
                r = employee_session.post(url, json=body)
            else:
                r = employee_session.get(url)
            assert r.status_code == 403, f"{method} {url} expected 403 got {r.status_code}"

    def test_employee_can_view_sales_stripped(self, employee_session):
        r = employee_session.get(f"{API}/sales")
        assert r.status_code == 200
        for s in r.json():
            assert "cogs" not in s
            assert "profit" not in s

    def test_employee_inventory_no_costs(self, employee_session):
        r = employee_session.get(f"{API}/inventory")
        assert r.status_code == 200
        for row in r.json():
            assert "unit_cost" not in row
            assert "stock_value" not in row

    def test_employee_dashboard_no_finance(self, employee_session):
        r = employee_session.get(f"{API}/dashboard")
        assert r.status_code == 200
        d = r.json()
        # finance flag off + no net_profit
        assert d.get("finance") is False, f"expected finance=false, got {d.get('finance')}"
        assert "net_profit" not in d or d.get("net_profit") in (None, 0)
