"""
Tests for iteration 5 auth changes:
- /api/auth/me works with access_token cookie, session_token cookie, Bearer JWT, Bearer session_token
- Invalid/expired session_token -> 401
- Bogus google session_id -> 401
- Logout deletes session doc and clears cookies
"""
import os
import time
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://product-profit-3.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

ADMIN_EMAIL = "test.seller@profitlens.app"
ADMIN_PASSWORD = __import__("os").environ.get("LEGACY_TEST_ADMIN_PASSWORD", "local-test-only-change-me")
@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(scope="module")
def admin_login():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    jwt_cookie = s.cookies.get("access_token")
    assert jwt_cookie
    user = r.json()
    return {"session": s, "jwt": jwt_cookie, "user": user}


@pytest.fixture(scope="module")
def admin_user_id(admin_login):
    return admin_login["user"]["user_id"]


def test_me_with_access_token_cookie(admin_login):
    r = requests.get(f"{API}/auth/me", cookies={"access_token": admin_login["jwt"]})
    assert r.status_code == 200
    assert r.json()["email"] == ADMIN_EMAIL


def test_me_with_bearer_jwt(admin_login):
    r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {admin_login['jwt']}"})
    assert r.status_code == 200
    assert r.json()["email"] == ADMIN_EMAIL


def test_me_with_session_token_cookie(mongo, admin_user_id):
    token = f"test_stoken_cookie_{uuid.uuid4().hex}"
    mongo.user_sessions.insert_one({
        "user_id": admin_user_id,
        "session_token": token,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
        "created_at": datetime.now(timezone.utc),
    })
    try:
        r = requests.get(f"{API}/auth/me", cookies={"session_token": token})
        assert r.status_code == 200, r.text
        assert r.json()["email"] == ADMIN_EMAIL
    finally:
        mongo.user_sessions.delete_one({"session_token": token})


def test_me_with_bearer_session_token(mongo, admin_user_id):
    token = f"test_stoken_bearer_{uuid.uuid4().hex}"
    mongo.user_sessions.insert_one({
        "user_id": admin_user_id,
        "session_token": token,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
        "created_at": datetime.now(timezone.utc),
    })
    try:
        r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN_EMAIL
    finally:
        mongo.user_sessions.delete_one({"session_token": token})


def test_expired_session_token_rejected(mongo, admin_user_id):
    token = f"test_stoken_expired_{uuid.uuid4().hex}"
    mongo.user_sessions.insert_one({
        "user_id": admin_user_id,
        "session_token": token,
        "expires_at": datetime.now(timezone.utc) - timedelta(days=1),
        "created_at": datetime.now(timezone.utc) - timedelta(days=8),
    })
    try:
        r = requests.get(f"{API}/auth/me", cookies={"session_token": token})
        assert r.status_code == 401
    finally:
        mongo.user_sessions.delete_one({"session_token": token})


def test_invalid_session_token_rejected():
    r = requests.get(f"{API}/auth/me", cookies={"session_token": "nonexistent_token_xxx"})
    assert r.status_code == 401
    r = requests.get(f"{API}/auth/me", headers={"Authorization": "Bearer nonexistent_token_xxx"})
    assert r.status_code == 401


def test_no_auth_returns_401():
    r = requests.get(f"{API}/auth/me")
    assert r.status_code == 401


def test_google_session_bogus_id_returns_401():
    r = requests.post(f"{API}/auth/google/session", headers={"X-Session-ID": f"bogus_{uuid.uuid4().hex}"})
    assert r.status_code == 401


def test_google_session_missing_id_returns_400():
    r = requests.post(f"{API}/auth/google/session")
    assert r.status_code == 400


def test_logout_deletes_session_and_clears_cookies(mongo, admin_user_id):
    token = f"test_stoken_logout_{uuid.uuid4().hex}"
    mongo.user_sessions.insert_one({
        "user_id": admin_user_id,
        "session_token": token,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
        "created_at": datetime.now(timezone.utc),
    })

    # login to get a real JWT cookie in session
    s = requests.Session()
    s.cookies.set("session_token", token)
    lr = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert lr.status_code == 200
    assert s.cookies.get("access_token")

    # confirm session token doc exists
    assert mongo.user_sessions.find_one({"session_token": token}) is not None

    # logout
    lo = s.post(f"{API}/auth/logout")
    assert lo.status_code == 200

    # session_token doc should be deleted
    assert mongo.user_sessions.find_one({"session_token": token}) is None

    # Set-Cookie in response should clear both cookies
    set_cookie_headers = lo.headers.get("set-cookie", "")
    # Response should attempt to clear both
    assert "access_token=" in set_cookie_headers
    assert "session_token=" in set_cookie_headers

    # Subsequent /me with the old session_token cookie must be 401
    r = requests.get(f"{API}/auth/me", cookies={"session_token": token})
    assert r.status_code == 401


def test_google_session_stores_iso_expires_at_and_resolves(mongo, admin_user_id):
    """Regression: expires_at is stored as ISO string in server.py (line 208); ensure _user_from_session_token parses it."""
    token = f"test_stoken_iso_{uuid.uuid4().hex}"
    mongo.user_sessions.insert_one({
        "user_id": admin_user_id,
        "session_token": token,
        # store as ISO string (matches server.py google_session behavior)
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    try:
        r = requests.get(f"{API}/auth/me", cookies={"session_token": token})
        assert r.status_code == 200, r.text
    finally:
        mongo.user_sessions.delete_one({"session_token": token})


def test_expired_iso_string_session_rejected(mongo, admin_user_id):
    token = f"test_stoken_iso_exp_{uuid.uuid4().hex}"
    mongo.user_sessions.insert_one({
        "user_id": admin_user_id,
        "session_token": token,
        "expires_at": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    try:
        r = requests.get(f"{API}/auth/me", cookies={"session_token": token})
        assert r.status_code == 401
    finally:
        mongo.user_sessions.delete_one({"session_token": token})
