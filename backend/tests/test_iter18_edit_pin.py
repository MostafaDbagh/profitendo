"""Iter18 — PIN-gated invoice edit across Sales/Purchases/Returns.

Uses the disposable test tenant (test.seller@profitlens.app / TestSeller123!)
with owner PIN 4321 already enabled. Cleans up seeded products/invoices.
"""
import os
import uuid
import time
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
EMAIL = "test.seller@profitlens.app"
PASSWORD = __import__("os").environ.get("LEGACY_TEST_ADMIN_PASSWORD", "local-test-only-change-me")
PIN = "4321"
WRONG_PIN = "9999"


@pytest.fixture(scope="module")
def sess():
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    # ensure pin_enabled (other tests may have cleared it)
    me = s.get(f"{BASE}/api/auth/me").json()
    if not me["business"].get("pin_enabled"):
        sr = s.post(f"{BASE}/api/auth/pin", json={"pin": PIN})
        assert sr.status_code == 200, sr.text
    return s


@pytest.fixture(scope="module")
def product(sess):
    tag = uuid.uuid4().hex[:6]
    r = sess.post(f"{BASE}/api/products", json={
        "name": f"TEST_pin_{tag}",
        "selling_price": 50,
        "product_cost": 10,
    })
    assert r.status_code in (200, 201), r.text
    p = r.json()
    # Seed stock via purchase (products API forces stock_qty=0 at creation)
    sp = sess.post(f"{BASE}/api/purchases", json={
        "supplier": "TEST_seed",
        "items": [{"product_id": p["product_id"], "quantity": 50, "unit_cost": 10}],
    })
    assert sp.status_code == 201, sp.text
    yield p
    sess.delete(f"{BASE}/api/products/{p['product_id']}")


def _create_sale(sess, pid, qty=2):
    r = sess.post(f"{BASE}/api/sales", json={
        "customer": "TEST_customer",
        "payment_method": "cash",
        "items": [{"product_id": pid, "quantity": qty, "unit_price": 50}],
    })
    assert r.status_code == 201, r.text
    return r.json()


# ---------- SALE ----------

