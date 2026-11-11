"""Iteration 11: Owner first-launch setup + kiosk screen removal.

Runs AFTER the session-scoped conftest.py has already set the owner password.
We test the passwordless-flow endpoints by temporarily clearing the owner's
password_hash/username, exercising the endpoints, then letting conftest
teardown restore the final password-less state.
"""
import os
import time
import uuid
import asyncio
import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

pytestmark = pytest.mark.skip(
    reason="owner-setup/setup-state endpoints are hardwired to the production owner account; "
           "this one-time first-launch flow was validated in iteration 11 and must not run against the live owner"
)

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
ADMIN_EMAIL = "rabeealsofrage@gmail.com"
ADMIN_PASSWORD = __import__("os").environ.get("LEGACY_TEST_ADMIN_PASSWORD", "local-test-only-change-me")
OWNER_USERNAME = "rabee"  # set by conftest


def _db():
    return AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


async def _clear_owner_password():
    db = _db()
    await db.users.update_one(
        {"email": ADMIN_EMAIL},
        {"$unset": {"password_hash": "", "username": ""}},
    )
    await db.login_attempts.delete_many({})


async def _set_owner_hash(pw_hash: str, username: str = OWNER_USERNAME):
    db = _db()
    await db.users.update_one(
        {"email": ADMIN_EMAIL},
        {"$set": {"password_hash": pw_hash, "username": username}},
    )


class TestOwnerFirstLaunch:
    """Passwordless flow — we clear then re-run setup."""

    def test_01_setup_state_true_when_passwordless(self):
        asyncio.new_event_loop().run_until_complete(_clear_owner_password())
        r = requests.get(f"{BASE}/auth/setup-state")
        assert r.status_code == 200
        assert r.json() == {"setup_required": True}

    def test_02_owner_setup_invalid_username_422(self):
        r = requests.post(f"{BASE}/auth/owner-setup", json={"username": "ab", "password": "x" * 6})
        assert r.status_code == 422

    def test_03_owner_setup_success(self):
        s = requests.Session()
        temp_user = f"testowner{uuid.uuid4().hex[:6]}"
        r = s.post(f"{BASE}/auth/owner-setup", json={"username": temp_user, "password": ADMIN_PASSWORD})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["email"] == ADMIN_EMAIL
        assert data["role"] == "OWNER"
        assert "access_token" in s.cookies
        # Reset back to known username for downstream tests
        asyncio.new_event_loop().run_until_complete(_clear_owner_password())
        r2 = requests.post(f"{BASE}/auth/owner-setup", json={"username": OWNER_USERNAME, "password": ADMIN_PASSWORD})
        assert r2.status_code == 200

    def test_04_setup_state_now_false(self):
        r = requests.get(f"{BASE}/auth/setup-state")
        assert r.json() == {"setup_required": False}

    def test_05_owner_setup_second_call_400(self):
        r = requests.post(f"{BASE}/auth/owner-setup", json={"username": "someother", "password": "another_pw"})
        assert r.status_code == 400
        assert "already" in r.json()["detail"].lower()

    def test_06_login_by_username(self):
        s = requests.Session()
        r = s.post(f"{BASE}/auth/login", json={"email": OWNER_USERNAME, "password": ADMIN_PASSWORD})
        assert r.status_code == 200, r.text
        assert r.json()["email"] == ADMIN_EMAIL

    def test_07_login_by_email(self):
        s = requests.Session()
        r = s.post(f"{BASE}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert r.status_code == 200, r.text

    def test_08_login_wrong_password_401(self):
        r = requests.post(f"{BASE}/auth/login", json={"email": OWNER_USERNAME, "password": "WRONG_PW_XYZ_UNIQUE"})
        assert r.status_code == 401


class TestSeedSafety:
    def test_09_seed_admin_does_not_overwrite_existing(self):
        """Restart backend while owner has a password → password unchanged."""
        import subprocess
        subprocess.run(["sudo", "supervisorctl", "restart", "backend"], check=False, capture_output=True)
        for _ in range(30):
            try:
                if requests.get(f"{BASE}/auth/setup-state", timeout=2).status_code == 200:
                    break
            except Exception:
                pass
            time.sleep(1)
        r = requests.get(f"{BASE}/auth/setup-state")
        assert r.json() == {"setup_required": False}
        # Login still works with our set password
        r = requests.post(f"{BASE}/auth/login", json={"email": OWNER_USERNAME, "password": ADMIN_PASSWORD})
        assert r.status_code == 200

    def test_10_seed_admin_does_not_create_password_when_passwordless(self):
        """Restart backend while owner is password-less → seed does NOT re-apply .env password."""
        asyncio.new_event_loop().run_until_complete(_clear_owner_password())
        import subprocess
        subprocess.run(["sudo", "supervisorctl", "restart", "backend"], check=False, capture_output=True)
        for _ in range(30):
            try:
                if requests.get(f"{BASE}/auth/setup-state", timeout=2).status_code == 200:
                    break
            except Exception:
                pass
            time.sleep(1)
        r = requests.get(f"{BASE}/auth/setup-state")
        assert r.json() == {"setup_required": True}, "seed_admin must NOT re-create password on existing password-less owner"
        # Restore for subsequent tests
        r = requests.post(f"{BASE}/auth/owner-setup", json={"username": OWNER_USERNAME, "password": ADMIN_PASSWORD})
        assert r.status_code == 200


class TestEmployeeFlow:
    _employee_username = None

    def test_11_owner_creates_passwordless_employee(self):
        s = requests.Session()
        r = s.post(f"{BASE}/auth/login", json={"email": OWNER_USERNAME, "password": ADMIN_PASSWORD})
        assert r.status_code == 200
        r = s.post(f"{BASE}/team", json={"name": "Iter11 Emp", "role": "EMPLOYEE"})
        assert r.status_code in (200, 201), r.text
        emp = r.json()
        assert emp.get("username")
        TestEmployeeFlow._employee_username = emp["username"]

    def test_12_kiosk_login_passwordless_returns_403(self):
        assert TestEmployeeFlow._employee_username
        r = requests.post(f"{BASE}/auth/kiosk-login", json={"username": TestEmployeeFlow._employee_username, "password": "anything"})
        assert r.status_code == 403
        assert r.json()["detail"] == "PASSWORD_SETUP_REQUIRED"

    def test_13_kiosk_set_password_success(self):
        s = requests.Session()
        r = s.post(f"{BASE}/auth/kiosk-set-password", json={"username": TestEmployeeFlow._employee_username, "password": "EmpPass2026!"})
        assert r.status_code == 200, r.text
        assert r.json()["role"] == "EMPLOYEE"
        assert "access_token" in s.cookies

    def test_14_kiosk_set_password_second_call_400(self):
        r = requests.post(f"{BASE}/auth/kiosk-set-password", json={"username": TestEmployeeFlow._employee_username, "password": "AnotherPw!"})
        assert r.status_code == 400

    def test_15_employee_normal_kiosk_login_ok(self):
        s = requests.Session()
        r = s.post(f"{BASE}/auth/kiosk-login", json={"username": TestEmployeeFlow._employee_username, "password": "EmpPass2026!"})
        assert r.status_code == 200
        assert r.json()["role"] == "EMPLOYEE"

    def test_16_employee_cannot_create_employee(self):
        s = requests.Session()
        s.post(f"{BASE}/auth/kiosk-login", json={"username": TestEmployeeFlow._employee_username, "password": "EmpPass2026!"})
        r = s.post(f"{BASE}/team", json={"name": "X", "role": "EMPLOYEE"})
        assert r.status_code == 403
