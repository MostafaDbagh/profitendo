"""Spec (quantity + unit) feature regression tests for ProfitLens."""
import os
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
EMAIL = "test.seller@profitlens.app"
PASSWORD = __import__("os").environ.get("LEGACY_TEST_ADMIN_PASSWORD", "local-test-only-change-me")
@pytest.fixture(scope="module")
def auth_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=15)
    assert r.status_code == 200, f"Login failed {r.status_code}: {r.text}"
    data = r.json()
    token = data.get("access_token") or data.get("token")
    if token:
        s.headers.update({"Authorization": f"Bearer {token}"})
    return s


def _create_product(s, **spec):
    payload = {"name": "TEST_spec_" + os.urandom(3).hex(), "product_cost": 1.0, **spec}
    r = s.post(f"{BASE_URL}/api/products", json=payload, timeout=15)
    return r


def _delete(s, pid):
    try:
        s.delete(f"{BASE_URL}/api/products/{pid}", timeout=10)
    except Exception:
        pass


class TestSpecFeature:
    def test_create_with_spec_persists_and_stock_zero(self, auth_session):
        r = _create_product(auth_session, spec_quantity=500, spec_unit="milliliter")
        assert r.status_code in (200, 201), r.text
        p = r.json()
        pid = p["product_id"]
        try:
            assert p["spec_quantity"] == 500
            assert p["spec_unit"] == "milliliter"
            assert p.get("stock_qty", 0) == 0
            # GET to verify persistence
            g = auth_session.get(f"{BASE_URL}/api/products/{pid}", timeout=10).json()
            assert g["spec_quantity"] == 500
            assert g["spec_unit"] == "milliliter"
            assert g.get("stock_qty", 0) == 0
        finally:
            _delete(auth_session, pid)

    def test_create_with_custom_unit_arabic(self, auth_session):
        r = _create_product(auth_session, spec_quantity=2, spec_unit="صفيحة")
        assert r.status_code in (200, 201)
        p = r.json()
        pid = p["product_id"]
        try:
            assert p["spec_unit"] == "صفيحة"
            assert p["spec_quantity"] == 2
        finally:
            _delete(auth_session, pid)

    def test_negative_quantity_rejected(self, auth_session):
        r = _create_product(auth_session, spec_quantity=-5, spec_unit="piece")
        assert r.status_code == 422

    def test_unit_over_30_chars_rejected(self, auth_session):
        r = _create_product(auth_session, spec_quantity=1, spec_unit="x" * 31)
        assert r.status_code == 422

    def test_spec_never_affects_stock_on_edit(self, auth_session):
        # Create product with initial spec
        r = _create_product(auth_session, spec_quantity=100, spec_unit="gram")
        assert r.status_code in (200, 201)
        p = r.json()
        pid = p["product_id"]
        try:
            initial_stock = p.get("stock_qty", 0)
            assert initial_stock == 0
            # Update spec
            up = auth_session.put(f"{BASE_URL}/api/products/{pid}",
                                  json={"name": p["name"], "product_cost": 1.0,
                                        "spec_quantity": 999, "spec_unit": "kilogram"}, timeout=15)
            assert up.status_code in (200, 204), up.text
            g = auth_session.get(f"{BASE_URL}/api/products/{pid}", timeout=10).json()
            assert g["spec_quantity"] == 999
            assert g["spec_unit"] == "kilogram"
            assert g.get("stock_qty", 0) == initial_stock  # unchanged
        finally:
            _delete(auth_session, pid)

    def test_no_spec_optional(self, auth_session):
        r = _create_product(auth_session)
        assert r.status_code in (200, 201)
        p = r.json()
        pid = p["product_id"]
        try:
            assert p.get("spec_quantity") in (None, 0, "")
            assert p.get("spec_unit") in (None, "")
        finally:
            _delete(auth_session, pid)

    def test_empty_string_unit_normalized_to_none(self, auth_session):
        r = _create_product(auth_session, spec_quantity=5, spec_unit="   ")
        assert r.status_code in (200, 201)
        p = r.json()
        pid = p["product_id"]
        try:
            assert p.get("spec_unit") in (None, "")
        finally:
            _delete(auth_session, pid)