class TestSaleEditPin:
    def test_no_pin_returns_401(self, sess, product):
        sale = _create_sale(sess, product["product_id"], 2)
        pr_before = sess.get(f"{BASE}/api/products/{product['product_id']}").json()
        r = sess.put(f"{BASE}/api/sales/{sale['sale_id']}", json={"customer": "X"})
        assert r.status_code == 401
        assert r.json().get("detail") == "INVALID_PIN"
        # stock unchanged from failed PIN attempt
        pr = sess.get(f"{BASE}/api/products/{product['product_id']}").json()
        assert pr["stock_qty"] == pr_before["stock_qty"]

    def test_wrong_pin_returns_401(self, sess, product):
        sale = _create_sale(sess, product["product_id"], 2)
        r = sess.put(f"{BASE}/api/sales/{sale['sale_id']}", json={"customer": "X", "pin": WRONG_PIN})
        assert r.status_code == 401
        assert r.json().get("detail") == "INVALID_PIN"

    def test_correct_pin_edit_items_recalcs(self, sess, product):
        pid = product["product_id"]
        pr_before = sess.get(f"{BASE}/api/products/{pid}").json()
        stock0 = pr_before["stock_qty"]
        sale = _create_sale(sess, pid, 2)  # stock -= 2
        # edit 2 -> 5 → stock decreases by 3 more
        r = sess.put(f"{BASE}/api/sales/{sale['sale_id']}", json={
            "pin": PIN,
            "items": [{"product_id": pid, "quantity": 5, "unit_price": 50}],
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["total"] == 250.0
        assert body["cogs"] == 50.0
        assert body["profit"] == 200.0
        assert body["items"][0]["quantity"] == 5
        pr_after = sess.get(f"{BASE}/api/products/{pid}").json()
        assert pr_after["stock_qty"] == stock0 - 5
        assert pr_after["quantity_sold"] >= 5

    def test_overstock_edit_returns_400(self, sess, product):
        pid = product["product_id"]
        sale = _create_sale(sess, pid, 1)
        pr = sess.get(f"{BASE}/api/products/{pid}").json()
        crazy_qty = pr["stock_qty"] + 1 + 999
        r = sess.put(f"{BASE}/api/sales/{sale['sale_id']}", json={
            "pin": PIN,
            "items": [{"product_id": pid, "quantity": crazy_qty, "unit_price": 50}],
        })
        assert r.status_code == 400
        # stock unchanged for this failed edit (still equal to after original sale)
        pr2 = sess.get(f"{BASE}/api/products/{pid}").json()
        assert pr2["stock_qty"] == pr["stock_qty"]

    def test_header_only_edit(self, sess, product):
        pid = product["product_id"]
        sale = _create_sale(sess, pid, 1)
        pr_before = sess.get(f"{BASE}/api/products/{pid}").json()
        r = sess.put(f"{BASE}/api/sales/{sale['sale_id']}", json={
            "pin": PIN, "customer": "TEST_updated_only",
        })
        assert r.status_code == 200
        assert r.json()["customer"] == "TEST_updated_only"
        pr_after = sess.get(f"{BASE}/api/products/{pid}").json()
        assert pr_after["stock_qty"] == pr_before["stock_qty"]

    def test_cancelled_sale_cannot_be_edited(self, sess, product):
        pid = product["product_id"]
        sale = _create_sale(sess, pid, 1)
        c = sess.post(f"{BASE}/api/sales/{sale['sale_id']}/cancel")
        assert c.status_code == 200
        r = sess.put(f"{BASE}/api/sales/{sale['sale_id']}", json={"pin": PIN, "customer": "Z"})
        assert r.status_code == 400


# ---------- PURCHASE ----------

class TestPurchaseEditPin:
    def test_no_pin_returns_401(self, sess, product):
        pid = product["product_id"]
        r = sess.post(f"{BASE}/api/purchases", json={
            "supplier": "TEST_sup",
            "items": [{"product_id": pid, "quantity": 3, "unit_cost": 10}],
        })
        assert r.status_code == 201
        purch = r.json()
        r2 = sess.put(f"{BASE}/api/purchases/{purch['purchase_id']}", json={"supplier": "X"})
        assert r2.status_code == 401
        assert r2.json().get("detail") == "INVALID_PIN"

    def test_wac_recompute_and_negative_guard(self, sess):
        # isolated product for WAC math
        tag = uuid.uuid4().hex[:6]
        p = sess.post(f"{BASE}/api/products", json={
            "name": f"TEST_wac_{tag}", "selling_price": 30, "product_cost": 0,
        }).json()
        pid = p["product_id"]
        try:
            # purchase 10 @ 10 → stock 10, cost 10
            pr = sess.post(f"{BASE}/api/purchases", json={
                "supplier": "TEST_sup",
                "items": [{"product_id": pid, "quantity": 10, "unit_cost": 10}],
            }).json()
            got = sess.get(f"{BASE}/api/products/{pid}").json()
            assert got["stock_qty"] == 10
            assert got["product_cost"] == 10
            # edit to 10 @ 20 with correct PIN → cost 20
            r = sess.put(f"{BASE}/api/purchases/{pr['purchase_id']}", json={
                "pin": PIN,
                "items": [{"product_id": pid, "quantity": 10, "unit_cost": 20}],
            })
            assert r.status_code == 200, r.text
            got = sess.get(f"{BASE}/api/products/{pid}").json()
            assert got["stock_qty"] == 10
            assert got["product_cost"] == 20
            # Consume 9 from stock so pre_qty=0, then edit to qty=1 (stock would go negative if we edit down to something ≥ current stock consumed)
            sess.post(f"{BASE}/api/sales", json={
                "customer": "TEST", "payment_method": "cash",
                "items": [{"product_id": pid, "quantity": 9, "unit_price": 30}],
            })
            # stock now = 1; if we edit purchase to qty=0 (min ge=1) — try qty=1 with 9 more sold means edit reducing purchase to 1
            # actually edit purchase 10 -> 1 with only 1 in stock => final = 1 - 10 + 1 = -8 → 400
            r = sess.put(f"{BASE}/api/purchases/{pr['purchase_id']}", json={
                "pin": PIN,
                "items": [{"product_id": pid, "quantity": 1, "unit_cost": 20}],
            })
            assert r.status_code == 400
        finally:
            sess.delete(f"{BASE}/api/products/{pid}")


# ---------- RETURN ----------

class TestReturnEditPin:
    def test_return_pin_and_qty_guard(self, sess, product):
        pid = product["product_id"]
        # Sale of qty 5
        sale = _create_sale(sess, pid, 5)
        # Return qty 2 restock=true
        r = sess.post(f"{BASE}/api/returns", json={
            "sale_id": sale["sale_id"],
            "reason": "damaged",
            "notes": "TEST",
            "restock": True,
            "refund_method": "cash",
            "items": [{"product_id": pid, "quantity": 2, "unit_price": 50}],
        })
        assert r.status_code == 201, r.text
        ret = r.json()
        # no pin
        no = sess.put(f"{BASE}/api/returns/{ret['return_id']}", json={"notes": "x"})
        assert no.status_code == 401
        # wrong pin
        wp = sess.put(f"{BASE}/api/returns/{ret['return_id']}", json={"notes": "x", "pin": WRONG_PIN})
        assert wp.status_code == 401
        # qty > original sale line (sold 5) → 400
        over = sess.put(f"{BASE}/api/returns/{ret['return_id']}", json={
            "pin": PIN,
            "items": [{"product_id": pid, "quantity": 6, "unit_price": 50}],
        })
        assert over.status_code == 400
        # correct pin, edit qty 2 → 3, refund recomputed
        pr_before = sess.get(f"{BASE}/api/products/{pid}").json()
        ok = sess.put(f"{BASE}/api/returns/{ret['return_id']}", json={
            "pin": PIN,
            "items": [{"product_id": pid, "quantity": 3, "unit_price": 50}],
        })
        assert ok.status_code == 200, ok.text
        body = ok.json()
        assert body["refund_total"] == 150.0
        pr_after = sess.get(f"{BASE}/api/products/{pid}").json()
        # stock: restock changed 2→3, +1
        assert pr_after["stock_qty"] == pr_before["stock_qty"] + 1


# ---------- Direct URL protection is a frontend concern; covered in Playwright ----------
