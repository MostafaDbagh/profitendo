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

        from inventory import list_movements
        from purchases import _stock_value
        from reports import get_report
        from server import dashboard, dashboard_drilldown
        perms = {"products.costs": True, "finance.profit": True, "finance.margin": True, "inventory.view": True}
        owner = {**user, "business_id": "negative-valued", "business": {"allow_negative_stock": True}, "permissions": perms}
        staff = {**owner, "permissions": {"inventory.view": True}}
        key = {"business_id": owner["business_id"], "product_id": "backordered"}
        await db.products.insert_one({**key, "name": "Backordered", "stock_qty": 0, "product_cost": 0})

        async def backorder_receipt(units, price):
            return await create_purchase(PurchaseInput(supplier="QA", items=[
                {"product_id": key["product_id"], "quantity": units, "unit_cost": price}]), owner)

        await backorder_receipt(10, 10)
        await create_sale_record(owner["business_id"], owner, SaleInput(items=[
            {"product_id": key["product_id"], "quantity": 20, "unit_price": 50}]))
        high_cost = await backorder_receipt(5, 100)
        assert (await inventory_list(owner))[0]["stock_value"] == 400
        assert (await get_report("inventory", None, None, None, owner))["inventory_value"] == 400
        assert (await dashboard(owner))["inventory_value"] == 400
        assert (await dashboard_drilldown("inventory_value", owner))["rows"][0]["value"] == 400
        assert "stock_value" not in (await inventory_list(staff))[0]
        restricted = await get_report("inventory", None, None, None, staff)
        assert "inventory_value" not in restricted and "unit_cost" not in restricted["rows"][0]
        await rejects(403, dashboard_drilldown, "inventory_value", staff)

        await cancel_purchase(high_cost["purchase_id"], owner)
        assert (await inventory_list(owner))[0]["stock_value"] == -100
        # Manually counting one additional unit updates the stored cost basis,
        # and a restricted operator can see only the counted quantity.
        changed = await adjust_stock(AdjustmentInput(product_id=key["product_id"], quantity=1,
                                                     movement_type="ADJUSTMENT"), staff)
        assert "carrying_value_delta" not in changed and changed["new_stock"] == -9
        assert all("carrying_value_delta" not in m for m in await list_movements(user=staff))
        assert (await inventory_list(owner))[0]["stock_value"] == -90
        doc = await db.products.find_one(key)
        assert await _stock_value(key["business_id"], doc) == -90

        count = await db.purchases.count_documents({"business_id": owner["business_id"]})
        await rejects(422, backorder_receipt, 10, 1e308)
        assert await db.purchases.count_documents({"business_id": owner["business_id"]}) == count
        assert (await db.products.find_one(key))["stock_qty"] == -9

        # Cost metadata in the report follows the same visibility policy as the return API.
        for status, restock in (("confirmed", True), ("confirmed", False), ("cancelled", True)):
            await db.returns.insert_one({"business_id": owner["business_id"], "status": status, "restock": restock,
                "refund_total": 1, "cogs_reversed": 2, "items": [
                    {"unit_cost": 2, "cogs": 2, "sale_ranges": [[0, 1]], "quantity": 1}]})
        sales_report = await get_report("sales", None, None, None, {**staff, "permissions": {"sales.view": True}})
        assert "cost_allocations" not in sales_report["rows"][0]
        report_staff = {**staff, "permissions": {"returns.view": True}}
        returned = await get_report("returns", None, None, None, report_staff)
        assert all("cogs_reversed" not in row and set(row["items"][0]) == {"quantity"} for row in returned["rows"])
        from unittest.mock import AsyncMock, patch
        with patch("reports.get_status", AsyncMock(return_value={"assistant_access": True})):
            profit = await get_report("profit", None, None, None,
                                      {**owner, "permissions": {**perms, "finance.reports": True}})
        assert profit["refunds"] == 2 and profit["cogs"] == 198
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
