"""Opt-in HTTP regressions for a disposable, loopback Mongo replica set.

Run ERP_TEST_MONGO_URL=<loopback URI> backend/.venv/bin/python backend/tests/test_legacy_sale_return_posting.py
"""
import asyncio
import os
import re
import secrets
import subprocess
import sys
import unittest
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4


async def exercise(case):
    import httpx
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from core import client
    from server import app, startup

    db = client[os.environ["DB_NAME"]]
    try:
        await startup()
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
                                     base_url="https://erp.test/api") as http:
            async def post(path, body, status):
                response = await http.post(path, json=body)
                assert response.status_code == status, (path, response.status_code, response.text[:300])
                if status < 300:
                    return response.json()

            owner = await post("auth/register", {"name": "QA return owner", "email": "return-qa@example.com",
                                                 "password": secrets.token_urlsafe(20)}, 200)
            bid = owner["business_id"]
            product = await post("products", {"name": "QA rice", "selling_price": 10, "product_cost": 2}, 201)
            pid = product["product_id"]
            await post("inventory/adjust", {"product_id": pid, "quantity": 3, "movement_type": "ADJUSTMENT"}, 201)

            async def stock():
                return (await db.products.find_one({"business_id": bid, "product_id": pid}))["stock_qty"]

            def sale_item(qty):
                return {"product_id": pid, "quantity": qty, "unit_price": 10}

            def refund(sale_id, qty):
                return {"sale_id": sale_id, "reason": "other", "client_ref": uuid4().hex,
                        "items": [{"product_id": pid, "quantity": qty}]}

            async def postings():
                return tuple([await db[name].count_documents({"business_id": bid})
                              for name in ("sales", "returns", "inventory_movements", "journal_entries")])

            before = await postings()
            if case == "aggregate":
                await post("sales", {"items": [sale_item(2), sale_item(2)]}, 400)
                assert await postings() == before and await stock() == 3
            elif case == "rollback":
                sale = {"items": [sale_item(1)], "client_ref": uuid4().hex}
                await db.command("collMod", "inventory_movements", validator={"movement_type": {"$ne": "SALE"}})
                await post("sales", sale, 500)
                assert await postings() == before and await stock() == 3
                await db.command("collMod", "inventory_movements", validator={})
                saved = await post("sales", sale, 201)
                replay = await post("sales", sale, 201)
                assert saved["sale_id"] == replay["sale_id"] and await stock() == 2
                assert await postings() == (before[0]+1, before[1], before[2]+1, before[3]+1)
            elif case == "race":
                sale = await post("sales", {"items": [sale_item(2)]}, 201)
                sales_before = await postings()
                requests = [refund(sale["sale_id"], 2) for _ in range(4)]
                attempts = await asyncio.gather(*(http.post("returns", json=body) for body in requests))
                assert sorted(r.status_code for r in attempts) == [201, 400, 400, 400]
                assert await stock() == 3
                assert await postings() == (sales_before[0], sales_before[1]+1, sales_before[2]+1, sales_before[3]+1)
                assert sum(r.json()["refund_total"] for r in attempts if r.status_code == 201) == 20
            elif case == "cancelled":
                sale = await post("sales", {"items": [sale_item(1)]}, 201)
                await post("sales/"+sale["sale_id"]+"/cancel", {}, 200)
                after_cancel = await postings()
                body = refund(sale["sale_id"], 1)
                await post("returns/preview", body, 409)
                await post("returns", body, 409)
                assert await postings() == after_cancel and await stock() == 3
            elif case == "discount":
                sale = await post("sales", {"items": [{**sale_item(3), "discount": 20}]}, 201)
                assert sale["total"] == 10
                for expected in (3.33, 3.34, 3.33):
                    body = refund(sale["sale_id"], 1)
                    previous = await postings()
                    assert (await post("returns/preview", body, 200))["total"] == expected
                    assert await postings() == previous
                    returned = await post("returns", body, 201)
                    assert returned["refund_total"] == expected
                assert await stock() == 3
                await post("returns/preview", refund(sale["sale_id"], 1), 400)
                journal = await db.journal_entries.find({"business_id": bid, "source_type": "return"}).to_list(None)
                refunded = sum(line["credit"] for entry in journal for line in entry["lines"] if line["code"] == "1100")
                assert len(journal) == 3 and round(refunded, 2) == 10
    finally:
        # The parent supplies a unique, disposable database for each method.
        await client.drop_database(db.name)
        client.close()


@unittest.skipUnless(os.getenv("ERP_TEST_MONGO_URL"), "requires a disposable loopback Mongo replica set")
class SaleReturnRegressionTests(unittest.TestCase):
    def check_posting(self, case):
        uri = os.environ["ERP_TEST_MONGO_URL"]
        self.assertIn(urlparse(uri).hostname, {"localhost", "127.0.0.1", "::1"})
        subprocess.run([sys.executable, __file__, "--fixture", case], check=True, env={
            **os.environ, "MONGO_URL": uri, "DB_NAME": "erp_qa_posting_" + uuid4().hex,
            "PYTHON_DOTENV_DISABLED": "1", "ADMIN_EMAIL": "qa-admin@example.com",
            "ADMIN_PASSWORD": secrets.token_urlsafe(20), "JWT_SECRET": secrets.token_hex(32),
        })

    def test_duplicate_sku_oversell(self):
        self.check_posting("aggregate")

    def test_failed_movement_rolls_back_and_retry_posts_once(self):
        self.check_posting("rollback")

    def test_concurrent_full_refunds(self):
        self.check_posting("race")

    def test_cancelled_sale_refund_and_preview(self):
        self.check_posting("cancelled")

    def test_discounted_partial_refund_preview_matches_journal(self):
        self.check_posting("discount")


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--fixture":
        if (not re.fullmatch(r"erp_qa_posting_[0-9a-f]{32}", os.environ.get("DB_NAME", ""))
                or urlparse(os.environ.get("MONGO_URL", "")).hostname not in {"127.0.0.1", "localhost", "::1"}):
            raise RuntimeError("Disposable test database required")
        asyncio.run(exercise(sys.argv[2]))
    else:
        unittest.main(verbosity=2)
