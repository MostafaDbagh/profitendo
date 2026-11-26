"""Live regression suite for an explicitly isolated loopback API and Mongo replica set."""
import concurrent.futures
import os
import secrets
import unittest
import uuid
from urllib.parse import urlsplit

import httpx
from pymongo import MongoClient


@unittest.skipUnless(os.environ.get("ERP_FINANCE_TEST_API"), "Dedicated ERP finance test service required")
class FinancialPostingRegressions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        url = os.environ["ERP_FINANCE_TEST_API"]
        mongo = os.environ["ERP_FINANCE_TEST_MONGO"]
        name = os.environ["ERP_FINANCE_TEST_DB"]
        if urlsplit(url).hostname != "127.0.0.1" or urlsplit(mongo).hostname != "127.0.0.1" or not name.endswith("_test"):
            raise ValueError("A dedicated loopback test environment is required")
        cls.api = httpx.Client(base_url=url, trust_env=False, timeout=15)
        cls.mongo = MongoClient(mongo)
        cls.db = cls.mongo[name]
        result = cls.api.post("/auth/register", json={
            "name": "Finance regression", "email": f"finance-{uuid.uuid4().hex}@example.com",
            "password": secrets.token_urlsafe(24),
        })
        result.raise_for_status()
        cls.tenant = {"business_id": result.json()["business_id"]}
        if not cls.db.businesses.find_one(cls.tenant):
            raise ValueError("API and audit database must match")
        cls.api.headers["Cookie"] = "access_token=" + result.cookies["access_token"]

    @classmethod
    def tearDownClass(cls):
        cls.api.close()
        cls.mongo.close()

    def post(self, path, **data):
        response = self.api.post(path, json=data)
        self.assertLess(response.status_code, 300, response.text)
        return response.json()

    def test_cash_tracks_purchases_refunds_reversals_and_closing(self):
        def balance():
            return self.api.get("/cash/summary").raise_for_status().json()["balance"]
        opening = balance()
        product = self.post("/products", name="Test fruit", product_cost=2, selling_price=10)["product_id"]
        receipt = self.post("/purchases", supplier="Test supplier", payment_method="cash",
                            items=[{"product_id": product, "quantity": 10, "unit_cost": 2}])
        self.assertEqual(balance(), opening - 20)
        sale = self.post("/sales", items=[{"product_id": product, "quantity": 2, "unit_price": 10}])
        ret = self.post("/returns", sale_id=sale["sale_id"], reason="other", items=[{"product_id": product, "quantity": 1}])
        self.assertEqual(balance(), opening - 10)
        self.post(f"/returns/{ret['return_id']}/cancel")
        self.assertEqual(balance(), opening)
        supplier_refund = self.post("/purchase-returns", purchase_id=receipt["purchase_id"], refund_method="cash",
                                    items=[{"product_id": product, "quantity": 1}])
        self.assertEqual(balance(), opening + 2)
        self.post(f"/purchase-returns/{supplier_refund['return_id']}/cancel")
        self.assertEqual(balance(), opening)
        journal_cash = sum(line["debit"] - line["credit"] for entry in self.db.journal_entries.find(self.tenant)
                           for line in entry["lines"] if line["code"] == "1100")
        self.assertEqual(journal_cash, balance())
        self.assertEqual(self.post("/cash/closing", actual_cash=balance())["expected"], journal_cash)

    def test_concurrent_expense_and_replays_after_edit_or_delete(self):
        payload = {"amount": 7, "category": "rent", "client_ref": uuid.uuid4().hex}
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(lambda _: self.post("/expenses", **payload), range(3)))
        ids = {r["expense_id"] for r in results}
        self.assertEqual(len(ids), 1)
        expense_id = ids.pop()
        self.assertEqual(self.db.journal_entries.count_documents({**self.tenant, "source_id": expense_id}), 1)
        self.assertEqual(self.api.post("/expenses", json={**payload, "amount": 8}).status_code, 409)
        self.api.put(f"/expenses/{expense_id}", json={"category": "rent", "amount": 9}).raise_for_status()
        self.assertEqual(self.post("/expenses", **payload)["amount"], 9)
        self.api.delete(f"/expenses/{expense_id}").raise_for_status()
        self.assertEqual(self.api.post("/expenses", json=payload).status_code, 409)
        self.assertEqual(self.db.expenses.count_documents({**self.tenant, "expense_id": expense_id}), 0)

    def test_expense_precision_and_calendar(self):
        for amount, date in ((0, None), (-1, None), (.001, None), ("1e300", None), (1, "2026-02-30"), (1, "2026-13-01")):
            with self.subTest(amount=amount, date=date):
                r = self.api.post("/expenses", json={"category": "rent", "amount": amount, "date": date})
                self.assertEqual(r.status_code, 422, r.text)
        self.assertEqual(self.post("/expenses", category="rent", amount=.01, date="2024-02-29")["amount"], .01)


if __name__ == "__main__":
    unittest.main()
