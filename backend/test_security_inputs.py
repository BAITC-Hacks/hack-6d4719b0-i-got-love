"""Boundary, URL and AI resource checks against isolated HTTP/DB fixtures."""

import io
import json
import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from http.client import IncompleteRead
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Barrier, BoundedSemaphore, Event, Thread
from unittest.mock import patch

from fastapi.testclient import TestClient

from .integration import app
from .seed import seed_demo as seed_tasks
from .team_proposals import seed_demo as seed_teams
from .test_support import own_seed_tasks, own_seed_team_user, register_user
from task_builder import server


class SecurityInputTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.environment = patch.dict(os.environ, {
            "APP_DB_PATH": f"{self.directory.name}/test.db",
            "AI_API_URL": "", "AI_API_KEY": "", "AI_MODEL": "", "OLLAMA_MODEL": "",
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)
        os.environ.pop("TASK_BUILDER_DB_PATH", None)
        seed_tasks()
        seed_teams()
        self.client = TestClient(app, raise_server_exceptions=False)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)
        self.business = register_user(self.client)
        own_seed_tasks(self.business)
        self.team_client = TestClient(app, raise_server_exceptions=False)
        self.addCleanup(self.team_client.close)
        self.team = own_seed_team_user(self.team_client)
        self.proposal = {"task_id": 7, "team_id": 1, "idea": "Идея", "plan": "План", "duration": "Неделя", "prototype_url": "https://prototype.test/view"}

    def test_bad_prototype_urls_return_422_and_save_nothing(self):
        before = self.client.get("/api/proposals").json()
        urls = ("https://[broken", "http://@", "https://prototype.test:invalid", "https://prototype.test:99999",
                "https://prototype.test/a b", "https://trusted.test@other.test/view", "javascript:alert(1)",
                "https://prototype.test/\nview", "https://prototype.test\\@other.test/view")
        for url in urls:
            with self.subTest(url=url):
                response = self.team_client.post("/api/proposals", json={**self.proposal, "prototype_url": url})
                self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(self.client.get("/api/proposals").json(), before)
        response = self.team_client.post("/api/proposals", json=self.proposal)
        self.assertEqual(response.status_code, 201, response.text)

    def test_all_id_inputs_reject_sqlite_overflow_and_nonpositive_values(self):
        for value in (0, -1, 10**30):
            cases = (
                ("GET", f"/api/catalog/{value}", None),
                ("GET", f"/api/task-builder/tasks/{value}", None),
                ("PUT", f"/api/task-builder/tasks/{value}", {"title": "Задача"}),
                ("PUT", f"/api/task-builder/tasks/{value}/confirmed", {"title": "Задача"}),
                ("POST", f"/api/task-builder/tasks/{value}/confirm", None),
                ("POST", f"/api/task-builder/tasks/{value}/publish", None),
                ("GET", f"/api/proposals?task_id={value}", None),
                ("PATCH", f"/api/proposals/{value}/decision", {"decision": "selected"}),
                ("POST", f"/api/proposals/{value}/progress", None),
                ("POST", "/api/proposals", {**self.proposal, "task_id": value}),
                ("POST", "/api/proposals", {**self.proposal, "team_id": value}),
            )
            for method, path, body in cases:
                with self.subTest(method=method, path=path, body_id=value):
                    client = self.team_client if path == "/api/proposals" and method == "POST" else self.client
                    response = client.request(method, path, json=body) if body is not None else client.request(method, path)
                    self.assertEqual(response.status_code, 422, response.text)

    def test_text_limits_reject_before_provider_or_database_changes(self):
        before = self.client.get("/api/task-builder/tasks").json()
        with patch.object(server, "external_questions") as generate:
            response = self.client.post("/api/task-builder/questions", json={"description": "а" * 10001})
            self.assertEqual(response.status_code, 422)
            generate.assert_not_called()
        for payload in (
            {"description": "Контекст", "answers": {"title": "а" * 201}},
            {"description": "Контекст", "answers": {"need": "а" * 10001}},
        ):
            self.assertEqual(self.client.post("/api/task-builder/drafts", json=payload).status_code, 422)
        for field, size in (("title", 201), ("topic", 101), ("data", 10001), ("contact", 501), ("interaction_format", 1001)):
            with self.subTest(field=field):
                self.assertEqual(self.client.put("/api/task-builder/tasks/1", json={field: "а" * size}).status_code, 422)
        for field, size in (("idea", 10001), ("plan", 10001), ("duration", 201), ("prototype_url", 2049)):
            with self.subTest(field=field):
                self.assertEqual(self.team_client.post("/api/proposals", json={**self.proposal, field: "а" * size}).status_code, 422)
        self.assertEqual(self.client.get("/api/task-builder/tasks").json(), before)

    def test_ai_response_size_question_length_and_truncated_connection(self):
        os.environ["OLLAMA_MODEL"] = "fake-model"
        long_question = {"questions": [
            {"field": "need", "text": "а" * 501 + "?"},
            {"field": "data", "text": "Какие данные доступны?"},
            {"field": "users", "text": "Для кого решение?"},
        ]}
        payloads = (b"x" * (server.AI_RESPONSE_LIMIT + 1), json.dumps({"message": {"content": json.dumps(long_question)}}).encode())
        for payload in payloads:
            with patch.object(server, "urlopen", return_value=io.BytesIO(payload)):
                response = self.client.post("/api/task-builder/questions", json={"description": "Контекст"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["fallback_reason"], "invalid_response")
        with patch.object(server, "urlopen", side_effect=IncompleteRead(b"partial", 3)):
            response = self.client.post("/api/task-builder/questions", json={"description": "Контекст"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["fallback_reason"], "unavailable")

    def test_ai_concurrency_limit_releases_slots_after_success_and_failure(self):
        started = Barrier(3)
        release = Event()

        def generate(_description):
            started.wait(timeout=5)
            if not release.wait(timeout=5):
                raise TimeoutError()
            return list(server.FALLBACK_QUESTIONS)

        with patch.object(server, "AI_GENERATION_SLOTS", BoundedSemaphore(2)), patch.object(server, "external_questions", side_effect=generate):
            with ThreadPoolExecutor(max_workers=2) as pool:
                calls = [pool.submit(self.client.post, "/api/task-builder/questions", json={"description": "Контекст"}) for _ in range(2)]
                try:
                    started.wait(timeout=5)
                    busy = self.client.post("/api/task-builder/questions", json={"description": "Контекст"})
                    self.assertEqual(busy.status_code, 429)
                    self.assertEqual(busy.headers["Retry-After"], "5")
                finally:
                    release.set()
                self.assertTrue(all(call.result().status_code == 200 for call in calls))
            for _ in range(4):
                with patch.object(server, "external_questions", side_effect=ValueError("bad response")):
                    self.assertEqual(self.client.post("/api/task-builder/questions", json={"description": "Контекст"}).status_code, 200)

    def test_provider_redirect_does_not_forward_request_or_credentials(self):
        received = []

        class RedirectHandler(BaseHTTPRequestHandler):
            def do_POST(self):
                received.append((self.path, self.headers.get("Authorization")))
                self.send_response(302)
                self.send_header("Location", "/target")
                self.send_header("Content-Length", "0")
                self.end_headers()

            def do_GET(self):
                received.append((self.path, self.headers.get("Authorization")))
                self.send_response(200)
                self.send_header("Content-Length", "2")
                self.end_headers()
                self.wfile.write(b"{}")

            def log_message(self, *_args):
                pass

        with ThreadingHTTPServer(("127.0.0.1", 0), RedirectHandler) as provider:
            thread = Thread(target=provider.serve_forever, daemon=True)
            thread.start()
            try:
                os.environ.update(AI_API_URL=f"http://127.0.0.1:{provider.server_port}/redirect", AI_API_KEY="fake-test-key", AI_MODEL="fake-model")
                response = self.client.post("/api/task-builder/questions", json={"description": "Контекст"})
            finally:
                provider.shutdown()
                thread.join(timeout=2)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["fallback_reason"], "unavailable")
        self.assertEqual(received, [("/redirect", "Bearer fake-test-key")])


if __name__ == "__main__":
    unittest.main()
