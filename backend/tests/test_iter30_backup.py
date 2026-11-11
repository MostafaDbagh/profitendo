"""Iter30: owner-triggered full JSON backup export (GET /api/backup/export)."""
import json
import os
import uuid

import pytest
import requests
from pymongo import MongoClient

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
OWNER = {"email": "test.seller@profitlens.app", "password": "TestSeller123!"}
BID = "biz_7101d3986f3c"
TAG = uuid.uuid4().hex[:6]

EXPECTED_KEYS = {
    "business", "users", "products", "sales", "purchases", "purchase_returns",
    "returns", "expenses", "inventory_movements", "cash_closings", "withdrawals",
    "partners", "partner_transactions", "accounts", "journal_entries", "audit_logs",
}


@pytest.fixture(scope="module")
def owner():
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json=OWNER, timeout=30)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(scope="module")
def employee(owner):
    uname = f"testbkp{TAG}"
    r = owner.post(f"{BASE}/api/team", json={
        "name": f"TEST_backup_{TAG}", "role": "EMPLOYEE",
        "username": uname, "password": "Backup123!",
    }, timeout=30)
    assert r.status_code == 201, r.text
    uid = r.json()["user_id"]
    s = requests.Session()
    lr = s.post(f"{BASE}/api/auth/kiosk-login", json={"username": uname, "password": "Backup123!"}, timeout=30)
    assert lr.status_code == 200, lr.text
    yield s
    owner.put(f"{BASE}/api/team/{uid}", json={"status": "inactive"}, timeout=30)


def test_owner_export_succeeds_with_json_attachment(owner):
    r = owner.get(f"{BASE}/api/backup/export", timeout=60)
    assert r.status_code == 200, r.text
    assert "application/json" in r.headers.get("Content-Type", "")
    cd = r.headers.get("Content-Disposition", "")
    assert "attachment" in cd and "profitlens-backup-" in cd and ".json" in cd


def test_backup_structure_and_scoping(owner, mongo):
    r = owner.get(f"{BASE}/api/backup/export", timeout=60)
    payload = json.loads(r.content)
    assert payload["meta"]["app"] == "ProfitLens"
    assert payload["meta"]["format_version"] == 1
    assert payload["meta"]["business_id"] == BID
    assert payload["meta"]["exported_at"]
    assert set(payload["data"].keys()) == EXPECTED_KEYS
    # business doc matches DB and every collection is scoped to this business only
    assert payload["data"]["business"]["business_id"] == BID
    for key, docs in payload["data"].items():
        assert isinstance(docs, list if key not in ("business",) else dict)
        if isinstance(docs, list):
            assert all(d.get("business_id") == BID for d in docs), key
    # counts match live DB
    for coll in ("products", "sales", "accounts", "journal_entries"):
        assert len(payload["data"][coll]) == mongo[coll].count_documents({"business_id": BID}), coll


def test_backup_excludes_secrets(owner):
    r = owner.get(f"{BASE}/api/backup/export", timeout=60)
    raw = r.content.decode("utf-8")
    for forbidden in ("password_hash", "pin_hash", "reset_token_hash", "$2b$"):
        assert forbidden not in raw, forbidden


def test_backup_audit_logged(owner, mongo):
    r = owner.get(f"{BASE}/api/backup/export", timeout=60)
    assert r.status_code == 200
    log = mongo.audit_logs.find_one({"business_id": BID, "action": "backup.exported"}, sort=[("created_at", -1)])
    assert log is not None


def test_non_owner_forbidden(employee):
    r = employee.get(f"{BASE}/api/backup/export", timeout=30)
    assert r.status_code == 403


def test_unauthenticated_rejected():
    r = requests.get(f"{BASE}/api/backup/export", timeout=30)
    assert r.status_code == 401
