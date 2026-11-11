"""Iter19 — Chart of Accounts (دليل الحسابات) backend tests.

Uses disposable test tenant test.seller@profitlens.app / TestSeller123! (biz_7101d3986f3c).
Cleans up any custom accounts it creates. The 32 seeded system accounts MUST remain.
"""
import os
import uuid
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
EMAIL = "test.seller@profitlens.app"
PASSWORD = __import__("os").environ.get("LEGACY_TEST_ADMIN_PASSWORD", "local-test-only-change-me")
EXPECTED_SUBGROUPS = {
    "assets": ["cash", "bank", "accounts_receivable", "inventory", "fixed_assets", "prepaid_expenses"],
    "liabilities": ["accounts_payable", "loans", "taxes_payable", "salaries_payable"],
    "equity": ["capital", "owner_withdrawals", "retained_earnings"],
    "revenue": ["product_sales", "service_revenue", "other_revenue"],
    "cost_of_sales": ["cogs", "purchase_shipping", "direct_costs"],
    "expenses": ["rent", "salaries", "marketing", "transportation", "communications", "commissions", "bank_expenses"],
}
DEBIT_GROUPS = {"assets", "expenses", "cost_of_sales"}
GROUP_ROOT = {"assets": "1000", "liabilities": "2000", "equity": "3000",
              "revenue": "4000", "cost_of_sales": "5000", "expenses": "6000"}


@pytest.fixture(scope="module")
def sess():
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def accounts(sess):
    r = sess.get(f"{BASE}/api/accounts")
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def by_code(accounts):
    return {a["code"]: a for a in accounts}


# ---------- SEEDING ----------

class TestSeeding:
    def test_exactly_32_system_accounts(self, accounts):
        # GL integration (iter26) auto-creates per-expense-category system accounts (codes 6810+);
        # the CoA template itself still seeds exactly 32 accounts (codes < 6800).
        sys_accts = [a for a in accounts if a["is_system"] and int(a["code"]) < 6800]
        assert len(sys_accts) == 32, f"Expected 32 system accounts, got {len(sys_accts)}"

    def test_six_group_roots(self, by_code):
        for g, code in GROUP_ROOT.items():
            a = by_code.get(code)
            assert a is not None, f"Missing root {code} for {g}"
            assert a["group"] == g
            assert a["parent_id"] is None
            assert a["is_system"] is True
            assert a["subgroup"] is None

    def test_all_subgroups_present_with_correct_parent(self, accounts, by_code):
        for g, subs in EXPECTED_SUBGROUPS.items():
            root = by_code[GROUP_ROOT[g]]
            for i, sub in enumerate(subs, start=1):
                expected_code = str(int(GROUP_ROOT[g]) + i * 100)
                a = by_code.get(expected_code)
                assert a is not None, f"Missing subgroup account {expected_code} for {g}/{sub}"
                assert a["group"] == g
                assert a["subgroup"] == sub
                assert a["parent_id"] == root["account_id"]
                assert a["is_system"] is True

    def test_normal_balance_by_group(self, accounts):
        for a in accounts:
            if not a["is_system"]:
                continue
            expected = "debit" if a["group"] in DEBIT_GROUPS else "credit"
            assert a["normal_balance"] == expected, f"{a['code']} {a['group']} → {a['normal_balance']}"

    def test_idempotent(self, sess):
        r1 = sess.get(f"{BASE}/api/accounts").json()
        r2 = sess.get(f"{BASE}/api/accounts").json()
        assert len(r1) == len(r2)
        assert {a["account_id"] for a in r1} == {a["account_id"] for a in r2}


# ---------- CREATE / VALIDATION ----------

@pytest.fixture
def created_ids(sess):
    ids = []
    yield ids
    for aid in ids:
        sess.delete(f"{BASE}/api/accounts/{aid}")


