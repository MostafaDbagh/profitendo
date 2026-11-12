import unittest
from backend.cutover import allow_legacy_request


class CutoverTests(unittest.TestCase):
    def test_freeze_blocks_operational_writes_and_imports(self):
        for method in ("POST", "PATCH", "PUT", "DELETE"):
            for path in ("/api/products", "/api/sales", "/api/backup/import", "/api/auth/register"):
                self.assertFalse(allow_legacy_request(method, path, True))

    def test_history_and_existing_session_access_remain_available(self):
        self.assertTrue(allow_legacy_request("GET", "/api/sales", True))
        self.assertTrue(allow_legacy_request("GET", "/api/backup/export", True))
        self.assertTrue(allow_legacy_request("POST", "/api/auth/login", True))
        self.assertFalse(allow_legacy_request("DELETE", "/api/auth/login", True))
        self.assertTrue(allow_legacy_request("POST", "/api/sales", False))


if __name__ == "__main__":
    unittest.main()
