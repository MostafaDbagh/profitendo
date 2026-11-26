"""Product and import numeric validation on a disposable local replica set."""
import asyncio
import os
import subprocess
import sys
import unittest
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4


@unittest.skipUnless(os.getenv("ERP_TEST_MONGO_URL"), "requires a disposable local MongoDB replica set")
class ProductImportNumericTests(unittest.TestCase):
    def test_http_validation_and_storage(self):
        uri = os.environ["ERP_TEST_MONGO_URL"]
        self.assertIn(urlparse(uri).hostname, {"localhost", "127.0.0.1", "::1"})
        subprocess.run([sys.executable, __file__, "--fixture"], check=True, env={
            **os.environ, "MONGO_URL": uri, "DB_NAME": "erp_product_inputs_" + uuid4().hex,
            "PYTHON_DOTENV_DISABLED": "1", "JWT_SECRET": "synthetic-test-key",
        })


async def exercise():
    import httpx
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from core import db, client
    from server import app

    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://erp.test/api") as api:
            register = await api.post("auth/register", json={"name": "QA numeric", "email": "qa-numeric@example.com",
                                                             "password": uuid4().hex})
            register.raise_for_status()
            tenant = {"business_id": register.json()["business_id"]}

            async def upload(path, csv):
                r = await api.post(path, files={"file": ("numbers.csv", csv, "text/csv")})
                r.raise_for_status()
                return r.json()

            for field in ("product_cost", "selling_price", "spec_quantity", "minimum_stock_level"):
                for value in ("-0.01", "-1e-500", "1e999"):
                    body = '{"name":"invalid","product_cost":0,"%s":%s}' % (field, value)
                    r = await api.post("products", content=body, headers={"Content-Type": "application/json"})
                    assert r.status_code == 422, (field, value, r.text)
            assert await db.products.count_documents(tenant) == 0

            csv = ("Product name,SKU,Purchase price,Selling price,Initial quantity\n"
                   "Positive,good,3,7.25,0\nNegative sale,bad1,3,-1,0\n"
                   "Negative cost,bad2,-1e-500,0,1\nNegative stock,bad3,0,0,-1e-500\n"
                   "Overflow money,bad4,0,1e999,1\nOverflow stock,bad5,0,1,9223372036854775808\n")
            preview = await upload("products/import/preview", csv)
            assert preview["suggested_mapping"]["selling_price"] == "Selling price"
            assert [r["reason"] for r in preview["rows"]] == [
                None, "invalid_price", "invalid_price", "invalid_quantity", "invalid_price", "invalid_quantity"]
            result = await upload("products/import/commit", csv)
            assert (result["new"], result["invalid"]) == (1, 5)
            saved = await db.products.find_one(tenant)
            assert (saved["product_cost"], saved["selling_price"], saved["stock_qty"]) == (3, 7.25, 0)
            r = await api.put("products/"+saved["product_id"], json={"name": "edited", "product_cost": "-1e-500"})
            assert r.status_code == 422

            sales = "SKU,Quantity,Unit price\ngood,1,7\ngood,1.00001,7\ngood,1,-1e-500\n"
            strict = await upload("sales/import/preview", sales)
            assert [r["reason"] for r in strict["rows"]] == ["insufficient_stock", "invalid_quantity", "invalid_price"]
            await db.businesses.update_one(tenant, {"$set": {"allow_negative_stock": True}})
            allowed = await upload("sales/import/preview", sales)
            assert [r["status"] for r in allowed["rows"]] == ["new", "invalid", "invalid"]
            committed = await upload("sales/import/commit", sales)
            assert committed["invoices_created"] == 1 and committed["invalid"] == 2
            assert (await db.products.find_one(tenant))["stock_qty"] == -1

            purchases = "Supplier,SKU,Quantity,Unit cost\nQA,good,1,-1e-500\nQA,good,1.00001,3\n"
            preview = await upload("purchases/import/preview", purchases)
            assert [r["reason"] for r in preview["rows"]] == ["invalid_price", "invalid_quantity"]
            await upload("purchases/import/commit", purchases)
            assert await db.purchases.count_documents(tenant) == 0
    finally:
        await client.drop_database(os.environ["DB_NAME"])
        client.close()


if __name__ == "__main__":
    if sys.argv[1:] == ["--fixture"]:
        assert os.environ["DB_NAME"].startswith("erp_product_inputs_")
        assert urlparse(os.environ["MONGO_URL"]).hostname in {"localhost", "127.0.0.1", "::1"}
        asyncio.run(exercise())
    else:
        unittest.main(verbosity=2)
