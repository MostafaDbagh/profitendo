"""CSV invoice validation and whole-invoice posting against a disposable Mongo replica set."""
import asyncio
import csv
import io
import os
import secrets
import subprocess
import sys
import unittest
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4


@unittest.skipUnless(os.getenv("ERP_TEST_MONGO_URL"), "requires a disposable local MongoDB replica set")
class SalesImportValidationTests(unittest.TestCase):
    def test_invoice_integrity(self):
        uri = os.environ["ERP_TEST_MONGO_URL"]
        self.assertIn(urlparse(uri).hostname, {"localhost", "127.0.0.1", "::1"})
        subprocess.run([sys.executable, __file__, "--fixture"], check=True, env={
            **os.environ, "MONGO_URL": uri, "DB_NAME": "erp_csv_validation_" + uuid4().hex,
            "ADMIN_EMAIL": "admin@example.com", "ADMIN_PASSWORD": secrets.token_urlsafe(18),
            "PYTHON_DOTENV_DISABLED": "1", "JWT_SECRET": secrets.token_hex(32),
        })


async def run():
    import httpx
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from core import client, db
    from server import app, startup
    try:
        await startup()
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://erp.test/api/") as api:
            owner = (await api.post("auth/register", json={"name": "Import Test", "email": "test@example.com",
                                                           "password": secrets.token_hex(16)})).raise_for_status().json()
            scope = {"business_id": owner["business_id"]}
            products = [("K", "Upper", "upper"), ("k", "Lower", "lower"), ("ONE", "Coffee", "one"),
                        ("TWO", "coffee", "two"), ("Tea", "Tea", "tea"), ("TEA", "Another", "another")]
            for sku, name, pid in products:
                await db.products.insert_one({**scope, "product_id": pid, "name": name, "sku": sku,
                                              "stock_qty": 20, "selling_price": 5, "product_cost": 0})

            async def upload(rows, action="preview"):
                text = io.StringIO()
                writer = csv.writer(text)
                writer.writerow(["Invoice", "SKU", "Quantity", "Unit price", "Date", "Customer", "Payment", "Notes"])
                writer.writerows(rows)
                response = await api.post("sales/import/" + action, files={
                    "file": ("sales.csv", text.getvalue().encode(), "text/csv")})
                return response.raise_for_status().json()

            # A blank-heavy file remains within the logical record cap.
            file = b"Name,SKU\nTop,TOP\n" + b"\n" * 2000 + b"Bottom,BOTTOM\n"
            product_response = await api.post("products/import/commit", files={"file": ("blank.csv", file, "text/csv")})
            assert product_response.raise_for_status().json()["new"] == 2
            assert await db.products.count_documents({**scope, "sku": {"$in": ["TOP", "BOTTOM"]}}) == 2
            blank_sales = [["HEAD", "K", 1, 2], *([[]] * 2000), ["TAIL", "k", 1, 3]]
            assert (await upload(blank_sales))["summary"]["new"] == 2

            a = ["CASE", "K", 2, 5, "31/12/2020", "Customer", "Credit", "Note"]
            invalid = ["case", "missing", 1, 3]
            partial = [a, invalid]
            assert [r["reason"] for r in (await upload(partial))["rows"]] == ["invoice_invalid", "product_not_found"]
            assert (await upload(partial, "commit"))["invoices_created"] == 0
            assert await db.sales.count_documents(scope) == await db.inventory_movements.count_documents(scope) == 0
            assert await db.journal_entries.count_documents(scope) == 0
            fixed = [a, ["case", "k", 1, 3, "12/31/2020"]]
            assert (await upload(fixed, "commit"))["invoices_created"] == 1
            sale = await db.sales.find_one(scope)
            assert (sale["date"], sale["customer"], sale["payment_method"], sale["total"]) == ("2020-12-31", "Customer", "credit", 13)
            assert [i["product_id"] for i in sale["items"]] == ["upper", "lower"]
            assert {s["import_ref"] for s in (await api.get("reports/sales", params={
                "date_from": "2020-12-31", "date_to": "2020-12-31"})).raise_for_status().json()["rows"]} == {"CASE"}
            invalid_fields = [
                (["M", "TeA", 1, 5], "ambiguous_product"), (["M", "coffee", 1, 5], "ambiguous_product"),
                (["M", "k", 1, 5, "", "", "unknown"], "invalid_payment_method"),
                (["X"*65, "k", 1, 5], "field_too_long"), (["M", "k", 2, "1e308"], "invalid_price"),
                (["M", "k", 1, 5, "", "C"*121], "field_too_long"),
                (["M", "k", 1, 5, "", "", "", "N"*201], "field_too_long"),
            ]
            for bad_date in ("2026-02-31", "2023-02-29", "01/02/2024", "bad"):
                invalid_fields.append((["M", "k", 1, 5, bad_date], "invalid_date"))
            for row, reason in invalid_fields:
                record = (await upload([row]))["rows"][0]
                assert record["reason"] == reason, record
            for index, first, second in ((4, "2024-02-29", "2024-03-01"), (5, "A", "B"),
                                         (6, "cash", "card"), (7, "one", "two")):
                rows = [["X", "K", 1, 5, "", "", "", ""] for _ in range(2)]
                rows[0][index], rows[1][index] = first, second
                assert [r["reason"] for r in (await upload(rows))["rows"]] == ["invoice_conflict"] * 2
            # Skip an entire oversized invoice and keep the unused stock for the following valid invoice.
            pending = [["X", "K", 10, 1], ["X", "K", 9, 1], ["Y", "K", 18, 1], ["Z", "K", 1, 1]]
            assert [r["reason"] for r in (await upload(pending))["rows"]] == [
                "insufficient_stock", "insufficient_stock", None, "insufficient_stock"]
            assert (await upload(pending, "commit"))["invoices_created"] == 1
            assert (await db.products.find_one({**scope, "product_id": "upper"}))["stock_qty"] == 0
            assert await db.sales.count_documents(scope) == 2
            # Historical invoices keep their original stored date format.
            await db.sales.update_one({**scope, "import_ref": "CASE"}, {"$set": {"date": "31/12/2020"}})
            annual = await api.get("reports/sales", params={"date_from": "2020-01-01", "date_to": "2020-12-31"})
            assert annual.raise_for_status().json()["revenue"] == 13
    finally:
        await client.drop_database(os.environ["DB_NAME"])
        client.close()


if __name__ == "__main__":
    if sys.argv[1:] == ["--fixture"]:
        assert os.environ["DB_NAME"].startswith("erp_csv_validation_")
        assert urlparse(os.environ["MONGO_URL"]).hostname in {"localhost", "127.0.0.1", "::1"}
        asyncio.run(run())
    else:
        unittest.main()
