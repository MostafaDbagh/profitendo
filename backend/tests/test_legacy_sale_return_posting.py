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

            owner_password = secrets.token_urlsafe(20)
            owner = await post("auth/register", {"name": "QA return owner", "email": "return-qa@example.com",
                                                 "password": owner_password}, 200)
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
            elif case == "cancel_duplicate":
                sale = await post("sales", {"items": [sale_item(2)]}, 201)
                body = refund(sale["sale_id"], 1)
                body["items"] *= 2
                ret = await post("returns", body, 201)
                await post("sales", {"items": [sale_item(2)]}, 201)
                previous = await postings()
                await post("returns/" + ret["return_id"] + "/cancel", {}, 400)
                assert await stock() == 1 and await postings() == previous
                saved = await db.returns.find_one({"business_id": bid, "return_id": ret["return_id"]})
                assert saved["status"] == ret["status"]
            elif case == "negative_policy":
                sale = await post("sales", {"items": [sale_item(3)]}, 201)
                for path, payload in (
                    ("sales", {"items": [sale_item(-1)]}),
                    ("sales", {"items": [{**sale_item(1), "unit_price": -0.01}]}),
                    ("sales", {"items": [{**sale_item(1), "discount": -0.01}]}),
                    ("sales", {"items": [{**sale_item(1), "unit_price": "-1e-501"}]}),
                    ("sales", {"items": [{**sale_item(1), "total": "Infinity"}]}),
                    ("cash/closing", {"actual_cash": -1}),
                    ("returns", refund(sale["sale_id"], -1)),
                    ("returns", {**refund(sale["sale_id"], 1), "items": [{**sale_item(1), "unit_price": -0.01}]}),
                    ("purchases", {"supplier": "QA", "items": [{"product_id": pid, "quantity": -1, "unit_cost": 1}]}),
                    ("purchases", {"supplier": "QA", "items": [{"product_id": pid, "quantity": 1, "unit_cost": -0.01}]}),
                ):
                    await post(path, payload, 422)
                ret = await post("returns", refund(sale["sale_id"], 1), 201)
                await post("sales", {"items": [sale_item(1)]}, 201)
                edit_path = "returns/" + ret["return_id"]
                edit = {"restock": False, "pin": owner_password}
                previous = await postings()
                assert (await http.put(edit_path, json=edit)).status_code == 400
                assert await postings() == previous and await stock() == 0
                await db.businesses.update_one({"business_id": bid}, {"$set": {"allow_negative_stock": True}})
                response = await http.put(edit_path, json=edit)
                assert response.status_code == 200, response.text
                assert await stock() == -1
            elif case == "supplier_source":
                receipt_line = {"product_id": pid, "quantity": 3, "unit_cost": 2}
                receipt = await post("purchases", {"supplier": "QA", "items": [receipt_line]}, 201)
                purchase_path = "purchases/" + receipt["purchase_id"]
                before = await stock()
                returned = await post("purchase-returns", {"purchase_id": receipt["purchase_id"],
                                      "items": [{"product_id": pid, "quantity": 1}]}, 201)
                edit = {"pin": owner_password, "items": [dict(receipt_line, quantity=2)]}
                assert (await http.put(purchase_path, json=edit)).status_code == 409
                assert await stock() == before - 1
                await post("purchase-returns/" + returned["return_id"] + "/cancel", {}, 200)
                assert (await http.put(purchase_path, json=edit)).status_code == 200
                assert await stock() == before - 1
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
            elif case in ("holes", "legacy_holes"):
                sale = await post("sales", {"items": [{**sale_item(1), "unit_price": 12},
                                                        {**sale_item(1), "unit_price": 7}]}, 201)
                sid = sale["sale_id"]
                first = await post("returns", refund(sid, 1), 201)
                second = await post("returns", refund(sid, 1), 201)
                assert [first["refund_total"], second["refund_total"]] == [12, 7]
                if case == "legacy_holes":
                    await db.returns.update_many({"business_id": bid, "sale_id": sid},
                                                 {"$unset": {"items.$[].sale_ranges": ""}})
                await post("returns/"+first["return_id"]+"/cancel", {}, 200)
                edit_path = "returns/"+second["return_id"]
                request = refund(sid, 1)
                assert (await post(edit_path+"/preview", request, 200))["total"] == 7
                edited = await http.put(edit_path, json={"items": request["items"], "pin": owner_password})
                assert edited.status_code == 200, edited.text
                assert edited.json()["refund_total"] == 7
                assert (await post("returns/preview", request, 200))["total"] == 12
                last = await post("returns", request, 201)
                assert last["refund_total"] == 12
                assert await stock() == 3
                entries = await db.journal_entries.find({"business_id": bid, "source_type": "return"}).to_list(None)
                cash_out = sum(l["credit"] - l["debit"] for e in entries for l in e["lines"] if l["code"] == "1100")
                assert cash_out == sale["total"] == 19
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

    def test_cancel_restocked_duplicate_rows_requires_combined_stock(self):
        self.check_posting("cancel_duplicate")

    def test_negative_inputs_and_return_edit_stock_policy(self):
        self.check_posting("negative_policy")

    def test_supplier_return_preserves_source_until_reversed(self):
        self.check_posting("supplier_source")

    def test_duplicate_sku_oversell(self):
        self.check_posting("aggregate")

    def test_failed_movement_rolls_back_and_retry_posts_once(self):
        self.check_posting("rollback")

    def test_concurrent_full_refunds(self):
        self.check_posting("race")

    def test_cancelled_sale_refund_and_preview(self):
        self.check_posting("cancelled")

    def test_non_sequential_refund_cancellation_and_edit(self):
        self.check_posting("holes")

    def test_legacy_refund_allocations_survive_cancellation_and_edit(self):
        self.check_posting("legacy_holes")

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
