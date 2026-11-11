"""Iter33: AI assistant partner purchase-share calculation from real DB records.

Scenario: eligible shared purchases total 371.90 (200.00 + 171.90; a cancelled
999.00 purchase must be excluded). Two partners at 50% each -> allocated 185.95 each.
Partner A paid 100 contribution (withdrew 30, which must NOT reduce the purchase
obligation) -> remaining 85.95. Partner B overpaid 200 -> remaining -14.05 (credit).
"""
import json
import os
import uuid

import pytest
import requests
from pymongo import MongoClient

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(scope="module")
def tenant():
    tag = uuid.uuid4().hex[:6]
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/register", json={
        "name": f"TEST_ps_{tag}", "email": f"test.ps.{tag}@profitlens.app", "password": "TestPs123!",
    }, timeout=30)
    assert r.status_code in (200, 201), r.text
    s.post(f"{BASE}/api/business/setup", json={"name": f"TEST PS {tag}", "base_currency": "USD"}, timeout=30)

    r = s.post(f"{BASE}/api/products", json={"name": f"TEST_ps_p_{tag}", "selling_price": 10, "product_cost": 5}, timeout=30)
    pid = r.json()["product_id"]

    def buy(amount, cancel=False):
        r = s.post(f"{BASE}/api/purchases", json={
            "supplier": "TEST Supplier", "payment_method": "cash",
            "items": [{"product_id": pid, "quantity": 1, "unit_cost": amount}],
        }, timeout=30)
        assert r.status_code in (200, 201), r.text
        pur_id = r.json()["purchase_id"]
        if cancel:
            rc = s.post(f"{BASE}/api/purchases/{pur_id}/cancel", timeout=30)
            assert rc.status_code == 200, rc.text
        return pur_id

    buy(200.00)
    buy(171.90)
    buy(999.00, cancel=True)  # must be excluded

    r = s.post(f"{BASE}/api/partners", json={"name": f"TEST PartnerA {tag}", "ownership_percentage": 50}, timeout=30)
    assert r.status_code == 201, r.text
    pa = r.json()["partner_id"]
    r = s.post(f"{BASE}/api/partners", json={"name": f"TEST PartnerB {tag}", "ownership_percentage": 50}, timeout=30)
    pb = r.json()["partner_id"]

    for pid_, typ, amt in [(pa, "contribution", 100), (pa, "withdrawal", 30), (pb, "contribution", 200)]:
        r = s.post(f"{BASE}/api/partners/{pid_}/transactions", json={"type": typ, "amount": amt}, timeout=30)
        assert r.status_code == 201, r.text
    return s


def _chat(s, message):
    r = s.post(f"{BASE}/api/assistant/chat",
               json={"message": message, "session_id": uuid.uuid4().hex},
               timeout=120, stream=True)
    assert r.status_code == 200, r.text[:500]
    parts = []
    for line in r.iter_lines(decode_unicode=True):
        if not line or not line.startswith("data: "):
            continue
        ev = json.loads(line[6:])
        if ev.get("error"):
            pytest.fail("assistant stream error")
        if "delta" in ev:
            parts.append(ev["delta"])
        if ev.get("done"):
            break
    return "".join(parts)


def test_partner_share_breakdown_from_real_data(tenant):
    reply = _chat(tenant, "احسب حصة كل شريك من المشتريات المشتركة والمبلغ المتبقي على كل شريك مع التفاصيل")
    # allocated share 185.95 for both partners (50% of 371.90)
    assert "185.95" in reply, reply[:800]
    # partner A remaining: 185.95 - 100 paid = 85.95 (withdrawal of 30 must NOT appear as payment)
    assert "85.95" in reply, reply[:800]
    # total eligible purchases 371.90, cancelled 999.00 excluded
    assert "371.9" in reply, reply[:800]
    assert "1,370" not in reply and "1370" not in reply
    # partner B overpaid: 185.95 - 200 = -14.05 credit
    assert "14.05" in reply, reply[:800]


def test_assistant_does_not_claim_data_missing(tenant):
    reply = _chat(tenant, "كم إجمالي المشتريات المشتركة وما نسبة ملكية كل شريك؟")
    assert "50" in reply
    assert "371.9" in reply
    # must not wrongly claim the data does not exist
    assert "لا تتوفر" not in reply and "غير متوفرة" not in reply and "لا توجد بيانات" not in reply
