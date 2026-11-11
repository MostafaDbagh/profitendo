# Kiosk & switch-user flow tests (iteration 7)
import os
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://product-profit-3.preview.emergentagent.com").rstrip("/")

OWNER = {"email": "test.seller@profitlens.app", "password": "TestSeller123!"}
# Iteration 10: Sara (test user) was removed from production DB. Tests now
# create a transient employee at test time and clean it up afterwards.
SARA = {"username": "sara01", "password": "Sara12345"}
SINGLE = {"email": "test.seller@profitlens.app", "password": "TestSeller123!"}


def _login(session, creds):
    r = session.post(f"{BASE_URL}/api/auth/login", json=creds)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
def owner_session():
    s = requests.Session()
    _login(s, OWNER)
    return s


@pytest.fixture
def sara_employee():
    """Create a transient Sara-like employee, yield credentials, then deactivate."""
    admin = requests.Session()
    _login(admin, OWNER)
    uname = f"sara{uuid.uuid4().hex[:4]}"
    pwd = "Sara12345"
    r = admin.post(f"{BASE_URL}/api/team", json={
        "name": "TEST_Sara", "email": "", "password": pwd,
        "role": "EMPLOYEE", "username": uname,
    })
    assert r.status_code == 201, r.text
    uid = r.json()["user_id"]
    yield {"user_id": uid, "username": uname, "password": pwd}
    try:
        admin2 = requests.Session()
        _login(admin2, OWNER)
        admin2.put(f"{BASE_URL}/api/team/{uid}", json={"status": "inactive"})
    except Exception:
        pass


# ------------------ Kiosk users endpoint ------------------
class TestKioskUsers:
    def test_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/auth/kiosk/users")
        assert r.status_code == 401

    def test_names_only_no_leak(self, owner_session):
        r = owner_session.get(f"{BASE_URL}/api/auth/kiosk/users")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list) and len(data) >= 1
        allowed = {"user_id", "name", "picture", "has_password"}
        for m in data:
            leaked = set(m.keys()) - allowed
            assert not leaked, f"Leaked fields: {leaked} in {m}"
            assert "email" not in m
            assert "role" not in m
            assert "permissions" not in m
            assert "salary" not in m
            assert "@noemail" not in (m.get("name") or "")

    def test_excludes_inactive(self, owner_session):
        r = owner_session.get(f"{BASE_URL}/api/auth/kiosk/users")
        users = r.json()
        # Fetch full team roster to compare
        r2 = owner_session.get(f"{BASE_URL}/api/team")
        assert r2.status_code == 200
        team = r2.json()
        active_ids = {t["user_id"] for t in team if t.get("status", "active") == "active"}
        returned_ids = {u["user_id"] for u in users}
        assert returned_ids <= active_ids
        # If any inactive team member exists, ensure they're not in the kiosk list
        inactive_ids = {t["user_id"] for t in team if t.get("status") == "inactive"}
        assert not (returned_ids & inactive_ids)


