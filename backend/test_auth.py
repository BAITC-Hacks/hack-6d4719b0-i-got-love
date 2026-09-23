"""Registration, owned profiles, session lifecycle and credential safeguards."""

import hashlib
import os
import sqlite3
import tempfile
import time
import unittest
from collections import OrderedDict
from contextlib import closing
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend import auth
from backend.db import connect, init_db
from backend.integration import app
from backend.seed import seed_demo


class AuthTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.environment = patch.dict(os.environ, {"APP_DB_PATH": f"{self.directory.name}/auth.db"})
        self.environment.start()
        os.environ.pop("TASK_BUILDER_DB_PATH", None)
        self.rates = patch("backend.auth._rate_buckets", OrderedDict())
        self.rates.start()
        self.client = TestClient(app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.rates.stop()
        self.environment.stop()
        self.directory.cleanup()

    def signup(self, role="business", email="person@example.test", **extra):
        return self.client.post("/api/auth/register", json={
            "name": "Участник", "email": email, "password": "Test-password-2026!", "role": role, **extra,
        })

    def test_passwords_and_session_tokens_are_never_stored_plain(self):
        response = self.signup()
        self.assertEqual(response.status_code, 201)
        user = response.json()["user"]
        self.assertEqual(user["role"], "business")
        self.assertIsNone(user["team_id"])
        cookie = response.headers["set-cookie"]
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=lax", cookie)
        self.assertIn("Max-Age=28800", cookie)
        self.assertIn("Path=/", cookie)
        self.assertNotIn("Secure;", cookie)
        raw_token = self.client.cookies.get(auth.COOKIE_NAME)
        with closing(connect()) as connection:
            stored = connection.execute("SELECT * FROM users").fetchone()
            session = connection.execute("SELECT * FROM sessions").fetchone()
        self.assertNotEqual(stored["password_hash"], "Test-password-2026!")
        self.assertEqual(len(bytes.fromhex(stored["salt"])), 32)
        self.assertEqual(session["token_hash"], hashlib.sha256(raw_token.encode()).hexdigest())
        self.assertNotIn("password", response.text)
        self.assertEqual(self.client.get("/api/auth/me").json()["user"], user)
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_equal_passwords_use_distinct_salts_and_hashes(self):
        self.assertEqual(self.signup().status_code, 201)
        self.assertEqual(self.signup(email="other@example.test").status_code, 201)
        with closing(connect()) as connection:
            rows = connection.execute("SELECT salt, password_hash FROM users").fetchall()
        self.assertNotEqual(rows[0]["salt"], rows[1]["salt"])
        self.assertNotEqual(rows[0]["password_hash"], rows[1]["password_hash"])

    def test_login_rotates_old_session_and_logout_revokes_new_one(self):
        self.signup()
        old_token = self.client.cookies.get(auth.COOKIE_NAME)
        response = self.client.post("/api/auth/login", json={"email": "PERSON@EXAMPLE.TEST", "password": "Test-password-2026!"})
        self.assertEqual(response.status_code, 200)
        new_token = self.client.cookies.get(auth.COOKIE_NAME)
        self.assertNotEqual(new_token, old_token)
        self.assertIsNone(self.client.get("/api/auth/me", headers={"Cookie": f"{auth.COOKIE_NAME}={old_token}"}).json()["user"])
        self.assertEqual(self.client.post("/api/auth/logout").json(), {"user": None})
        self.assertIsNone(self.client.get("/api/auth/me", headers={"Cookie": f"{auth.COOKIE_NAME}={new_token}"}).json()["user"])

    def test_expired_session_and_anonymous_profile_are_denied(self):
        self.assertIsNone(self.client.get("/api/auth/me").json()["user"])
        self.assertEqual(self.client.patch("/api/auth/profile", json={"name": "Новый"}).status_code, 401)
        self.signup()
        with closing(connect()) as connection, connection:
            connection.execute("UPDATE sessions SET expires_at = ?", (int(time.time()) - 1,))
        self.assertIsNone(self.client.get("/api/auth/me").json()["user"])
        self.assertEqual(self.client.patch("/api/auth/profile", json={"available": False}).status_code, 401)
        self.client.post("/api/auth/login", json={"email": "person@example.test", "password": "Test-password-2026!"})
        with closing(connect()) as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM sessions").fetchone()[0], 1)

    def test_https_cookie_is_secure_and_forwarded_header_alone_cannot_spoof_scheme(self):
        response = self.client.post("https://demo.example/api/auth/register", json={
            "name": "Профиль", "email": "secure@example.test", "password": "Test-password-2026!", "role": "business",
        })
        self.assertIn("Secure", response.headers["set-cookie"])
        response = self.client.post("/api/auth/login", json={"email": "secure@example.test", "password": "Test-password-2026!"},
                                    headers={"X-Forwarded-Proto": "https"})
        self.assertNotIn("Secure", response.headers["set-cookie"])

    def test_profile_updates_only_owned_team_and_never_role_or_other_ids(self):
        seed_demo()
        response = self.signup(role="team", team_name="Моя команда")
        user = response.json()["user"]
        self.assertEqual(user["team_name"], "Моя команда")
        response = self.client.patch("/api/auth/profile", json={
            "name": "Новое имя", "available": False, "team_name": "Наша команда", "interests": ["Образование"],
            "skills": [" React ", "React", "Дизайн"], "technologies": ["TypeScript"],
        })
        self.assertEqual(response.status_code, 200)
        current = response.json()["user"]
        self.assertFalse(current["available"])
        self.assertEqual(current["skills"], ["React", "Дизайн"])
        self.assertEqual(current["team_name"], "Наша команда")
        for payload in ({"role": "business"}, {"team_id": 999}, {"owner_user_id": 999}, {"skills": ["x"] * 13}, {"skills": [" "]}, {"name": None}):
            self.assertEqual(self.client.patch("/api/auth/profile", json=payload).status_code, 422)
        with closing(connect()) as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM tasks WHERE owner_user_id IS NOT NULL").fetchone()[0], 0)
            self.assertEqual(connection.execute("SELECT owner_user_id FROM teams WHERE id = ?", (user["team_id"],)).fetchone()[0], user["id"])

    def test_business_cannot_patch_team_profile(self):
        self.signup()
        self.assertEqual(self.client.patch("/api/auth/profile", json={"skills": ["Python"]}).status_code, 403)
        response = self.client.patch("/api/auth/profile", json={"name": "Новое имя", "available": False})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["user"]["available"])

    def test_bad_login_is_generic_and_duplicate_email_is_case_insensitive(self):
        self.signup()
        responses = [self.client.post("/api/auth/login", json={"email": email, "password": "Wrong-password-2026!"})
                     for email in ("person@example.test", "missing@example.test")]
        self.assertEqual([response.status_code for response in responses], [401, 401])
        self.assertEqual(responses[0].json(), responses[1].json())
        self.assertEqual(self.signup(email="PERSON@EXAMPLE.TEST").status_code, 409)

    def test_validation_never_echoes_passwords(self):
        secret = "Do-not-echo-this-password!"
        response = self.client.post("/api/auth/register", json={"password": secret, "role": "business"})
        self.assertEqual(response.status_code, 422)
        self.assertNotIn(secret, response.text)
        for password in ("short", "x" * 129):
            response = self.signup(password=password)
            self.assertEqual(response.status_code, 422)
            self.assertNotIn(password, response.text)
        self.assertEqual(self.signup(email="not-email").status_code, 422)

    def test_login_and_registration_rate_limits_and_hash_concurrency(self):
        with patch("backend.auth._derive_password", return_value="0" * 128):
            for _ in range(10):
                self.assertEqual(self.client.post("/api/auth/login", json={"email": "missing@example.test", "password": "Wrong-password-2026!"}).status_code, 401)
            self.assertEqual(self.client.post("/api/auth/login", json={"email": "missing@example.test", "password": "Wrong-password-2026!"}).status_code, 429)
        self.client.post("/api/auth/register", json={"name": "User", "email": "bad", "password": "Too-short", "role": "business"})
        for _ in range(19):
            self.assertEqual(self.signup(email="bad").status_code, 422)
        self.assertEqual(self.signup().status_code, 429)
        auth._password_slots.acquire()
        auth._password_slots.acquire()
        try:
            with self.assertRaises(Exception) as raised:
                auth._derive_password("Test-password-2026!", b"x" * 32)
            self.assertEqual(raised.exception.status_code, 429)
        finally:
            auth._password_slots.release()
            auth._password_slots.release()


