"""Run with ERP_TEST_MONGO_URL set to a local disposable replica-set URI."""
import asyncio
import os
import subprocess
import sys
import unittest
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4


@unittest.skipUnless(os.getenv("ERP_TEST_MONGO_URL"), "requires a disposable MongoDB replica set")
class SupplierReturnTests(unittest.TestCase):
    def test_purchase_return_allocations(self):
        uri = os.environ["ERP_TEST_MONGO_URL"]
        self.assertIn(urlparse(uri).hostname, {"127.0.0.1", "localhost", "::1"})
        subprocess.run([sys.executable, __file__, "--fixture"], check=True,
                       env={**os.environ, "MONGO_URL": uri, "DB_NAME": "erp_supplier_qa_" + uuid4().hex,
                            "PYTHON_DOTENV_DISABLED": "1", "JWT_SECRET": "supplier-test-only"})


async def exercise():
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from fastapi import HTTPException
    from core import db, client
    from purchases import PurchaseInput, create_purchase
    from purchase_returns import create_purchase_return, cancel_purchase_return, PRInput
    from inventory import AdjustmentInput, adjust_stock

    bid, pid = "supplier-test", "same-id"
    user = {"business_id": bid, "user_id": "owner", "business": {"allow_negative_stock": False}}
    product_key = {"business_id": bid, "product_id": pid}

    async def expect_error(code, fn, *args):
        try:
            await fn(*args)
        except HTTPException as e:
            assert e.status_code == code, e
        else:
            raise AssertionError(f"Expected {code} from {fn.__name__}")

    async def receive(lines):
        return await create_purchase(PurchaseInput(supplier="Supplier", items=[
            {"product_id": pid, "quantity": q, "unit_cost": c} for q, c in lines]), user)

    async def refund(purchase, quantities):
        return await create_purchase_return(PRInput(purchase_id=purchase["purchase_id"], items=[
            {"product_id": pid, "quantity": q} for q in quantities]), user)

    async def counts(purchase):
        current = await db.purchases.find_one({"business_id": bid, "purchase_id": purchase["purchase_id"]})
        return [row.get("returned_qty", 0) for row in current["items"]]

    try:
        # Deliberate identifier collision between two isolated synthetic tenants.
        await db.products.insert_one({"business_id": "other", "product_id": pid, "name": "Foreign", "stock_qty": 90})
        await db.products.insert_one({**product_key, "name": "Own", "stock_qty": 0})
        receipt = await receive([(2, 5), (3, 10)])
        first = await refund(receipt, [1, 2])
        assert [(l["purchase_line_index"], l["quantity"], l["total"]) for l in first["items"]] == [(0, 2, 10), (1, 1, 10)]
        assert await counts(receipt) == [2, 1]
        await expect_error(400, refund, receipt, [1, 2])
        second = await refund(receipt, [1])
        assert await counts(receipt) == [2, 2]
        await cancel_purchase_return(first["return_id"], user)
        assert await counts(receipt) == [0, 1]
        current = await db.products.find_one(product_key)
        assert current["stock_qty"] == 4 and current["stock_qty"] * current["product_cost"] == 30
        account = await db.accounts.find_one({"business_id": bid, "subgroup": "inventory"})
        entries = await db.journal_entries.find({"business_id": bid}).to_list(None)
        posted = sum(line["debit"] - line["credit"] for e in entries for line in e["lines"]
                     if line["account_id"] == account["account_id"])
        assert posted == current["stock_qty"] * current["product_cost"] == 30
        await cancel_purchase_return(second["return_id"], user)
        assert await counts(receipt) == [0, 0]
        await expect_error(400, cancel_purchase_return, second["return_id"], user)
        assert (await db.products.find_one({"business_id": "other", "product_id": pid}))["stock_qty"] == 90

        await adjust_stock(AdjustmentInput(product_id=pid, quantity=-4, movement_type="ADJUSTMENT"), user)
        before = await db.inventory_movements.count_documents(product_key)
        await expect_error(400, refund, receipt, [2])
        assert await counts(receipt) == [0, 0]
        assert await db.inventory_movements.count_documents(product_key) == before

        user["business"]["allow_negative_stock"] = True
        allowed = await refund(receipt, [2])
        assert (await db.products.find_one(product_key))["stock_qty"] == -1
        await cancel_purchase_return(allowed["return_id"], user)
        assert (await db.products.find_one(product_key))["stock_qty"] == 1
        assert await counts(receipt) == [0, 0]
        user["business"]["allow_negative_stock"] = False

        # Historical records with one unambiguous source retain the exact partial quantity.
        older = await receive([(4, 8)])
        partial = await refund(older, [1.5])
        old_key = {"business_id": bid, "return_id": partial["return_id"]}
        await db.purchase_returns.update_one(old_key, {"$unset": {"items.0.purchase_line_index": ""}})
        await cancel_purchase_return(partial["return_id"], user)
        assert await counts(older) == [0]

        # Legacy duplicates with no source index cannot be safely voided or extended.
        ambiguous = await receive([(2, 8), (2, 8)])
        legacy = await refund(ambiguous, [1])
        await db.purchase_returns.update_one({"return_id": legacy["return_id"]}, {"$unset": {"items.0.purchase_line_index": ""}})
        stock = (await db.products.find_one(product_key))["stock_qty"]
        await expect_error(409, cancel_purchase_return, legacy["return_id"], user)
        await expect_error(409, refund, ambiguous, [1])
        assert (await db.products.find_one(product_key))["stock_qty"] == stock
        assert await counts(ambiguous) == [1, 0]

        # Simultaneous requests cannot both consume the final entitlement.
        raced = await receive([(1, 8)])
        results = await asyncio.gather(refund(raced, [1]), refund(raced, [1]), return_exceptions=True)
        assert sum(isinstance(r, dict) for r in results) == 1
        assert sum(isinstance(r, HTTPException) and r.status_code == 400 for r in results) == 1
        assert await counts(raced) == [1]

        # Reversing and reissuing a fractional return cannot create a rounding cent.
        tiny = await receive([(3, .01)])
        pennies = [await refund(tiny, [.5]) for _ in range(6)]
        assert round(sum(row["total_value"] for row in pennies), 2) == .03
        await cancel_purchase_return(pennies[1]["return_id"], user)
        replacement = await refund(tiny, [.5])
        assert round(sum(row["total_value"] for i, row in enumerate(pennies) if i != 1) + replacement["total_value"], 2) == .03

        # Foreign tenant requests cannot cancel an existing local return.
        other = {**user, "business_id": "other"}
        await expect_error(404, cancel_purchase_return, legacy["return_id"], other)
        await db.purchases.update_one({"business_id": bid, "purchase_id": older["purchase_id"]},
                                      {"$set": {"items.0.returned_qty": -1}})
        await expect_error(409, refund, older, [1])

        # A return and subsequent cancellation must preserve odd quantities above 2**53.
        huge_pid = "large-integral"
        huge_key = {"business_id": bid, "product_id": huge_pid}
        await db.products.insert_one({**huge_key, "name": "Large counted stock", "stock_qty": 0})
        huge = 2**53 + 2
        source = await create_purchase(PurchaseInput(supplier="Supplier", items=[
            {"product_id": huge_pid, "quantity": huge, "unit_cost": 0}]), user)
        async def large_return(quantity):
            return await create_purchase_return(PRInput(purchase_id=source["purchase_id"], items=[
                {"product_id": huge_pid, "quantity": quantity}]), user)

        posted = await large_return(1)
        stored = (await db.products.find_one(huge_key))["stock_qty"]
        assert isinstance(stored, int) and stored == huge - 1
        assert isinstance(posted["items"][0]["quantity"], int)
        movement = await db.inventory_movements.find_one({**huge_key, "reference_id": posted["return_id"]})
        assert isinstance(movement["quantity"], int) and movement["quantity"] == -1
        assert await counts(source) == [1] and isinstance((await counts(source))[0], int)
        await expect_error(422, large_return, ".5")
        assert (await db.products.find_one(huge_key))["stock_qty"] == huge - 1
        assert await counts(source) == [1]
        await cancel_purchase_return(posted["return_id"], user)
        assert (await db.products.find_one(huge_key))["stock_qty"] == huge
    finally:
        await client.drop_database(os.environ["DB_NAME"])
        client.close()


if __name__ == "__main__":
    if sys.argv[1:] == ["--fixture"]:
        asyncio.run(exercise())
    else:
        unittest.main()
