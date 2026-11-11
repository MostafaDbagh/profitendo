"""Iter36: purchases Excel export/import + Excel backup workbook."""
import io
import os
import uuid

import openpyxl
import pytest
import requests
from pymongo import MongoClient

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
OWNER = {"email": "test.seller@profitlens.app", "password": "TestSeller123!"}
BID = "biz_7101d3986f3c"
TAG = uuid.uuid4().hex[:6]

HEADERS = ["رقم الفاتورة", "التاريخ", "المورد", "المنتج/SKU", "الكمية", "سعر الشراء", "طريقة الدفع", "تكاليف إضافية", "ملاحظات"]


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
def product(owner):
    r = owner.post(f"{BASE}/api/products", json={
        "name": f"TEST_pim_{TAG}", "sku": f"PIM-{TAG}", "selling_price": 50, "product_cost": 30,
    }, timeout=30)
    assert r.status_code in (200, 201), r.text
    p = r.json()
    yield p
    owner.delete(f"{BASE}/api/products/{p['product_id']}", timeout=30)


def test_template_download(owner):
    r = owner.get(f"{BASE}/api/purchases/import/template", timeout=30)
    assert r.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(r.content))
    ws = wb[wb.sheetnames[0]]
    assert [c.value for c in ws[1]] == HEADERS


def test_export_xlsx(owner):
    r = owner.get(f"{BASE}/api/purchases/export.xlsx", timeout=30)
    assert r.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(r.content))
    ws = wb[wb.sheetnames[0]]
    assert [c.value for c in ws[1]] == HEADERS


def test_preview_and_commit_import(owner, mongo, product):
    rows = [
        HEADERS,
        [f"PO-{TAG}-A", "2026-02-01", f"Supplier {TAG}", product["sku"], 10, 30, "نقدي", 5, "batch A"],
        [f"PO-{TAG}-A", "2026-02-01", f"Supplier {TAG}", product["sku"], 5, 32, "نقدي", "", ""],
        [f"PO-{TAG}-B", "2026-02-02", f"Supplier {TAG}", "NOPE-SKU", 2, 10, "نقدي", "", ""],
    ]
    files = {"file": ("purchases.xlsx", _xlsx(rows).getvalue(),
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    pv = owner.post(f"{BASE}/api/purchases/import/preview", files=files, timeout=60)
    assert pv.status_code == 200, pv.text
    data = pv.json()
    assert data["summary"]["new"] == 2 and data["summary"]["invalid"] == 1, data["summary"]
    assert any(r["reason"] == "product_not_found" for r in data["rows"])

    files = {"file": ("purchases.xlsx", _xlsx(rows).getvalue(),
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    cm = owner.post(f"{BASE}/api/purchases/import/commit", files=files, timeout=60)
    assert cm.status_code == 200, cm.text
    out = cm.json()
    assert out["invoices_created"] == 1 and out["rows_imported"] == 2 and out["invalid"] == 1, out

    doc = mongo.purchases.find_one({"business_id": BID, "import_ref": f"PO-{TAG}-A"})
    assert doc and len(doc["items"]) == 2
    assert doc["total"] == 10 * 30 + 5 * 32 + 5
    p = mongo.products.find_one({"product_id": product["product_id"]})
    assert p["stock_qty"] >= 15

    # re-importing the same file must be flagged fully duplicate
    files = {"file": ("purchases.xlsx", _xlsx(rows).getvalue(),
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    pv2 = owner.post(f"{BASE}/api/purchases/import/preview", files=files, timeout=60)
    assert pv2.status_code == 200
    s2 = pv2.json()["summary"]
    assert s2["new"] == 0 and s2["duplicate"] == 2, s2

    files = {"file": ("purchases.xlsx", _xlsx(rows).getvalue(),
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    cm2 = owner.post(f"{BASE}/api/purchases/import/commit", files=files, timeout=60)
    assert cm2.json()["invoices_created"] == 0

    # existing purchase records were never modified — clean up via API to keep
    # stock, weighted-average cost, inventory movements and GL consistent
    owner.post(f"{BASE}/api/purchases/{doc['purchase_id']}/cancel", timeout=30)


def test_backup_xlsx_workbook(owner):
    r = owner.get(f"{BASE}/api/backup/export.xlsx", timeout=60)
    assert r.status_code == 200, r.text
    wb = openpyxl.load_workbook(io.BytesIO(r.content))
    for sheet in ["Products", "Purchases", "Purchase Items", "Sales", "Sale Items",
                  "Expenses", "Inventory", "Accounting Records"]:
        assert sheet in wb.sheetnames, sheet
    assert "product_id" in [c.value for c in wb["Products"][1]]
    assert "purchase_id" in [c.value for c in wb["Purchase Items"][1]]
    assert "sale_id" in [c.value for c in wb["Sale Items"][1]]


def test_backup_json_still_available(owner):
    r = owner.get(f"{BASE}/api/backup/export", timeout=60)
    assert r.status_code == 200
    assert "application/json" in r.headers.get("Content-Type", "")
    import json as _json
    payload = _json.loads(r.content)
    assert payload["meta"]["app"] == "ProfitLens"
