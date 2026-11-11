"""
Backend regression for POST /api/auth/set-password (first-time password setup).

Notes:
- set-password sets the auth cookie to the TARGET user on success, so we must
  use a FRESH admin session per test (never reuse across calls) to avoid the
  admin session being silently downgraded to the employee.
"""
import os
import uuid
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://product-profit-3.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "test.seller@profitlens.app"
ADMIN_PASSWORD = __import__("os").environ.get("LEGACY_TEST_ADMIN_PASSWORD", "local-test-only-change-me")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


def admin_login():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def mongo_db():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture
def passwordless_user(mongo_db):
    """Create an employee, then strip password_hash to simulate Google OAuth user."""
    admin = admin_login()
    name = f"TEST_NoPw_{uuid.uuid4().hex[:6]}"
    r = admin.post(f"{API}/team", json={
        "name": name,
        "email": "",
        "password": "TempPass123!",
        "role": "EMPLOYEE",
    })
    assert r.status_code == 201, r.text
    uid = r.json()["user_id"]
    res = mongo_db.users.update_one({"user_id": uid}, {"$unset": {"password_hash": ""}})
    assert res.modified_count == 1
    yield uid
    # cleanup
    try:
        admin2 = admin_login()
        admin2.put(f"{API}/team/{uid}", json={"status": "inactive"})
    except Exception:
        pass


def _ensure_no_pin():
    admin = admin_login()
    admin.delete(f"{API}/auth/pin")


def _set_pin(pin="4242"):
    admin = admin_login()
    r = admin.post(f"{API}/auth/pin", json={"pin": pin})
    assert r.status_code == 200, r.text


# ---------- Scenario A: business has NO owner PIN ----------
class TestSetPasswordNoBusinessPin:
    def test_set_password_without_pin_succeeds_and_400_on_retry(self, passwordless_user):
        _ensure_no_pin()
        s = admin_login()
        r = s.post(f"{API}/auth/set-password", json={
            "user_id": passwordless_user,
            "password": "NewPass123!",
        })
        assert r.status_code == 200, r.text
        # target user is now the current session
        me = s.get(f"{API}/auth/me")
        assert me.status_code == 200
        assert me.json()["user_id"] == passwordless_user
        # second attempt as fresh admin → 400
        s2 = admin_login()
        r2 = s2.post(f"{API}/auth/set-password", json={
            "user_id": passwordless_user,
            "password": "OtherPass123!",
        })
        assert r2.status_code == 400
        assert "already" in r2.json().get("detail", "").lower()


# ---------- Scenario B: business HAS owner PIN configured ----------
# Per iteration 10 spec: PIN gate on /api/auth/set-password was intentionally
# REMOVED. The endpoint must work WITHOUT a PIN even when the business PIN is
# configured. Only pre-condition: authenticated kiosk session in same business
# and target user has no password_hash yet.
class TestSetPasswordWithBusinessPin:
    def test_no_pin_still_succeeds_when_business_pin_set(self, passwordless_user):
        _set_pin("4242")
        try:
            s = admin_login()
            r = s.post(f"{API}/auth/set-password", json={
                "user_id": passwordless_user,
                "password": "NewPass123!",
            })
            assert r.status_code == 200, r.text
            me = s.get(f"{API}/auth/me")
            assert me.status_code == 200
            assert me.json()["user_id"] == passwordless_user
            # second attempt from fresh admin → 400 already set
            s2 = admin_login()
            r2 = s2.post(f"{API}/auth/set-password", json={
                "user_id": passwordless_user,
                "password": "X" * 8,
            })
            assert r2.status_code == 400
        finally:
            _ensure_no_pin()

    def test_extra_pin_field_is_ignored(self, passwordless_user):
        """Even a wrong pin field must not block success (pin gate removed)."""
        _set_pin("4242")
        try:
            s = admin_login()
            r = s.post(f"{API}/auth/set-password", json={
                "user_id": passwordless_user,
                "password": "NewPass123!",
                "pin": "0000",
            })
            assert r.status_code == 200, r.text
        finally:
            _ensure_no_pin()


class TestSetPasswordValidation:
    def test_short_password_rejected(self, passwordless_user):
        _ensure_no_pin()
        s = admin_login()
        r = s.post(f"{API}/auth/set-password", json={
            "user_id": passwordless_user,
            "password": "abc",
        })
        assert r.status_code == 422

    def test_unknown_user_returns_404(self):
        _ensure_no_pin()
        s = admin_login()
        r = s.post(f"{API}/auth/set-password", json={
            "user_id": "user_does_not_exist_xxxx",
            "password": "NewPass123!",
        })
        assert r.status_code == 404

    def test_user_with_password_returns_400(self):
        _ensure_no_pin()
        s = admin_login()
        # create a fresh employee with a password in admin's business
        name = f"TEST_WithPw_{uuid.uuid4().hex[:6]}"
        cr = s.post(f"{API}/team", json={
            "name": name, "email": "", "password": "TempPass123!", "role": "EMPLOYEE",
        })
        assert cr.status_code == 201
        uid = cr.json()["user_id"]
        try:
            r = s.post(f"{API}/auth/set-password", json={
                "user_id": uid,
                "password": "AnotherPass!",
            })
            assert r.status_code == 400
        finally:
            admin_login().put(f"{API}/team/{uid}", json={"status": "inactive"})
