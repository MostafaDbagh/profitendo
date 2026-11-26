"""Inventory adjustment HTTP and database checks on a disposable loopback replica set."""
import asyncio
import os
import subprocess
import sys
import unittest
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4


@unittest.skipUnless(os.getenv("ERP_TEST_MONGO_URL"), "requires a disposable local MongoDB replica set")
class InventoryQuantityTests(unittest.TestCase):
    def test_bounds_and_concurrent_adjustments(self):
        uri = os.environ["ERP_TEST_MONGO_URL"]
        self.assertIn(urlparse(uri).hostname, {"localhost", "127.0.0.1", "::1"})
        subprocess.run([sys.executable, __file__, "--fixture"], check=True, env={
            **os.environ, "MONGO_URL": uri, "DB_NAME": "erp_inventory_bounds_" + uuid4().hex,
            "PYTHON_DOTENV_DISABLED": "1", "JWT_SECRET": "local-test-inventory-bounds",
        })


async def exercise():
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    import httpx
    from fastapi import FastAPI
    from core import client, db, get_current_user
    from inventory import router
    import purchases, returns, sales
    from numeric_inputs import bounded_stock
    from fastapi import HTTPException

    app = FastAPI()
    for routes in (router, purchases.router, returns.router, sales.router):
        app.include_router(routes)
    user = {"business_id": "bounds", "user_id": "auditor", "role": "OWNER",
            "permissions": {key: True for key in ("inventory.adjust", "sales.create", "sales.cancel",
                "purchases.create", "returns.create", "returns.cancel")}, "business": {"allow_negative_stock": False}}
    app.dependency_overrides[get_current_user] = lambda: user
    low, high = -(2**63), 2**63 - 1
    query = {"business_id": "bounds", "product_id": "sample"}

    async def verify_state(quantity, movement_count):
        product = await db.products.find_one(query)
        history = await db.inventory_movements.find(query).to_list(None)
        assert product["stock_qty"] == quantity
        assert len(history) == movement_count
        assert sum(row["quantity"] for row in history) == quantity

    try:
        await db.products.insert_one({**query, "name": "Boundary fixture", "stock_qty": 0})
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as api:
            async def adjust(quantity, movement_type="ADJUSTMENT"):
                return await api.post("/api/inventory/adjust", json={
                    "product_id": "sample", "quantity": quantity, "movement_type": movement_type,
                })

            for invalid in (low - 1, high + 1, 10**25, True):
                res = await adjust(invalid)
                assert res.status_code == 422, res.text
                assert res.json()["detail"][0]["loc"][-1] == "quantity"
            res = await api.post("/api/inventory/adjust", headers={"content-type": "application/json"},
                                 content='{"product_id":"sample","quantity":1e999,"movement_type":"ADJUSTMENT"}')
            assert res.status_code == 422
            await verify_state(0, 0)
            assert (await adjust(low)).status_code == 400
            assert (await adjust(high - 1)).status_code == 201
            races = await asyncio.gather(adjust(1), adjust(1))
            assert sorted(r.status_code for r in races) == [201, 422]
            await verify_state(high, 2)
            user["business"]["allow_negative_stock"] = True
            assert (await adjust(low, "DAMAGE")).json()["new_stock"] == -1
            assert (await adjust(-high)).json()["new_stock"] == low
            assert (await adjust(-1)).status_code == 422
            await verify_state(low, 4)

            for tiny in ("1e-999999999", "-1e-999999999"):
                try:
                    bounded_stock(0, tiny)
                except HTTPException as exc:
                    assert exc.status_code == 422
                else:
                    raise AssertionError("Unrepresentable fractional input passed")
            assert bounded_stock("0e-999999999", 0) == 0
            assert bounded_stock(0.1, 1) == 1.1

            async def seed(stock, sold=0):
                await db.products.update_one(query, {"$set": {"stock_qty": stock, "quantity_sold": sold}})

            async def balances():
                product = await db.products.find_one(query)
                counts = [await db[name].count_documents({"business_id": "bounds"}) for name in (
                    "sales", "purchases", "returns", "inventory_movements", "journal_entries")]
                return product["stock_qty"], product["quantity_sold"], counts

            line = {"product_id": "sample", "quantity": 1}
            sale = {"items": [{**line, "unit_price": 0}]}
            receipt = {"supplier": "Test", "items": [{**line, "unit_cost": 0}]}
            refund = {"reason": "other", "items": [{**line, "unit_price": 0}]}
            for route, body, stock, sold in (
                ("sales", sale, low, 0),
                ("sales", sale, 1, high),
                ("purchases", receipt, high, 0),
                ("returns", refund, high, 0),
            ):
                await seed(stock, sold)
                before = await balances()
                res = await api.post("/api/" + route, json=body)
                assert res.status_code == 422, (route, res.text)
                assert await balances() == before
                huge = {**body, "items": [{**body["items"][0], "quantity": high + 1}]}
                assert (await api.post("/api/" + route, json=huge)).status_code == 422
                assert await balances() == before

            await seed(0.25)
            assert (await adjust(high)).status_code == 422
            assert (await adjust(2**53)).status_code == 422
            res = await api.post("/api/purchases", json=receipt)
            assert res.status_code == 201, res.text
            assert (await balances())[0] == 1.25
            res = await api.post("/api/sales", json=sale)
            assert res.status_code == 201, res.text
            sid = res.json()["sale_id"]
            assert (await balances())[0] == 0.25
            await seed(high, 1)
            before = await balances()
            res = await api.post(f"/api/sales/{sid}/cancel")
            assert res.status_code == 422 and await balances() == before
            assert (await db.sales.find_one({"sale_id": sid}))["status"] == "confirmed"

            await seed(high - 1)
            outcomes = await asyncio.gather(api.post("/api/returns", json=refund),
                                            api.post("/api/purchases", json=receipt))
            assert sorted(r.status_code for r in outcomes) == [201, 422], [r.text for r in outcomes]
            assert (await balances())[0] == high
    finally:
        await client.drop_database(os.environ["DB_NAME"])
        client.close()


if __name__ == "__main__":
    if sys.argv[1:] == ["--fixture"]:
        asyncio.run(exercise())
    else:
        unittest.main()
