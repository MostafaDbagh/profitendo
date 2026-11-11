"""Iter29: comprehensive suite updates — sales export/import (GL+inventory integrated),
purchase returns at original cost, KPI source audit, products export + safe bulk delete."""
import io
import json
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
def product(owner, mongo):
    tag = uuid.uuid4().hex[:6]
    r = owner.post(f"{BASE}/api/products", json={"name": f"TEST_s29_{tag}", "sku": f"S29-{tag}", "selling_price": 50, "product_cost": 10}, timeout=30)
    assert r.status_code in (200, 201), r.text
    p = r.json()
    sp = owner.post(f"{BASE}/api/purchases", json={
        "supplier": "TEST_s29_seed", "payment_method": "credit",
        "items": [{"product_id": p["product_id"], "quantity": 100, "unit_cost": 10}],
    }, timeout=30)
    assert sp.status_code == 201, sp.text
    p["_seed_purchase"] = sp.json()
    yield p
    owner.delete(f"{BASE}/api/products/{p['product_id']}", timeout=30)


def _xlsx(rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


# ---------------------------------------------------------------- 1. sales export

def test_01_sales_export(owner):
    r = owner.get(f"{BASE}/api/sales/export.xlsx", timeout=30)
    assert r.status_code == 200
    assert r.content[:2] == b"PK"
    wb = openpyxl.load_workbook(io.BytesIO(r.content))
    ws = wb.active
    headers = [c.value for c in ws[1]]
    assert headers[0] == "رقم الفاتورة" and "تكلفة البضاعة" in headers and "صافي الربح" in headers
    assert ws.max_row > 1  # tenant has sales history


# ---------------------------------------------------------------- 1. sales import

def test_02_sales_import_template(owner):
    r = owner.get(f"{BASE}/api/sales/import/template", timeout=30)
    assert r.status_code == 200 and r.content[:2] == b"PK"


def test_03_sales_import_preview_validation(owner, product):
    ref = f"IMP-{TAG}"
    rows = [
        ["رقم الفاتورة", "التاريخ", "العميل", "المنتج/SKU", "الكمية", "سعر البيع", "طريقة الدفع", "ملاحظات"],
        [ref, "2026-01-10", "عميل تجريبي", product["sku"], 2, 55, "آجل", ""],   # grouped item 1
        [ref, "2026-01-10", "عميل تجريبي", product["sku"], 1, 55, "آجل", ""],   # grouped item 2 (same ref OK)
        ["", "", "", "NO-SUCH-SKU", 1, 10, "", ""],                              # product not found
        ["", "", "", product["sku"], 999999, 50, "", ""],                        # insufficient stock
        ["", "", "", product["sku"], -3, 50, "", ""],                            # invalid qty
    ]
    files = {"file": ("sales.xlsx", _xlsx(rows), "application/octet-stream")}
    r = owner.post(f"{BASE}/api/sales/import/preview", files=files, data={"mapping": ""}, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    statuses = [row["status"] for row in d["rows"]]
    assert statuses[:2] == ["new", "new"]
    assert d["rows"][2]["reason"] == "product_not_found"
    assert d["rows"][3]["reason"] == "insufficient_stock"
    assert d["rows"][4]["reason"] == "invalid_quantity"
    assert d["summary"]["new"] == 2 and d["summary"]["invalid"] == 3
    # Arabic payment method mapping
    assert d["rows"][0]["values"]["payment_method"] == "credit"


def test_04_sales_import_commit_full_pipeline(owner, product, mongo):
    ref = f"IMP-{TAG}"
    prod_before = owner.get(f"{BASE}/api/products/{product['product_id']}", timeout=30).json()
    stock_before = prod_before["stock_qty"]
    rows = [
        ["رقم الفاتورة", "التاريخ", "العميل", "المنتج/SKU", "الكمية", "سعر البيع", "طريقة الدفع", "ملاحظات"],
        [ref, "2026-01-10", "عميل تجريبي", product["sku"], 2, 55, "آجل", ""],
        [ref, "2026-01-10", "عميل تجريبي", product["sku"], 1, 55, "آجل", ""],
    ]
    files = {"file": ("sales.xlsx", _xlsx(rows), "application/octet-stream")}
    r = owner.post(f"{BASE}/api/sales/import/commit", files=files, data={"mapping": ""}, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json()["invoices_created"] == 1  # same ref grouped into ONE invoice

    sale = mongo.sales.find_one({"business_id": BID, "import_ref": ref})
    assert sale and sale["status"] == "confirmed"
    assert len(sale["items"]) == 2 and sale["total"] == 165.0  # (2+1)*55
    assert sale["payment_method"] == "credit"
    assert sale["date"].startswith("2026-01-10")
    # COGS from POSTED weighted cost (10/unit), not recomputed later
    assert sale["cogs"] == 30.0
    # inventory updated
    prod_after = owner.get(f"{BASE}/api/products/{product['product_id']}", timeout=30).json()
    assert prod_after["stock_qty"] == stock_before - 3
    # balanced GL entry linked to the imported sale: Dr AR 165, Cr Revenue 165, Dr COGS 30, Cr Inventory 30
    entry = mongo.journal_entries.find_one({"business_id": BID, "source_type": "sale", "source_id": sale["sale_id"], "kind": "posted"})
    assert entry and entry["total_debit"] == entry["total_credit"] == 195.0
    legs = {l["code"]: l for l in entry["lines"]}
    assert legs["1300"]["debit"] == 165.0 and legs["4100"]["credit"] == 165.0
    assert legs["5100"]["debit"] == 30.0 and legs["1400"]["credit"] == 30.0

    # idempotency: re-importing the same ref is flagged duplicate, nothing created
    files2 = {"file": ("sales.xlsx", _xlsx(rows), "application/octet-stream")}
    d2 = owner.post(f"{BASE}/api/sales/import/preview", files=files2, data={"mapping": ""}, timeout=30).json()
    assert all(row["status"] == "duplicate" for row in d2["rows"])


def test_05_cogs_uses_posted_cost_not_current_price(owner, product, mongo):
    ref = f"IMP-{TAG}"
    sale = mongo.sales.find_one({"business_id": BID, "import_ref": ref})
    cogs_at_sale = sale["cogs"]
    # change the product's current cost AFTER the sale
    owner.post(f"{BASE}/api/purchases", json={
        "supplier": "TEST_s29_reprice",
        "items": [{"product_id": product["product_id"], "quantity": 100, "unit_cost": 40}],
    }, timeout=30)
    sale_after = mongo.sales.find_one({"business_id": BID, "import_ref": ref})
    assert sale_after["cogs"] == cogs_at_sale  # historical COGS immutable


# ---------------------------------------------------------------- 2. purchase returns

def test_06_purchase_return_original_cost_and_gl(owner, product, mongo):
    pur = product["_seed_purchase"]  # 100 units @ cost 10, payment credit (AP)
    prod_before = owner.get(f"{BASE}/api/products/{product['product_id']}", timeout=30).json()
    r = owner.post(f"{BASE}/api/purchase-returns", json={
        "purchase_id": pur["purchase_id"], "reason": "defective", "refund_method": "credit",
        "items": [{"product_id": product["product_id"], "quantity": 4}],
    }, timeout=30)
    assert r.status_code == 201, r.text
    pr = r.json()
    assert pr["total_value"] == 40.0  # 4 × ORIGINAL cost 10
    assert pr["items"][0]["unit_cost"] == 10
    # stock reduced
    prod_after = owner.get(f"{BASE}/api/products/{product['product_id']}", timeout=30).json()
    assert prod_after["stock_qty"] == prod_before["stock_qty"] - 4
    # GL: Dr AP 40 / Cr Inventory 40, linked to original purchase in narration
    entry = mongo.journal_entries.find_one({"business_id": BID, "source_type": "purchase_return", "source_id": pr["return_id"]})
    assert entry and entry["total_debit"] == entry["total_credit"] == 40.0
    legs = {l["code"]: l for l in entry["lines"]}
    assert legs["2100"]["debit"] == 40.0 and legs["1400"]["credit"] == 40.0
    assert pur["purchase_number"] in entry["narration"]
    # returned qty tracked on the purchase
    pur_after = mongo.purchases.find_one({"purchase_id": pur["purchase_id"]})
    assert pur_after["items"][0].get("returned_qty") == 4
    # over-return rejected
    r2 = owner.post(f"{BASE}/api/purchase-returns", json={
        "purchase_id": pur["purchase_id"], "items": [{"product_id": product["product_id"], "quantity": 999}],
    }, timeout=30)
    assert r2.status_code == 400
    # cancel reverses stock + GL
    rc = owner.post(f"{BASE}/api/purchase-returns/{pr['return_id']}/cancel", timeout=30)
    assert rc.status_code == 200, rc.text
    prod_final = owner.get(f"{BASE}/api/products/{product['product_id']}", timeout=30).json()
    assert prod_final["stock_qty"] == prod_before["stock_qty"]
    entries = list(mongo.journal_entries.find({"business_id": BID, "source_type": "purchase_return", "source_id": pr["return_id"]}))
    assert any(e["kind"] == "reversal" for e in entries)


# ---------------------------------------------------------------- 3&4. KPI audit + drilldown

def test_07_kpi_sources_independent(owner, product, mongo):
    sales = list(mongo.sales.find({"business_id": BID, "status": "confirmed"}))
    returns = list(mongo.returns.find({"business_id": BID}))
    expected_sales = round(sum(s["total"] for s in sales), 2)
    expected_cogs = round(sum(s.get("cogs", 0) for s in sales) - sum(r.get("cogs_reversed", 0) for r in returns), 2)
    d = owner.get(f"{BASE}/api/dashboard", timeout=30).json()
    assert d["total_sales"] == expected_sales          # Σ posted invoices
    assert d["total_product_costs"] == expected_cogs   # Σ posted COGS records
    assert d["total_sales"] != d["total_product_costs"] or expected_sales == expected_cogs == 0
    if expected_sales > 0:
        assert abs(d["profit_margin"] - (d["net_profit"] / expected_sales * 100)) < 0.01


def test_08_drilldown_endpoints(owner):
    r = owner.get(f"{BASE}/api/dashboard/drilldown", params={"metric": "total_sales"}, timeout=30)
    assert r.status_code == 200 and len(r.json()["rows"]) > 0
    row = r.json()["rows"][0]
    assert {"sale_number", "date", "total"} <= set(row)
    r2 = owner.get(f"{BASE}/api/dashboard/drilldown", params={"metric": "net_profit"}, timeout=30)
    s = r2.json()["summary"]
    assert s["net_profit"] == round(s["sales_revenue"] - s["refunds"] - s["cogs_net"] - s["additional_costs"], 2)
    r3 = owner.get(f"{BASE}/api/dashboard/drilldown", params={"metric": "inventory_value"}, timeout=30)
    assert r3.status_code == 200
    r4 = owner.get(f"{BASE}/api/dashboard/drilldown", params={"metric": "nope"}, timeout=30)
    assert r4.status_code == 400


# ---------------------------------------------------------------- 5. products export + bulk delete

def test_09_products_export_reimportable(owner):
    r = owner.get(f"{BASE}/api/products/export.xlsx", timeout=30)
    assert r.status_code == 200 and r.content[:2] == b"PK"
    wb = openpyxl.load_workbook(io.BytesIO(r.content))
    headers = [c.value for c in wb.active[1]]
    assert headers[0] == "اسم المنتج" and "رمز المنتج/SKU" in headers  # same template headers as import


def test_10_bulk_delete_archives_history_products(owner, product, mongo):
    # product with history (seed purchase + imported sale) -> archived, NOT deleted
    nohist = owner.post(f"{BASE}/api/products", json={"name": f"TEST_nohist_{TAG}", "selling_price": 5, "product_cost": 1}, timeout=30).json()
    r = owner.post(f"{BASE}/api/products/bulk-delete",
                   json={"product_ids": [product["product_id"], nohist["product_id"]]}, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["deleted"] == 1 and d["archived"] == 1
    assert product["name"] in d["archived_names"]
    # history product preserved in DB, flagged archived, hidden from list
    assert mongo.products.find_one({"product_id": product["product_id"]})["archived"] is True
    assert mongo.products.find_one({"product_id": nohist["product_id"]}) is None
    listed = owner.get(f"{BASE}/api/products", timeout=30).json()
    assert all(p["product_id"] != product["product_id"] for p in listed)
