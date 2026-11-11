"""Iteration 10 regressions:
- OWNER-only employee creation (POST /api/team returns 403 for non-owners)
- Password/email optional on employee create; username auto-generated
- Placeholder email (@noemail.profitlens.local) on empty email
- Owner PIN still gates partners/finance/profit endpoints
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL", "https://product-profit-3.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"

OWNER = {"email": "test.seller@profitlens.app", "password": "TestSeller123!"}


def owner_login():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=OWNER)
    assert r.status_code == 200, r.text
    return s


def _deactivate(uid: str):
    try:
        admin = owner_login()
        admin.put(f"{API}/team/{uid}", json={"status": "inactive"})
    except Exception:
        pass


class TestEmployeeCreationOptionalFields:
    def test_create_without_email_and_password(self):
        admin = owner_login()
        name = f"TEST_NoEmailPw_{uuid.uuid4().hex[:6]}"
        r = admin.post(f"{API}/team", json={"name": name, "role": "EMPLOYEE"})
        assert r.status_code == 201, r.text
        body = r.json()
        uid = body["user_id"]
        try:
            assert body["name"] == name
            assert body.get("username"), "auto-generated username missing"
            # email should be placeholder
            assert body["email"].endswith("@noemail.profitlens.local")
            # user appears in kiosk with has_password False
            kiosk = admin.get(f"{API}/auth/kiosk/users").json()
            entry = next((u for u in kiosk if u["user_id"] == uid), None)
            assert entry, "employee not in kiosk list"
            assert entry.get("has_password") is False
        finally:
            _deactivate(uid)

    def test_create_with_only_name_generates_unique_username(self):
        admin = owner_login()
        base = f"TESTUniq{uuid.uuid4().hex[:4]}"
        r1 = admin.post(f"{API}/team", json={"name": base, "role": "EMPLOYEE"})
        r2 = admin.post(f"{API}/team", json={"name": base, "role": "EMPLOYEE"})
        assert r1.status_code == 201 and r2.status_code == 201
        u1, u2 = r1.json(), r2.json()
        try:
            assert u1["username"] != u2["username"], "usernames must be unique"
        finally:
            _deactivate(u1["user_id"])
            _deactivate(u2["user_id"])

    def test_short_password_rejected(self):
        admin = owner_login()
        r = admin.post(f"{API}/team", json={
            "name": f"TEST_ShortPw_{uuid.uuid4().hex[:4]}",
            "role": "EMPLOYEE", "password": "abc",
        })
        # min_length=6 → pydantic 422
        assert r.status_code in (400, 422)


class TestOwnerOnlyEmployeeCreation:
    def test_non_owner_cannot_create_employee(self):
        # Create a MANAGER, promote users.manage override, login as that manager,
        # try to POST /api/team → expect 403.
        admin = owner_login()
        mgr_name = f"TEST_Mgr_{uuid.uuid4().hex[:6]}"
        mgr_email = f"test_mgr_{uuid.uuid4().hex[:8]}@example.com"
        mgr_pwd = "MgrPass123!"
        r = admin.post(f"{API}/team", json={
            "name": mgr_name, "role": "MANAGER", "password": mgr_pwd, "email": mgr_email,
        })
        assert r.status_code == 201, r.text
        mgr = r.json()
        try:
            # Grant users.manage override (bypasses role default; still not OWNER)
            overrides = dict(mgr.get("permission_overrides") or {})
            overrides["users.manage"] = True
            pr = admin.put(f"{API}/team/{mgr['user_id']}/permissions", json={"overrides": overrides})
            assert pr.status_code == 200, pr.text
            # Login as the manager
            s = requests.Session()
            lr = s.post(f"{API}/auth/login", json={"email": mgr_email, "password": mgr_pwd})
            assert lr.status_code == 200, lr.text
            # Attempt to create an employee
            r2 = s.post(f"{API}/team", json={
                "name": f"TEST_ShouldFail_{uuid.uuid4().hex[:4]}", "role": "EMPLOYEE",
            })
            assert r2.status_code == 403, r2.text
            assert "owner" in r2.json().get("detail", "").lower()
        finally:
            _deactivate(mgr["user_id"])


class TestOwnerPinStillGatesFinance:
    def test_pin_required_for_profit_report(self):
        admin = owner_login()
        # set pin
        r = admin.post(f"{API}/auth/pin", json={"pin": "1234"})
        assert r.status_code == 200, r.text
        try:
            # profit report without pin_token should 403 PIN_REQUIRED
            fresh = owner_login()  # fresh session (no pin_token)
            resp = fresh.get(f"{API}/reports/profit")
            assert resp.status_code == 403, resp.text
            assert "PIN" in resp.json().get("detail", "").upper()
        finally:
            admin2 = owner_login()
            admin2.delete(f"{API}/auth/pin")
