"""Phase 1 security tests: PIN, unlock, granular caps, purchase/return cancel,
sale edit, product cost change audit."""
import os
import uuid
import pytest
import requests


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://product-profit-3.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _new_email(prefix="p1"):
    return f"{prefix}.{uuid.uuid4().hex[:8]}@profitlens.app"


def _register_owner():
    s = requests.Session()
    email = _new_email("owner")
    r = s.post(f"{API}/auth/register", json={"name": "Owner", "email": email, "password": "OwnerPass123!"})
    assert r.status_code == 200, r.text
    r = s.post(f"{API}/business/setup", json={"name": f"Biz-{uuid.uuid4().hex[:4]}", "base_currency": "USD"})
    assert r.status_code == 200, r.text
    s.email = email
    s.password = "OwnerPass123!"
    return s


@pytest.fixture()
def owner():
    return _register_owner()


# ---------- Owner PIN + PIN gating ----------

class TestOwnerPin:
    def test_pin_lifecycle_and_guard(self, owner):
        # No pin -> partners returns 200 empty (no pin required)
        assert owner.get(f"{API}/partners").status_code == 200

        # Set pin
        r = owner.post(f"{API}/auth/pin", json={"pin": "2468"})
        assert r.status_code == 200
        assert r.json()["pin_enabled"] is True

        # /auth/me now shows pin_enabled
        me = owner.get(f"{API}/auth/me").json()
        assert me["business"]["pin_enabled"] is True

        # Guarded endpoints -> 403 PIN_REQUIRED
        for path in ("/partners", "/cash/summary", "/reports/profit"):
            r = owner.get(f"{API}{path}")
            assert r.status_code == 403, f"{path} status {r.status_code}"
            assert r.json().get("detail") == "PIN_REQUIRED"

        # Wrong pin -> 401
        r = owner.post(f"{API}/auth/pin/verify", json={"pin": "1111"})
        assert r.status_code == 401

        # Correct pin -> token
        r = owner.post(f"{API}/auth/pin/verify", json={"pin": "2468"})
        assert r.status_code == 200
        token = r.json()["pin_token"]
        assert token

        # With token -> 200 on all three
        headers = {"X-Pin-Token": token}
        for path in ("/partners", "/cash/summary", "/reports/profit"):
            r = owner.get(f"{API}{path}", headers=headers)
            assert r.status_code == 200, f"{path} with pin token status {r.status_code}: {r.text}"

        # Clear pin
        r = owner.delete(f"{API}/auth/pin")
        assert r.status_code == 200
        assert r.json()["pin_enabled"] is False

        # After clear, no pin token required
        assert owner.get(f"{API}/partners").status_code == 200


# ---------- Unlock ----------

class TestUnlock:
    def test_password_and_pin_unlock(self, owner):
        # Password unlock
        r = owner.post(f"{API}/auth/unlock", json={"password": owner.password})
        assert r.status_code == 200
        assert r.json()["ok"] is True

        # Wrong password
        r = owner.post(f"{API}/auth/unlock", json={"password": "wrong-xxx"})
        assert r.status_code == 401

        # Set pin then unlock via pin
        owner.post(f"{API}/auth/pin", json={"pin": "5678"})
        r = owner.post(f"{API}/auth/unlock", json={"pin": "5678"})
        assert r.status_code == 200
        r = owner.post(f"{API}/auth/unlock", json={"pin": "0000"})
        assert r.status_code == 401


# ---------- Lock timeout ----------

class TestLockTimeout:
    def test_business_lock_timeout(self, owner):
        r = owner.put(f"{API}/business", json={"lock_timeout_minutes": 5})
        assert r.status_code == 200
        assert r.json()["lock_timeout_minutes"] == 5
        me = owner.get(f"{API}/auth/me").json()
        assert me["business"]["lock_timeout_minutes"] == 5

        # Invalid values rejected (must be one of 0/5/10/15/30)
        r = owner.put(f"{API}/business", json={"lock_timeout_minutes": 7})
        # Might return 400 or 422 depending on validator
        assert r.status_code in (400, 422), f"expected reject, got {r.status_code}"


# ---------- Granular caps for employee ----------