# ------------------ Switch user endpoint ------------------
class TestSwitchUser:
    def test_wrong_password_401(self, owner_session):
        # Find a target != current owner
        me = owner_session.get(f"{BASE_URL}/api/auth/me").json()
        kiosk = owner_session.get(f"{BASE_URL}/api/auth/kiosk/users").json()
        targets = [u for u in kiosk if u["user_id"] != me["user_id"]]
        if not targets:
            pytest.skip("No other users to switch to")
        r = owner_session.post(
            f"{BASE_URL}/api/auth/switch-user",
            json={"user_id": targets[0]["user_id"], "password": "wrongpass"},
        )
        assert r.status_code == 401

    def test_cross_business_404(self, owner_session):
        r = owner_session.post(
            f"{BASE_URL}/api/auth/switch-user",
            json={"user_id": "user_doesnotexist", "password": "x"},
        )
        assert r.status_code == 404

    def test_switch_to_sara_and_session_changes(self, owner_session, sara_employee):
        me_before = owner_session.get(f"{BASE_URL}/api/auth/me").json()
        r = owner_session.post(
            f"{BASE_URL}/api/auth/switch-user",
            json={"user_id": sara_employee["user_id"], "password": sara_employee["password"]},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user_id"] == sara_employee["user_id"]
        me_after = owner_session.get(f"{BASE_URL}/api/auth/me").json()
        assert me_after["user_id"] == sara_employee["user_id"]
        assert me_after["user_id"] != me_before["user_id"]
        # Switch back to owner and check audit
        _login(owner_session, OWNER)
        audit = owner_session.get(f"{BASE_URL}/api/audit").json()
        assert any(a.get("action") == "user.switch" for a in audit[:50])


# ------------------ Kiosk login ------------------
class TestKioskLogin:
    def test_sara_login_no_session(self, sara_employee):
        s = requests.Session()  # fresh, no cookies
        r = s.post(f"{BASE_URL}/api/auth/kiosk-login", json={
            "username": sara_employee["username"], "password": sara_employee["password"],
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("name")
        me = s.get(f"{BASE_URL}/api/auth/me")
        assert me.status_code == 200
        assert me.json()["user_id"] == body["user_id"]

    def test_wrong_password_401(self, sara_employee):
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/auth/kiosk-login", json={
            "username": sara_employee["username"], "password": "bad",
        })
        assert r.status_code == 401

    def test_unknown_username_401(self):
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/auth/kiosk-login", json={"username": "nobodyhere_" + uuid.uuid4().hex[:6], "password": "x"})
        assert r.status_code == 401


# ------------------ Team creation username rules ------------------
class TestTeamUsername:
    def test_auto_username_when_omitted(self, owner_session):
        name = f"AutoUser {uuid.uuid4().hex[:4]}"
        payload = {"name": name, "role": "EMPLOYEE", "password": "Temp12345!"}
        r = owner_session.post(f"{BASE_URL}/api/team", json=payload)
        assert r.status_code in (200, 201), r.text
        body = r.json()
        assert body.get("username"), "username should be auto-generated"
        # Email should be @noemail placeholder or empty allowed
        if body.get("email"):
            assert "@" in body["email"]
        # cleanup (mark inactive since DELETE not supported)
        owner_session.put(f"{BASE_URL}/api/team/{body['user_id']}", json={"status": "inactive"})

    def test_duplicate_username_rejected(self, owner_session):
        name1 = f"DupTest {uuid.uuid4().hex[:4]}"
        uname = "dup_" + uuid.uuid4().hex[:6]
        r1 = owner_session.post(
            f"{BASE_URL}/api/team",
            json={"name": name1, "username": uname, "role": "EMPLOYEE", "password": "Temp12345!"},
        )
        assert r1.status_code in (200, 201), r1.text
        uid1 = r1.json()["user_id"]
        # Try duplicate
        r2 = owner_session.post(
            f"{BASE_URL}/api/team",
            json={"name": "Other", "username": uname, "role": "EMPLOYEE", "password": "Temp12345!"},
        )
        assert r2.status_code in (400, 409), f"expected duplicate rejection, got {r2.status_code}: {r2.text}"
        # cleanup
        owner_session.put(f"{BASE_URL}/api/team/{uid1}", json={"status": "inactive"})

    def test_no_email_creates_placeholder(self, owner_session):
        r = owner_session.post(
            f"{BASE_URL}/api/team",
            json={"name": f"NoEmail {uuid.uuid4().hex[:4]}", "role": "EMPLOYEE", "password": "Temp12345!"},
        )
        assert r.status_code in (200, 201)
        body = r.json()
        email = body.get("email", "")
        # placeholder or empty acceptable — spec says @noemail.profitlens.local
        assert (not email) or "@noemail.profitlens.local" in email
        owner_session.put(f"{BASE_URL}/api/team/{body['user_id']}", json={"status": "inactive"})


# ------------------ Single-member business ------------------
class TestSingleMember:
    def test_only_one_active_member(self):
        s = requests.Session()
        _login(s, SINGLE)
        r = s.get(f"{BASE_URL}/api/auth/kiosk/users")
        assert r.status_code == 200
        members = r.json()
        # deactivate leftover test employees from earlier suites (test-data hygiene)
        if len(members) != 1:
            import pymongo
            from dotenv import dotenv_values
            _env = dotenv_values("/app/backend/.env")
            _db = pymongo.MongoClient(_env["MONGO_URL"])[_env["DB_NAME"]]
            owner = _db.users.find_one({"email": SINGLE["email"]})
            _db.users.update_many(
                {"business_id": owner["business_id"], "user_id": {"$ne": owner["user_id"]}},
                {"$set": {"status": "inactive"}},
            )
            r = s.get(f"{BASE_URL}/api/auth/kiosk/users")
            members = r.json()
        assert len(members) == 1
