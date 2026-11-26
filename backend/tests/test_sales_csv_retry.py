"""Multipart import retries, transaction rollback and financial readbacks on disposable Mongo."""
import asyncio
import os
import secrets
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlparse
from uuid import uuid4


@unittest.skipUnless(os.getenv("ERP_TEST_MONGO_URL"), "requires a disposable local Mongo replica set")
class SalesCsvRetryTests(unittest.TestCase):
    def test_atomic_import_and_conflicting_replays(self):
        uri = os.environ["ERP_TEST_MONGO_URL"]
        self.assertIn(urlparse(uri).hostname, {"127.0.0.1", "localhost", "::1"})
        subprocess.run([sys.executable, __file__, "--fixture"], check=True, env={
            **os.environ, "MONGO_URL": uri, "DB_NAME": "erp_csv_retry_" + uuid4().hex,
            "PYTHON_DOTENV_DISABLED": "1", "JWT_SECRET": secrets.token_hex(32),
            "ADMIN_EMAIL": "csv-admin@example.com", "ADMIN_PASSWORD": secrets.token_hex(16),
        })


async def exercise():
    import httpx
    from fastapi import HTTPException
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    import sales_import
    from core import client, db
    from server import app, startup

    try:
        await startup()
        async with httpx.AsyncClient(base_url="https://erp.test/api/",
                                     transport=httpx.ASGITransport(app=app)) as api:
            register = await api.post("auth/register", json={"name": "CSV Clerk", "email": "clerk@example.com",
                                                              "password": secrets.token_hex(16)})
            register.raise_for_status()
            scope = {"business_id": register.json()["business_id"]}
            product = await api.post("products", json={"name": "Tea", "sku": "T", "product_cost": 2, "selling_price": 5})
            product.raise_for_status()
            adjustment = await api.post("inventory/adjust", json={"product_id": product.json()["product_id"],
                                        "quantity": 100, "movement_type": "ADJUSTMENT"})
            adjustment.raise_for_status()
            header = "Invoice,SKU,Quantity,Unit price,Notes\n"

            async def upload(body, step="commit", expected=200):
                response = await api.post("sales/import/" + step,
                                          files={"file": ("invoices.csv", header + body, "text/csv")})
                assert response.status_code == expected, response.text
                return response.json()

            async def balances(sold):
                sale_count = await db.sales.count_documents(scope)
                stock = (await db.products.find_one(scope))["stock_qty"]
                journals = await db.journal_entries.find(scope).to_list(None)
                movements = await db.inventory_movements.count_documents({**scope, "movement_type": "SALE"})
                cash = sum(line["debit"] - line["credit"] for j in journals
                           for line in j["lines"] if line["code"] == "1100")
                assert (sale_count, stock, movements, len(journals), cash) == (
                    sold, 100 - sold, sold, sold, 5 * sold)

            one = "A,T,1,5,\n"
            # Different file bytes still refer to the same named invoice.
            results = await asyncio.gather(upload(one), upload(one + "\n"), upload(one), upload(one + "\r\n"))
            assert sum(row["invoices_created"] for row in results) == 1, results
            await balances(1)
            assert (await upload(one))["duplicate"] == 1
            conflict = "A,T,2,5,\n"
            assert (await upload(conflict, "preview"))["rows"][0]["reason"] == "existing_invoice_conflict"
            assert (await upload(conflict))["invalid"] == 1
            await balances(1)

            no_ref = ",T,1,5,\n"
            results = await asyncio.gather(*(upload(no_ref) for _ in range(4)))
            assert sum(row["invoices_created"] for row in results) == 1, results
            assert (await upload(no_ref, "preview"))["summary"]["duplicate"] == 1
            await balances(2)

            # The source and ledger for the first group are already in the
            # active transaction when the second group fails.
            two = "B,T,1,5,\nC,T,1,5,\n"
            create = sales_import.create_sale_record

            async def fail_second(*args, **kwargs):
                if kwargs["import_ref"] == "C":
                    assert await db.sales.find_one({**scope, "import_ref": "B"})
                    raise HTTPException(409, "Simulated second-invoice posting failure")
                return await create(*args, **kwargs)

            with patch.object(sales_import, "create_sale_record", fail_second):
                await upload(two, expected=409)
            await balances(2)
            assert not await db.sales.find_one({**scope, "import_ref": "B"})
            assert (await upload(two))["invoices_created"] == 2
            await balances(4)
    finally:
        await client.drop_database(os.environ["DB_NAME"])
        client.close()


if __name__ == "__main__":
    if sys.argv[1:] == ["--fixture"]:
        asyncio.run(exercise())
    else:
        unittest.main()