class TestGranularCaps:
    def test_employee_granular_caps(self, owner):
        # Create employee with tightly scoped perms
        email = _new_email("sec")
        r = owner.post(f"{API}/team", json={
            "name": "SecTest", "email": email, "password": "Sec12345!", "role": "EMPLOYEE",
        })
        assert r.status_code == 201, r.text
        emp_id = r.json()["user_id"]

        # Grant only products.view, inventory.view, sales.create, returns.create
        overrides = {k: False for k in [
            "sales.view", "returns.view",
        ]}
        overrides.update({
            "products.view": True, "inventory.view": True,
            "sales.create": True, "returns.create": True,
        })
        r = owner.put(f"{API}/team/{emp_id}/permissions", json={"overrides": overrides})
        assert r.status_code == 200

        # Seed a product with stock, then a sale so returns.create has something
        pr = owner.post(f"{API}/products", json={
            "name": "TEST_SecProd", "selling_price": 20, "product_cost": 0, "quantity_sold": 0,
        }).json()
        pid = pr["product_id"]
        owner.post(f"{API}/purchases", json={
            "supplier": "S", "items": [{"product_id": pid, "quantity": 10, "unit_cost": 5}],
        })
        sale = owner.post(f"{API}/sales", json={
            "items": [{"product_id": pid, "quantity": 3, "unit_price": 20}],
            "payment_method": "cash",
        }).json()

        # Login as employee
        es = requests.Session()
        r = es.post(f"{API}/auth/login", json={"email": email, "password": "Sec12345!"})
        assert r.status_code == 200

        # Products stripped
        prods = es.get(f"{API}/products").json()
        assert len(prods) >= 1
        p0 = prods[0]
        for f in ("product_cost", "net_profit", "profit_margin", "breakdown", "unit_cost"):
            assert f not in p0, f"leaked field {f}"

        # 403 matrix
        for method, path, body in [
            ("POST", f"{API}/products", {"name": "X", "selling_price": 1, "product_cost": 1, "quantity_sold": 0}),
            ("PUT", f"{API}/products/{pid}", {"name": "X", "selling_price": 1, "product_cost": 1, "quantity_sold": 0}),
            ("DELETE", f"{API}/products/{pid}", None),
            ("POST", f"{API}/expenses", {"amount": 1, "category": "x"}),
            ("GET", f"{API}/partners", None),
            ("GET", f"{API}/cash/summary", None),
            ("GET", f"{API}/reports/profit", None),
            ("GET", f"{API}/team", None),
            ("GET", f"{API}/audit", None),
        ]:
            if method == "GET":
                r = es.get(path)
            elif method == "POST":
                r = es.post(path, json=body)
            elif method == "PUT":
                r = es.put(path, json=body)
            else:
                r = es.delete(path)
            assert r.status_code == 403, f"{method} {path} expected 403 got {r.status_code}"

        # sales.create works, response stripped of finance fields
        r = es.post(f"{API}/sales", json={
            "items": [{"product_id": pid, "quantity": 1, "unit_price": 20}],
            "payment_method": "cash",
        })
        assert r.status_code == 201
        srj = r.json()
        assert "cogs" not in srj
        assert "profit" not in srj

        # returns.create works
        r = es.post(f"{API}/returns", json={
            "sale_id": sale["sale_id"], "reason": "damaged",
            "items": [{"product_id": pid, "quantity": 1}],
            "refund_method": "cash",
        })
        assert r.status_code == 201, r.text

        # Grant products.costs -> costs visible, profit still absent
        r = owner.put(f"{API}/team/{emp_id}/permissions", json={"overrides": {
            **overrides, "products.costs": True,
        }})
        assert r.status_code == 200
        prods2 = es.get(f"{API}/products").json()
        p1 = prods2[0]
        assert "product_cost" in p1
        assert "net_profit" not in p1

        # Grant finance.profit too -> net_profit visible
        r = owner.put(f"{API}/team/{emp_id}/permissions", json={"overrides": {
            **overrides, "products.costs": True, "finance.profit": True,
        }})
        assert r.status_code == 200
        prods3 = es.get(f"{API}/products").json()
        assert "net_profit" in prods3[0]

        # Revoke -> gone immediately
        r = owner.put(f"{API}/team/{emp_id}/permissions", json={"overrides": overrides})
        assert r.status_code == 200
        prods4 = es.get(f"{API}/products").json()
        assert "product_cost" not in prods4[0]
        assert "net_profit" not in prods4[0]


# ---------- Purchase cancel ----------

class TestPurchaseCancel:
    def test_purchase_cancel_reverses_stock(self, owner):
        p = owner.post(f"{API}/products", json={
            "name": "TEST_PurCan", "selling_price": 30, "product_cost": 0, "quantity_sold": 0,
        }).json()
        pid = p["product_id"]
        r = owner.post(f"{API}/purchases", json={
            "supplier": "S", "items": [{"product_id": pid, "quantity": 20, "unit_cost": 10}],
        })
        assert r.status_code == 201
        purchase = r.json()
        pur_id = purchase["purchase_id"]
        stock_before = owner.get(f"{API}/products/{pid}").json()["stock_qty"]
        assert stock_before == 20

        # Cancel
        r = owner.post(f"{API}/purchases/{pur_id}/cancel")
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True
        stock_after = owner.get(f"{API}/products/{pid}").json()["stock_qty"]
        assert stock_after == 0

        # Audit
        logs = owner.get(f"{API}/audit").json()
        actions = {l["action"] for l in logs}
        assert "purchase.cancelled" in actions

        # Cancelling again -> 400
        r = owner.post(f"{API}/purchases/{pur_id}/cancel")
        assert r.status_code == 400

    def test_purchase_cancel_would_go_negative(self, owner):
        p = owner.post(f"{API}/products", json={
            "name": "TEST_PurNeg", "selling_price": 30, "product_cost": 0, "quantity_sold": 0,
        }).json()
        pid = p["product_id"]
        r = owner.post(f"{API}/purchases", json={
            "supplier": "S", "items": [{"product_id": pid, "quantity": 10, "unit_cost": 5}],
        })
        pur_id = r.json()["purchase_id"]
        # Sell most of them
        owner.post(f"{API}/sales", json={
            "items": [{"product_id": pid, "quantity": 8, "unit_price": 30}],
            "payment_method": "cash",
        })
        # Now stock is 2, cancelling purchase would remove 10 -> -8. Should fail.
        r = owner.post(f"{API}/purchases/{pur_id}/cancel")
        assert r.status_code == 400, f"expected 400, got {r.status_code} : {r.text}"