class TestCreate:
    def test_create_custom_under_bank(self, sess, by_code, created_ids):
        bank = by_code["1200"]
        code = f"12{uuid.uuid4().hex[:2].upper()}"
        r = sess.post(f"{BASE}/api/accounts", json={
            "code": code,
            "name": "TEST_bank_child",
            "group": "assets",
            "parent_id": bank["account_id"],
            "subgroup": "bank",
        })
        assert r.status_code == 201, r.text
        a = r.json()
        created_ids.append(a["account_id"])
        assert a["parent_id"] == bank["account_id"]
        assert a["normal_balance"] == "debit"  # default from group
        assert a["is_system"] is False
        # verify persistence via GET list
        listed = sess.get(f"{BASE}/api/accounts").json()
        assert any(x["account_id"] == a["account_id"] for x in listed)

    def test_duplicate_code_400(self, sess, created_ids):
        r = sess.post(f"{BASE}/api/accounts", json={
            "code": "1000",  # already exists as root
            "name": "dup",
            "group": "assets",
        })
        assert r.status_code == 400
        assert "already exists" in (r.json().get("detail") or "").lower()

    def test_wrong_group_parent_400(self, sess, by_code, created_ids):
        # parent 1200 (assets/bank) but group=liabilities
        r = sess.post(f"{BASE}/api/accounts", json={
            "code": f"29{uuid.uuid4().hex[:2].upper()}",
            "name": "TEST_wrong_group",
            "group": "liabilities",
            "parent_id": by_code["1200"]["account_id"],
        })
        assert r.status_code == 400
        assert "same account group" in (r.json().get("detail") or "").lower()

    def test_depth_exceeded_400(self, sess, by_code, created_ids):
        # 1200 (depth 1) create child (depth 2), then try grandchild (depth 3) → should 400
        bank = by_code["1200"]
        code2 = f"12{uuid.uuid4().hex[:2].upper()}"
        r = sess.post(f"{BASE}/api/accounts", json={
            "code": code2, "name": "TEST_lvl2", "group": "assets",
            "parent_id": bank["account_id"],
        })
        assert r.status_code == 201, r.text
        lvl2 = r.json()
        created_ids.append(lvl2["account_id"])
        code3 = f"12{uuid.uuid4().hex[:2].upper()}"
        r2 = sess.post(f"{BASE}/api/accounts", json={
            "code": code3, "name": "TEST_lvl3", "group": "assets",
            "parent_id": lvl2["account_id"],
        })
        assert r2.status_code == 400
        assert "depth" in (r2.json().get("detail") or "").lower()

    def test_invalid_code_chars_422(self, sess):
        r = sess.post(f"{BASE}/api/accounts", json={
            "code": "12 34!", "name": "bad", "group": "assets",
        })
        assert r.status_code == 422

    def test_bad_subgroup_400(self, sess, created_ids):
        r = sess.post(f"{BASE}/api/accounts", json={
            "code": f"11{uuid.uuid4().hex[:2].upper()}",
            "name": "TEST_bad_sub",
            "group": "assets",
            "subgroup": "loans",  # loans belongs to liabilities
        })
        assert r.status_code == 400


# ---------- UPDATE / DELETE ----------

class TestUpdateDelete:
    def test_system_edit_name_400(self, sess, by_code):
        cash = by_code["1100"]
        r = sess.put(f"{BASE}/api/accounts/{cash['account_id']}", json={"name": "hacked"})
        assert r.status_code == 400

    def test_system_deactivate_reactivate_200(self, sess, by_code):
        cash = by_code["1100"]
        d = sess.put(f"{BASE}/api/accounts/{cash['account_id']}", json={"is_active": False})
        assert d.status_code == 200, d.text
        assert d.json()["is_active"] is False
        a = sess.put(f"{BASE}/api/accounts/{cash['account_id']}", json={"is_active": True})
        assert a.status_code == 200
        assert a.json()["is_active"] is True

    def test_system_delete_400(self, sess, by_code):
        r = sess.delete(f"{BASE}/api/accounts/{by_code['1100']['account_id']}")
        assert r.status_code == 400

    def test_custom_full_lifecycle(self, sess, by_code):
        code = f"13{uuid.uuid4().hex[:2].upper()}"
        r = sess.post(f"{BASE}/api/accounts", json={
            "code": code, "name": "TEST_life", "group": "assets",
        })
        assert r.status_code == 201, r.text
        a = r.json()
        # rename
        new_code = f"13{uuid.uuid4().hex[:2].upper()}"
        u = sess.put(f"{BASE}/api/accounts/{a['account_id']}", json={
            "name": "TEST_life2", "code": new_code, "normal_balance": "credit",
        })
        assert u.status_code == 200, u.text
        assert u.json()["name"] == "TEST_life2"
        assert u.json()["code"] == new_code
        assert u.json()["normal_balance"] == "credit"
        # verify persistence
        got = sess.get(f"{BASE}/api/accounts").json()
        found = next(x for x in got if x["account_id"] == a["account_id"])
        assert found["code"] == new_code
        # delete
        d = sess.delete(f"{BASE}/api/accounts/{a['account_id']}")
        assert d.status_code == 200
        after = sess.get(f"{BASE}/api/accounts").json()
        assert not any(x["account_id"] == a["account_id"] for x in after)

    def test_inactive_parent_rejects_child(self, sess, by_code):
        bank = by_code["1200"]
        # deactivate bank
        d = sess.put(f"{BASE}/api/accounts/{bank['account_id']}", json={"is_active": False})
        assert d.status_code == 200
        try:
            r = sess.post(f"{BASE}/api/accounts", json={
                "code": f"12{uuid.uuid4().hex[:2].upper()}",
                "name": "TEST_child_of_inactive", "group": "assets",
                "parent_id": bank["account_id"],
            })
            assert r.status_code == 400
            assert "inactive" in (r.json().get("detail") or "").lower()
        finally:
            sess.put(f"{BASE}/api/accounts/{bank['account_id']}", json={"is_active": True})

    def test_self_parent_and_cycle_400(self, sess):
        code = f"14{uuid.uuid4().hex[:2].upper()}"
        r = sess.post(f"{BASE}/api/accounts", json={
            "code": code, "name": "TEST_self", "group": "assets",
        })
        assert r.status_code == 201
        aid = r.json()["account_id"]
        try:
            self_r = sess.put(f"{BASE}/api/accounts/{aid}", json={"parent_id": aid})
            assert self_r.status_code == 400
        finally:
            sess.delete(f"{BASE}/api/accounts/{aid}")


