"""HTTP boundary regressions; all writes use disposable databases."""

import asyncio
import os
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.integration import FRONTEND_CSP, MAX_REQUEST_BYTES, HttpSecurityMiddleware, app
from backend.seed import seed_demo
from backend.test_support import own_seed_tasks, register_user
from backend.auth import COOKIE_NAME


class HttpSecurityTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.environment = patch.dict(os.environ, {"APP_DB_PATH": f"{self.directory.name}/security.db"})
        self.environment.start()
        os.environ.pop("TASK_BUILDER_DB_PATH", None)
        seed_demo()
        self.client = TestClient(app)
        self.client.__enter__()
        own_seed_tasks(register_user(self.client))

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.environment.stop()
        self.directory.cleanup()

    def test_cross_origin_form_post_cannot_confirm_or_publish(self):
        for endpoint in ("confirm", "publish"):
            response = self.client.post(f"/api/task-builder/tasks/1/{endpoint}", headers={
                "Origin": "https://other.example",
                "Content-Type": "application/x-www-form-urlencoded",
            })
            self.assertEqual(response.status_code, 403)
        task = self.client.get("/api/task-builder/tasks/1").json()
        self.assertIsNone(task["confirmed_at"])
        self.assertEqual(task["status"], "draft")

    def test_cross_site_metadata_rejected_even_without_origin(self):
        response = self.client.post("/api/task-builder/tasks/1/confirm", headers={"Sec-Fetch-Site": "cross-site"})
        self.assertEqual(response.status_code, 403)

    def test_null_malformed_and_different_port_origins_rejected(self):
        for origin in ("null", "not-a-url", "http://testserver:9000", "http://testserver:0", "http://user@testserver", "http://testserver/path"):
            with self.subTest(origin=origin):
                response = self.client.post("/api/task-builder/tasks/1/confirm", headers={"Origin": origin})
                self.assertEqual(response.status_code, 403)

    def test_same_origin_browser_and_no_origin_cli_still_work(self):
        response = self.client.post("/api/task-builder/tasks/1/confirm", headers={
            "Origin": "http://testserver:80", "Sec-Fetch-Site": "same-origin",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.post("/api/task-builder/tasks/1/publish").status_code, 200)

    def test_vite_proxy_preserved_host_and_https_origin_work(self):
        response = self.client.post("/api/task-builder/tasks/1/confirm", headers={
            "Host": "localhost:5173", "Origin": "http://localhost:5173", "Sec-Fetch-Site": "same-origin",
        })
        self.assertEqual(response.status_code, 200)
        response = self.client.post("https://demo.example/api/task-builder/tasks/2/confirm", headers={
            "Origin": "https://demo.example", "Sec-Fetch-Site": "same-origin",
            "Cookie": f"{COOKIE_NAME}={self.client.cookies.get(COOKIE_NAME)}",
        })
        self.assertEqual(response.status_code, 200)

    def test_oversized_body_rejected_before_database_write(self):
        before = self.client.get("/api/task-builder/tasks").json()["total"]
        response = self.client.post("/api/task-builder/drafts", json={
            "description": "x" * MAX_REQUEST_BYTES, "answers": {},
        })
        self.assertEqual(response.status_code, 413)
        self.assertEqual(self.client.get("/api/task-builder/tasks").json()["total"], before)

    def test_response_headers_keep_swagger_usable(self):
        response = self.client.get("/")
        self.assertEqual(response.headers["Content-Security-Policy"], FRONTEND_CSP)
        self.assertIn("frame-ancestors 'none'", FRONTEND_CSP)
        for path in ("/", "/docs", "/api/health", "/not-a-route"):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
                self.assertEqual(response.headers["Referrer-Policy"], "no-referrer")
                if path == "/docs":
                    self.assertEqual(response.status_code, 200)
                    self.assertNotIn("Content-Security-Policy", response.headers)

    def test_source_and_database_paths_are_not_served(self):
        for path in ("/.env", "/.git/config", "/backend/app.db", "/assets/%2e%2e/README.md", "/assets/%2e%2e/%2e%2e/.env"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 404)


class StreamingBodyLimitTests(unittest.TestCase):
    def request(self, chunks, headers=()):
        """Send separate ASGI frames; HTTP clients may buffer generators."""
        downstream_bodies = []
        sent = []

        async def downstream(scope, receive, send):
            downstream_bodies.append((await receive())["body"])
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"ok"})

        async def run():
            frames = iter({"type": "http.request", "body": chunk, "more_body": index < len(chunks) - 1}
                          for index, chunk in enumerate(chunks))

            async def receive():
                return next(frames, {"type": "http.disconnect"})

            async def send(message):
                sent.append(message)

            scope = {"type": "http", "method": "POST", "path": "/api/task-builder/drafts",
                     "scheme": "http", "server": ("testserver", 80), "query_string": b"", "headers": list(headers)}
            await HttpSecurityMiddleware(downstream)(scope, receive, send)

        asyncio.run(run())
        return sent[0]["status"], downstream_bodies

    def test_chunked_body_without_content_length_is_bounded(self):
        status, forwarded = self.request([b"x" * (MAX_REQUEST_BYTES // 2), b"y" * (MAX_REQUEST_BYTES // 2), b"z"])
        self.assertEqual(status, 413)
        self.assertEqual(forwarded, [])

    def test_false_small_content_length_does_not_bypass_limit(self):
        status, forwarded = self.request([b"x" * MAX_REQUEST_BYTES, b"y"], [(b"content-length", b"1")])
        self.assertEqual(status, 413)
        self.assertEqual(forwarded, [])

    def test_exact_limit_is_preserved_for_downstream(self):
        content = b"x" * MAX_REQUEST_BYTES
        status, forwarded = self.request([b"", content[:100], content[100:]])
        self.assertEqual(status, 200)
        self.assertEqual(forwarded, [content])

    def test_invalid_or_oversized_declared_lengths_are_rejected(self):
        for length, expected in ((b"-1", 400), (b"invalid", 400), (str(MAX_REQUEST_BYTES + 1).encode(), 413)):
            with self.subTest(length=length):
                status, forwarded = self.request([], [(b"content-length", length)])
                self.assertEqual(status, expected)
                self.assertEqual(forwarded, [])


if __name__ == "__main__":
    unittest.main()