# ---------- Return cancel ----------

class TestReturnCancel:
    def test_return_cancel_reverses(self, owner):
        p = owner.post(f"{API}/products", json={
            "name": "TEST_RetCan", "selling_price": 40, "product_cost": 0, "quantity_sold": 0,
        }).json()
        pid = p["product_id"]
        owner.post(f"{API}/purchases", json={
            "supplier": "S", "items": [{"product_id": pid, "quantity": 10, "unit_cost": 20}],
        })
        sale = owner.post(f"{API}/sales", json={
            "items": [{"product_id": pid, "quantity": 5, "unit_price": 40}],
            "payment_method": "cash",
        }).json()
        # stock 5, qty_sold 5
        ret = owner.post(f"{API}/returns", json={
            "sale_id": sale["sale_id"], "reason": "damaged",
            "items": [{"product_id": pid, "quantity": 2}],
            "refund_method": "cash", "restock": True,
        })
        assert ret.status_code == 201, ret.text
        ret = ret.json()
        # stock 7, qty_sold 3
        after_ret = owner.get(f"{API}/products/{pid}").json()
        assert after_ret["stock_qty"] == 7
        assert after_ret["quantity_sold"] == 3

        r = owner.post(f"{API}/returns/{ret['return_id']}/cancel")
        assert r.status_code == 200, r.text
        after_cancel = owner.get(f"{API}/products/{pid}").json()
        assert after_cancel["stock_qty"] == 5
        assert after_cancel["quantity_sold"] == 5
        logs = owner.get(f"{API}/audit").json()
        assert any(l["action"] == "return.cancelled" for l in logs)


# ---------- Sale edit ----------

class TestSaleEdit:
    def test_sale_edit_metadata(self, owner):
        p = owner.post(f"{API}/products", json={
            "name": "TEST_SaleEdit", "selling_price": 15, "product_cost": 0, "quantity_sold": 0,
        }).json()
        pid = p["product_id"]
        owner.post(f"{API}/purchases", json={
            "supplier": "S", "items": [{"product_id": pid, "quantity": 5, "unit_cost": 5}],
        })
        s = owner.post(f"{API}/sales", json={
            "items": [{"product_id": pid, "quantity": 1, "unit_price": 15}],
            "payment_method": "cash",
        }).json()

        r = owner.put(f"{API}/sales/{s['sale_id']}", json={
            "customer": "TEST_Cust", "payment_method": "card",
        })
        assert r.status_code == 401, r.text  # edit gate: no PIN set -> account password required

        r = owner.put(f"{API}/sales/{s['sale_id']}", json={
            "customer": "TEST_Cust", "payment_method": "card", "pin": "OwnerPass123!",
        })
        assert r.status_code == 200, r.text
        upd = r.json()
        assert upd.get("customer") == "TEST_Cust"
        assert upd.get("payment_method") == "card"
        logs = owner.get(f"{API}/audit").json()
        assert any(l["action"] == "sale.updated" for l in logs)


# ---------- Product cost changed audit ----------

class TestProductCostAudit:
    def test_cost_change_logs(self, owner):
        p = owner.post(f"{API}/products", json={
            "name": "TEST_CostAudit", "selling_price": 20, "product_cost": 5, "quantity_sold": 0,
        }).json()
        r = owner.put(f"{API}/products/{p['product_id']}", json={
            "name": "TEST_CostAudit", "selling_price": 20, "product_cost": 8, "quantity_sold": 0,
        })
        assert r.status_code == 200
        logs = owner.get(f"{API}/audit").json()
        cost_logs = [l for l in logs if l["action"] == "product.cost_changed"]
        assert cost_logs, "product.cost_changed missing"
        assert "5" in cost_logs[0]["summary"] and "8" in cost_logs[0]["summary"]


# ---------- Audit is read-only ----------

class TestAuditReadOnly:
    def test_no_delete_or_put(self, owner):
        r = owner.delete(f"{API}/audit/anything")
        assert r.status_code in (404, 405)
        r = owner.put(f"{API}/audit/anything", json={})
        assert r.status_code in (404, 405)
