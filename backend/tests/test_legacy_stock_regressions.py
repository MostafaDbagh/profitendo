"""Opt-in integration test with a fresh database on a disposable localhost replica set.

Run ERP_TEST_MONGO_URL=<loopback URI> backend/.venv/bin/python backend/tests/test_legacy_stock_regressions.py
"""
import asyncio
import os
import sys
import unittest
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4


@unittest.skipUnless(os.getenv("ERP_TEST_MONGO_URL"), "requires a disposable MongoDB replica set")
class StockRegressionTests(unittest.TestCase):
    def test_stock_posting_and_catalogue_traversal(self):
        uri = os.environ["ERP_TEST_MONGO_URL"]
        self.assertIn(urlparse(uri).hostname, {"localhost", "127.0.0.1", "::1"})
        # Isolate env and Motor client from other tests that import core.
        import subprocess
        subprocess.run([sys.executable, __file__, "--fixture"], check=True, env={
            **os.environ, "MONGO_URL": uri, "DB_NAME": "erp_fix_stock_" + uuid4().hex,
            "PYTHON_DOTENV_DISABLED": "1", "JWT_SECRET": "test-only-stock-regressions",
        })


async def exercise():
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from fastapi import HTTPException
    from core import client, db
    from inventory import AdjustmentInput, adjust_stock, inventory_list
    from purchases import PurchaseInput, cancel_purchase, create_purchase
    from server import delete_product, list_products

    user = {"business_id": "test", "user_id": "operator", "permissions": {},
            "business": {"allow_negative_stock": False}}
    async def product(pid, stock=0, cost=10):
        await db.products.insert_one({"business_id": "test", "product_id": pid, "name": pid,
                                      "sku": pid, "stock_qty": stock, "product_cost": cost})

    async def receive(lines):
        data = PurchaseInput(supplier="Test supplier", items=[
            {"product_id": pid, "quantity": qty, "unit_cost": cost} for pid, qty, cost in lines])
        return await create_purchase(data, user)

    async def adjust(pid, qty):
        return await adjust_stock(AdjustmentInput(product_id=pid, quantity=qty, movement_type="ADJUSTMENT"), user)

    async def rejects(status, func, *args):
        try:
            await func(*args)
        except HTTPException as e:
            assert e.status_code == status, e
            return
        raise AssertionError(f"Expected {status} from {func.__name__}")

    try:
        await product("duplicate")
        receipt = await receive([("duplicate", 3, 20), ("duplicate", 3, 20)])
        await adjust("duplicate", -2)
        await rejects(400, cancel_purchase, receipt["purchase_id"], user)
        assert (await db.products.find_one({"product_id": "duplicate"}))["stock_qty"] == 4
        assert (await db.purchases.find_one({"purchase_id": receipt["purchase_id"]}))["status"] == "confirmed"

        await product("valuation")
        opening = await receive([("valuation", 10, 10)])
        receipt = await receive([("valuation", 4, 14), ("valuation", 6, 24)])
        before = await db.products.find_one({"product_id": "valuation"})
        assert (before["stock_qty"], before["product_cost"]) == (20, 15)
        await cancel_purchase(receipt["purchase_id"], user)
        after = await db.products.find_one({"product_id": "valuation"})
        assert (after["stock_qty"], after["product_cost"]) == (10, 10)
        history = await db.inventory_movements.find({"product_id": "valuation"}).to_list(None)
        assert sum(m["quantity"] for m in history) == after["stock_qty"]
        inventory = await db.accounts.find_one({"business_id": "test", "subgroup": "inventory"})
        entries = await db.journal_entries.find({"source_id": {"$in": [
            opening["purchase_id"], receipt["purchase_id"]
        ]}}).to_list(None)
        assert len(entries) == 3
        posted_value = sum(line["debit"] - line["credit"] for entry in entries for line in entry["lines"]
                           if line["account_id"] == inventory["account_id"])
        assert posted_value == after["stock_qty"] * after["product_cost"] == 100
        await rejects(400, cancel_purchase, receipt["purchase_id"], user)

        await product("race")
        await adjust("race", 1)
        await rejects(409, delete_product, "race", user)
        results = await asyncio.gather(*(adjust("race", -1) for _ in range(6)), return_exceptions=True)
        assert sum(isinstance(r, dict) for r in results) == 1, results
        assert sum(isinstance(r, HTTPException) and r.status_code == 400 for r in results) == 5, results
        assert (await db.products.find_one({"product_id": "race"}))["stock_qty"] == 0
        assert await db.inventory_movements.count_documents({"product_id": "race"}) == 2
        await rejects(409, delete_product, "race", user)
        await product("unused")
        assert await delete_product("unused", user) == {"ok": True}

        await db.products.insert_many([{"business_id": "test", "product_id": f"scale-{i:04}",
                                        "name": f"Test {i}", "sku": f"scale-{i:04}"} for i in range(2001)])
        await db.products.insert_one({"business_id": "foreign", "product_id": "foreign", "name": "scale-2000"})
        for listing in (list_products, inventory_list):
            all_rows = await listing(user)
            pages = [await listing(user, page, 500) for page in range(1, 6)]
            assert len(all_rows) == 2004
            assert [r["product_id"] for r in all_rows] == [r["product_id"] for batch in pages for r in batch]
            assert [r["product_id"] for r in await listing(user, 1, 100, "scale-2000")] == ["scale-2000"]
            await rejects(422, listing, user, 0, 100)

        for pid in ("current-basis", "historical-rounded"):
            await product(pid)
            first = await receive([(pid, 1, 1)])
            second = await receive([(pid, 1_000_000, 2)])
            if pid == "historical-rounded":
                # Model the actual pre-fix database state, including precision loss.
                await db.products.update_one({"product_id": pid},
                    {"$set": {"product_cost": 2.0}, "$unset": {"purchase_valuation": ""}})
            await cancel_purchase(second["purchase_id"], user)
            result = await db.products.find_one({"product_id": pid})
            assert (result["stock_qty"], result["product_cost"]) == (1, 1)
            journals = await db.journal_entries.find({"source_id": {"$in": [
                first["purchase_id"], second["purchase_id"]]}}).to_list(None)
            money = sum(line["debit"] - line["credit"] for j in journals for line in j["lines"]
                        if line["account_id"] == inventory["account_id"])
            assert money == 1
            rows = await list_products(user, search=pid)
            assert len(rows) == 1 and "purchase_valuation" not in rows[0]

        # Imported opening stock has no purchase records. A cosmetic edit
        # must preserve the precise basis recorded by the subsequent receipt.
        await product("imported-opening", stock=1, cost=1)
        big = await receive([("imported-opening", 1_000_000, 2)])
        await db.products.update_one({"product_id": "imported-opening"},
                                     {"$set": {"name": "Renamed", "updated_at": "later"}})
        await cancel_purchase(big["purchase_id"], user)
        renamed = await db.products.find_one({"product_id": "imported-opening"})
        assert (renamed["stock_qty"], renamed["product_cost"]) == (1, 1)

        # Ten units sold from two equal-cost receipts. Reversing one receipt
        # can legitimately bring both the quantity and carrying value to zero.
        from sales import SaleInput, create_sale_record
        await product("zero-after-sale")
        await receive([("zero-after-sale", 10, 10)])
        receipt = await receive([("zero-after-sale", 10, 10)])
        await create_sale_record("test", user, SaleInput(items=[
            {"product_id": "zero-after-sale", "quantity": 10, "unit_price": 20}]))
        await cancel_purchase(receipt["purchase_id"], user)
        ending = await db.products.find_one({"product_id": "zero-after-sale"})
        assert ending["stock_qty"] == 0 and ending["purchase_valuation"]["value"] == "0"
    finally:
        try:
            await client.drop_database(os.environ["DB_NAME"])
        finally:
            client.close()


if __name__ == "__main__":
    if sys.argv[1:] == ["--fixture"]:
        asyncio.run(exercise())
    else:
        unittest.main()
