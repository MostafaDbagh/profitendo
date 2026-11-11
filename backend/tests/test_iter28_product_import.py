"""Iter28: bulk product import — parsing, mapping, statuses, strategies, GL guard, rollback."""
import asyncio
import hashlib
import io
import json
import os
import sys
import uuid

import openpyxl
import pytest
import requests
from pymongo import MongoClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
OWNER = {"email": "test.seller@profitlens.app", "password": "TestSeller123!"}
BID = "biz_7101d3986f3c"
TAG = uuid.uuid4().hex[:6]


def _xlsx(rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


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
def existing(owner):
    r = owner.post(f"{BASE}/api/products", json={"name": f"TEST_imp_existing_{TAG}", "sku": f"EXIST-{TAG}", "selling_price": 10, "product_cost": 5}, timeout=30)
    assert r.status_code in (200, 201), r.text
    p = r.json()
    yield p
    owner.delete(f"{BASE}/api/products/{p['product_id']}", timeout=30)


def _headers():
    return ["اسم المنتج", "رمز المنتج/SKU", "الفئة", "وحدة القياس", "سعر الشراء", "سعر البيع", "الكمية الابتدائية", "الوصف"]


def _upload(sess, buf_or_text, filename, strategy="skip", mapping=None):
    files = {"file": (filename, buf_or_text, "application/octet-stream")}
    data = {"strategy": strategy}
    if mapping is not None:
        data["mapping"] = json.dumps(mapping)
    return files, data


def test_01_template_download(owner):
    r = owner.get(f"{BASE}/api/products/import/template", timeout=30)
    assert r.status_code == 200, r.text
    assert r.content[:2] == b"PK"
    assert "spreadsheetml" in r.headers["content-type"]


def test_02_preview_statuses(owner, existing):
    rows = [
        _headers(),
        [f"TEST_imp_new_{TAG}", f"NEW-{TAG}", "مشروبات", "كيلو", 10, 20, 15, "desc"],       # new
        [f"TEST_imp_dup_{TAG}", f"NEW-{TAG}", "", "", 5, 8, 3, ""],                          # duplicate in file (same sku)
        ["Updated Name", f"EXIST-{TAG}", "", "", 7, 12, 99, ""],                             # exists in db (sku)
        ["", "NO-NAME", "", "", 1, 2, 1, ""],                                                # missing name
        [f"TEST_imp_badprice_{TAG}", "", "", "", "abc", 5, 1, ""],                           # invalid price
        [f"TEST_imp_badqty_{TAG}", "", "", "", 5, 8, "xyz", ""],                             # invalid qty
    ]
    files, data = _upload(owner, _xlsx(rows), "import.xlsx")
    r = owner.post(f"{BASE}/api/products/import/preview", files=files, data=data, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["suggested_mapping"]["name"] == "اسم المنتج"  # auto-mapped Arabic headers
    assert d["suggested_mapping"]["sku"] == "رمز المنتج/SKU"
    statuses = [row["status"] for row in d["rows"]]
    assert statuses == ["new", "duplicate", "duplicate", "invalid", "invalid", "invalid"]
    reasons = [row["reason"] for row in d["rows"]]
    assert reasons[1] == "duplicate_in_file" and reasons[2] == "exists_sku"
    assert reasons[3] == "missing_name" and reasons[4] == "invalid_price" and reasons[5] == "invalid_quantity"
    assert d["summary"] == {"total": 6, "new": 1, "update": 0, "duplicate": 2, "invalid": 3}
    # unit standardization
    assert d["rows"][0]["values"]["spec_unit"] == "kilogram"


def test_03_preview_update_strategy_marks_updates(owner, existing):
    rows = [_headers(), ["Updated Name", f"EXIST-{TAG}", "", "", 7, 12, 99, ""]]
    files, data = _upload(owner, _xlsx(rows), "import.xlsx", strategy="update")
    d = owner.post(f"{BASE}/api/products/import/preview", files=files, data=data, timeout=30).json()
    assert d["rows"][0]["status"] == "update"
    assert d["summary"]["update"] == 1


def test_04_csv_upload_and_formula_never_evaluated(owner):
    csv_text = "name,sku,selling price\nTEST_imp_csv_" + TAG + ",CSV-" + TAG + ",33\n=1+1,FORMULA-" + TAG + ",10\n"
    files, data = _upload(owner, io.BytesIO(csv_text.encode()), "import.csv")
    d = owner.post(f"{BASE}/api/products/import/preview", files=files, data=data, timeout=30).json()
    assert d["summary"]["total"] == 2
    by_sku = {r["values"]["sku"]: r for r in d["rows"]}
    assert by_sku[f"CSV-{TAG}"]["status"] == "new"
    # formula cell: either sanitized to text (apostrophe-prefixed) or treated as-is — NEVER evaluated to a number
    frow = by_sku[f"FORMULA-{TAG}"]
    assert frow["values"]["name"] in ("=1+1", "'=1+1")


def test_05_bad_extension_rejected(owner):
    files, data = _upload(owner, io.BytesIO(b"nope"), "import.xlsm")
    r = owner.post(f"{BASE}/api/products/import/preview", files=files, data=data, timeout=30)
    assert r.status_code == 400 and "IMPORT_UNSUPPORTED_FORMAT" in r.text


def test_06_commit_skip_creates_only_new(owner, existing, mongo):
    rows = [
        _headers(),
        [f"TEST_imp_new_{TAG}", f"NEW-{TAG}", "مشروبات", "قطعة", 10, 20, 15, "desc"],
        ["Updated Name", f"EXIST-{TAG}", "", "", 7, 12, 99, ""],
    ]
    files, data = _upload(owner, _xlsx(rows), "import.xlsx", strategy="skip",
                          mapping={"name": "اسم المنتج", "sku": "رمز المنتج/SKU", "category": "الفئة", "unit": "وحدة القياس",
                                   "purchase_price": "سعر الشراء", "selling_price": "سعر البيع", "initial_quantity": "الكمية الابتدائية", "description": "الوصف"})
    r = owner.post(f"{BASE}/api/products/import/commit", files=files, data=data, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json()["new"] == 1 and r.json()["duplicate"] == 1
    prod = mongo.products.find_one({"business_id": BID, "sku": f"NEW-{TAG}"})
    assert prod["stock_qty"] == 15 and prod["opening_stock_imported"] is True
    assert prod["spec_unit"] == "piece" and prod["category"] == "مشروبات"
    # GL GUARD: importing initial stock must create ZERO journal entries
    assert mongo.journal_entries.count_documents({"business_id": BID, "source_id": prod["product_id"]}) == 0
    # duplicate row did NOT touch the existing product
    ex = mongo.products.find_one({"business_id": BID, "sku": f"EXIST-{TAG}"})
    assert ex["name"] == f"TEST_imp_existing_{TAG}" and ex.get("selling_price") == 10
    mongo.products.delete_one({"product_id": prod["product_id"]})


def test_07_commit_update_strategy(owner, existing, mongo):
    rows = [_headers(), ["Updated Name", f"EXIST-{TAG}", "فئة جديدة", "", 7, 12, 99, ""]]
    files, data = _upload(owner, _xlsx(rows), "import.xlsx", strategy="update")
    r = owner.post(f"{BASE}/api/products/import/commit", files=files, data=data, timeout=30)
    assert r.status_code == 200 and r.json()["update"] == 1, r.text
    ex = mongo.products.find_one({"business_id": BID, "sku": f"EXIST-{TAG}"})
    assert ex["name"] == "Updated Name" and ex["selling_price"] == 12 and ex["product_cost"] == 7
    assert ex["category"] == "فئة جديدة"
    assert ex.get("stock_qty", 0) == 0  # update never touches stock (inventory via transactions only)


def test_08_rollback_on_write_failure(owner, mongo):
    """In-process: if a mid-batch write fails, inserted docs are deleted and updates restored."""
    from unittest.mock import patch
    import imports as imp

    user = {"user_id": "u_test", "business_id": BID}

    class FlakyProducts:
        def __init__(self, real):
            self._real = real
            self.calls = 0

        async def insert_one(self, doc):
            self.calls += 1
            if self.calls == 2:
                raise RuntimeError("boom")
            return await self._real.insert_one(doc)

        def __getattr__(self, name):
            return getattr(self._real, name)

    class FakeDB:
        def __init__(self, real_db):
            self.products = FlakyProducts(real_db.products)

    # Fresh Motor client bound to THIS test's loop — core.db may be bound to another
    # loop when the full suite runs in one worker process.
    from motor.motor_asyncio import AsyncIOMotorClient
    fresh_client = AsyncIOMotorClient(os.environ["MONGO_URL"])

    rows = [
        {"status": "new", "values": {"name": f"TEST_rb1_{TAG}", "sku": f"RB1-{TAG}", "category": "", "spec_unit": None,
                                     "product_cost": 1, "selling_price": 2, "stock_qty": 5, "description": ""}},
        {"status": "new", "values": {"name": f"TEST_rb2_{TAG}", "sku": f"RB2-{TAG}", "category": "", "spec_unit": None,
                                     "product_cost": 1, "selling_price": 2, "stock_qty": 5, "description": ""}},
    ]

    async def main():
        with patch.object(imp, "db", FakeDB(fresh_client[DB_NAME])):
            with pytest.raises(Exception):
                await imp.apply_rows(user, rows, {})

    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(main())
    finally:
        loop.close()
        fresh_client.close()
    # first insert rolled back, nothing partial remains
    assert mongo.products.find_one({"business_id": BID, "sku": f"RB1-{TAG}"}) is None
    assert mongo.products.find_one({"business_id": BID, "sku": f"RB2-{TAG}"}) is None


def test_09_import_requires_permission():
    r = requests.post(f"{BASE}/api/products/import/preview", timeout=30)
    assert r.status_code == 401  # unauthenticated rejected