# ---------- RBAC ----------

class TestRBAC:
    def test_owner_can_view_and_manage(self, sess):
        me = sess.get(f"{BASE}/api/auth/me").json()
        perms = me.get("permissions", {})
        assert perms.get("accounts.view") is True
        assert perms.get("accounts.manage") is True

    def test_no_permission_403(self, sess):
        # Create an EMPLOYEE (default: no accounts.view)
        tag = uuid.uuid4().hex[:6]
        r = sess.post(f"{BASE}/api/team", json={
            "name": f"TEST_emp_{tag}", "role": "EMPLOYEE",
            "password": "EmpPass123!",
        })
        assert r.status_code in (200, 201), r.text
        emp = r.json()
        username = emp.get("username") or emp.get("user", {}).get("username")
        emp_id = emp.get("user_id") or emp.get("id") or emp.get("user", {}).get("user_id")
        try:
            # kiosk login as employee
            emp_sess = requests.Session()
            lr = emp_sess.post(f"{BASE}/api/auth/kiosk-login", json={
                "username": username, "password": "EmpPass123!"
            })
            if lr.status_code == 403 and lr.json().get("detail") == "PASSWORD_SETUP_REQUIRED":
                ks = emp_sess.post(f"{BASE}/api/auth/kiosk-set-password", json={
                    "username": username, "password": "EmpPass123!"
                })
                assert ks.status_code == 200
                lr = emp_sess.post(f"{BASE}/api/auth/kiosk-login", json={
                    "username": username, "password": "EmpPass123!"
                })
            assert lr.status_code == 200, lr.text
            # employee: no accounts.view → 403 on list
            g = emp_sess.get(f"{BASE}/api/accounts")
            assert g.status_code == 403
            # employee: no accounts.manage → 403 on create
            c = emp_sess.post(f"{BASE}/api/accounts", json={
                "code": "9999", "name": "TEST_no_perm", "group": "assets",
            })
            assert c.status_code == 403
        finally:
            if emp_id:
                sess.delete(f"{BASE}/api/team/{emp_id}")

    def test_view_only_permission(self, sess):
        # Create an EMPLOYEE and grant accounts.view only
        tag = uuid.uuid4().hex[:6]
        r = sess.post(f"{BASE}/api/team", json={
            "name": f"TEST_view_{tag}", "role": "EMPLOYEE",
            "password": "EmpPass123!",
        })
        assert r.status_code in (200, 201), r.text
        emp = r.json()
        username = emp.get("username") or emp.get("user", {}).get("username")
        emp_id = emp.get("user_id") or emp.get("id") or emp.get("user", {}).get("user_id")
        try:
            # grant accounts.view only
            perm_r = sess.put(f"{BASE}/api/team/{emp_id}/permissions", json={
                "overrides": {"accounts.view": True}
            })
            assert perm_r.status_code == 200, perm_r.text
            emp_sess = requests.Session()
            lr = emp_sess.post(f"{BASE}/api/auth/kiosk-login", json={
                "username": username, "password": "EmpPass123!"
            })
            if lr.status_code == 403 and lr.json().get("detail") == "PASSWORD_SETUP_REQUIRED":
                emp_sess.post(f"{BASE}/api/auth/kiosk-set-password", json={
                    "username": username, "password": "EmpPass123!"
                })
                lr = emp_sess.post(f"{BASE}/api/auth/kiosk-login", json={
                    "username": username, "password": "EmpPass123!"
                })
            assert lr.status_code == 200
            g = emp_sess.get(f"{BASE}/api/accounts")
            assert g.status_code == 200
            assert len(g.json()) >= 32
            # cannot create
            c = emp_sess.post(f"{BASE}/api/accounts", json={
                "code": "9998", "name": "TEST_no_manage", "group": "assets",
            })
            assert c.status_code == 403
        finally:
            if emp_id:
                sess.delete(f"{BASE}/api/team/{emp_id}")
