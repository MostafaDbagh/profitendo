"""Iter27: secure forgot/reset password flow.

- forgot-password: generic anti-enumeration response; token stored as SHA-256 hash
  only (raw token never persisted); 30-min expiry; rate limited 5/hour per IP+email.
- reset-password: valid token flow (login with new password works, token invalidated,
  reuse rejected), expired token rejected, unknown token rejected.
"""
import hashlib
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
OWNER = {"email": "test.seller@profitlens.app", "password": "TestSeller123!"}


@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


def _owner_doc(mongo):
    return mongo.users.find_one({"email": OWNER["email"]})


def test_01_forgot_unknown_email_generic_response(mongo):
    email = f"nouser_{uuid.uuid4().hex[:8]}@profitlens.app"
    r = requests.post(f"{BASE}/api/auth/forgot-password", json={"email": email}, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json()["message"] == "RESET_EMAIL_GENERIC"
    assert not mongo.users.find_one({"email": email})


def test_02_forgot_known_email_stores_hashed_token(mongo):
    r = requests.post(f"{BASE}/api/auth/forgot-password", json={"email": OWNER["email"]}, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json()["message"] == "RESET_EMAIL_GENERIC"  # identical to unknown-email response
    assert "reset_token_hash" not in r.text and "token" not in r.text.lower()
    doc = _owner_doc(mongo)
    assert doc.get("reset_token_hash") and len(doc["reset_token_hash"]) == 64  # sha256 hex
    assert doc.get("reset_token_expires")
    # raw token is never stored: hash must not equal any plausible raw value we know
    assert doc["reset_token_hash"] != OWNER["password"]


def test_03_rate_limit_five_per_hour(mongo):
    email = f"rl_{uuid.uuid4().hex[:8]}@profitlens.app"
    codes = [requests.post(f"{BASE}/api/auth/forgot-password", json={"email": email}, timeout=30).status_code for _ in range(6)]
    assert codes[:5] == [200] * 5
    assert codes[5] == 429


def _set_token(mongo, token, expires_in_minutes=30):
    mongo.users.update_one(
        {"email": OWNER["email"]},
        {"$set": {
            "reset_token_hash": hashlib.sha256(token.encode()).hexdigest(),
            "reset_token_expires": (datetime.now(timezone.utc) + timedelta(minutes=expires_in_minutes)).isoformat(),
        }},
    )


def test_04_reset_with_valid_token_and_single_use(mongo):
    token = f"tok_{uuid.uuid4().hex}"
    _set_token(mongo, token)
    r = requests.post(f"{BASE}/api/auth/reset-password", json={"token": token, "new_password": "NewPass999!"}, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json()["message"] == "RESET_SUCCESS"
    # token invalidated immediately
    doc = _owner_doc(mongo)
    assert not doc.get("reset_token_hash") and not doc.get("reset_token_expires")
    # new password works
    lr = requests.post(f"{BASE}/api/auth/login", json={"email": OWNER["email"], "password": "NewPass999!"}, timeout=30)
    assert lr.status_code == 200, lr.text
    # token reuse rejected
    r2 = requests.post(f"{BASE}/api/auth/reset-password", json={"token": token, "new_password": "OtherPass1!"}, timeout=30)
    assert r2.status_code == 400 and "RESET_LINK_INVALID" in r2.text


def test_05_expired_token_rejected(mongo):
    token = f"tok_{uuid.uuid4().hex}"
    _set_token(mongo, token, expires_in_minutes=-5)
    r = requests.post(f"{BASE}/api/auth/reset-password", json={"token": token, "new_password": "Whatever1!"}, timeout=30)
    assert r.status_code == 400 and "RESET_LINK_EXPIRED" in r.text
    mongo.users.update_one({"email": OWNER["email"]}, {"$unset": {"reset_token_hash": "", "reset_token_expires": ""}})


def test_06_unknown_token_rejected():
    r = requests.post(f"{BASE}/api/auth/reset-password", json={"token": f"tok_{uuid.uuid4().hex}", "new_password": "Whatever1!"}, timeout=30)
    assert r.status_code == 400 and "RESET_LINK_INVALID" in r.text


def test_07_restore_owner_password(mongo):
    token = f"tok_{uuid.uuid4().hex}"
    _set_token(mongo, token)
    r = requests.post(f"{BASE}/api/auth/reset-password", json={"token": token, "new_password": OWNER["password"]}, timeout=30)
    assert r.status_code == 200, r.text
    lr = requests.post(f"{BASE}/api/auth/login", json=OWNER, timeout=30)
    assert lr.status_code == 200, lr.text  # original credentials restored for other suites