class AuthMigrationTests(unittest.TestCase):
    def test_existing_database_is_preserved_and_legacy_owners_stay_null(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"APP_DB_PATH": f"{directory}/old.db"}):
            # Reproduce an actual old schema, then apply the idempotent migration.
            from backend.db import SCHEMA
            old_schema = "CREATE TABLE IF NOT EXISTS tasks" + SCHEMA.read_text().split("CREATE TABLE IF NOT EXISTS tasks", 1)[1]
            old_schema = old_schema.replace("    owner_user_id INTEGER REFERENCES users(id),\n", "")
            with closing(connect()) as connection, connection:
                connection.executescript(old_schema)
                connection.execute("INSERT INTO tasks(id, title, status, score) VALUES (101, 'Existing task', 'published', 30)")
                connection.execute("INSERT INTO teams(id, name, points) VALUES (101, 'Existing team', 20)")
            init_db()
            init_db()
            with closing(connect()) as connection:
                self.assertEqual(tuple(connection.execute("SELECT title, status, score FROM tasks WHERE id = 101").fetchone()),
                                 ("Existing task", "published", 30))
                self.assertEqual(tuple(connection.execute("SELECT name, points, owner_user_id FROM teams WHERE id = 101").fetchone()),
                                 ("Existing team", 20, None))
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM tasks WHERE owner_user_id IS NOT NULL").fetchone()[0], 0)
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM users").fetchone()[0], 0)


if __name__ == "__main__":
    unittest.main()
