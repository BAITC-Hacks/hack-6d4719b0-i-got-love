"""Exercise the real HTTP contract and transaction invariants on an isolated DB."""

import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.integration import app
from backend.seed import seed_demo as seed_tasks
from backend.team_proposals import seed_demo as seed_teams
from task_builder.server import TEXT_FIELDS


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.environment = patch.dict(os.environ, {"APP_DB_PATH": f"{self.directory.name}/app.db", "OLLAMA_MODEL": ""})
        self.environment.start()
        self.builder_path = os.environ.pop("TASK_BUILDER_DB_PATH", None)
        seed_tasks()
        seed_teams()
        self.client = TestClient(app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        if self.builder_path is not None:
            os.environ["TASK_BUILDER_DB_PATH"] = self.builder_path
        self.environment.stop()
        self.directory.cleanup()

    def request(self, method, path, status=200, **kwargs):
        response = self.client.request(method, path, **kwargs)
        self.assertEqual(response.status_code, status, response.text)
        return response.json()

    def test_complete_builder_lifecycle_and_reopening(self):
        with patch("task_builder.server.external_questions", side_effect=ValueError("Malformed AI")):
            questions = self.request("POST", "/api/task-builder/questions", json={"description": "Медленная поддержка"})
        self.assertEqual(questions["source"], "local")
        self.assertGreaterEqual(len(questions["questions"]), 3)
        self.assertTrue(questions["warning"])
        task = self.request("POST", "/api/task-builder/drafts", 201, json={
            "description": "Медленная поддержка", "answers": {"need": "Ускорить ответ", "title": "Поддержка"},
        })
        path = f"/api/task-builder/tasks/{task['id']}"
        self.assertEqual(task["score"], 0)
        self.assertEqual(task["rating_preview"]["score"], 20)
        self.assertIn("data", task["missing_fields"])
        self.assertEqual(task["data"], "")
        drafts = self.request("GET", "/api/task-builder/tasks?status=draft")
        self.assertEqual(drafts["items"][0]["id"], task["id"])
        self.assertEqual(drafts["total"], 6)
        self.request("POST", path + "/publish", 409)
        confirmed = self.request("POST", path + "/confirm")
        self.assertEqual(confirmed["score"], 20)
        self.assertEqual(confirmed["score_breakdown"]["context_and_need"]["earned"], 20)
        card = {field: task[field] for field in TEXT_FIELDS}
        card["data"] = "Обезличенная история обращений"
        saved = self.request("PUT", path, json=card)
        self.assertIsNone(saved["confirmed_at"])
        self.assertEqual(saved["score"], 0)
        self.assertEqual(saved["rating_preview"]["score"], 40)
        self.request("POST", path + "/publish", 409)
        self.request("POST", path + "/confirm")
        published = self.request("POST", path + "/publish")
        self.assertEqual(published["status"], "published")
        self.assertEqual(published, self.request("POST", path + "/publish"))
        self.assertEqual(self.request("GET", f"/api/catalog/{task['id']}")["score"], 40)
        self.assertEqual(self.request("GET", path)["score"], 40)
        self.request("PUT", path, 409, json=card)
        self.request("GET", "/api/task-builder/tasks?status=invalid", 422)

    def test_low_score_proposals_and_atomic_published_edits(self):
        proposal = self.request("POST", "/api/proposals", 201, json={
            "task_id": 6, "team_id": 1, "idea": "Указатели", "plan": "Прототип",
            "duration": "Неделя", "prototype_url": "https://example.com/prototype",
        })
        self.assertEqual(proposal["decision"], "pending")
        task = self.request("GET", "/api/task-builder/tasks/6")
        self.assertEqual(task["score"], 0)
        card = {field: task[field] for field in TEXT_FIELDS}
        card.update(context="Посетители теряются", need="Упростить навигацию", data="Карта парка")
        updated = self.request("PUT", "/api/task-builder/tasks/6/confirmed", json=card)
        self.assertEqual(updated["score"], 40)
        self.assertEqual(updated["status"], "published")
        self.assertTrue(updated["confirmed_at"])
        self.assertEqual(self.request("GET", "/api/catalog/6")["score"], 40)
        self.assertEqual(self.request("GET", "/api/proposals?task_id=6"), [proposal])
        card["title"] = " "
        self.request("PUT", "/api/task-builder/tasks/6/confirmed", 422, json=card)
        self.assertEqual(self.request("GET", "/api/task-builder/tasks/6"), updated)
        card = {field: updated[field] for field in TEXT_FIELDS}
        card["data"] = ""
        self.assertEqual(self.request("PUT", "/api/task-builder/tasks/6/confirmed", json=card)["score"], 20)
        self.request("PUT", "/api/task-builder/tasks/1/confirmed", 409, json=card)

    def test_concurrent_progress_awards_once_and_multiple_selections(self):
        self.request("POST", "/api/proposals/1/progress", 409)
        for proposal_id in (1, 2):
            self.request("PATCH", f"/api/proposals/{proposal_id}/decision", json={"decision": "selected"})
        self.request("PATCH", "/api/proposals/3/decision", json={"decision": "rejected"})
        self.request("POST", "/api/proposals/3/progress", 409)
        barrier = Barrier(8)

        def award(_):
            barrier.wait()
            return self.client.post("/api/proposals/1/progress")

        with ThreadPoolExecutor(max_workers=8) as pool:
            responses = list(pool.map(award, range(8)))
        for response in responses:
            self.assertEqual(response.status_code, 200, response.text)
            self.assertTrue(response.json()["progress_confirmed"])
        teams = self.request("GET", "/api/teams")
        self.assertEqual(teams[0]["points"], 10)
        self.assertEqual(teams[1]["points"], 0)
        self.assertEqual(self.request("GET", "/api/catalog/7")["score"], 30)
        self.request("PATCH", "/api/proposals/1/decision", 409, json={"decision": "rejected"})

    def test_publish_and_edit_race_never_publishes_unconfirmed_content(self):
        for _ in range(5):
            task = self.request("POST", "/api/task-builder/drafts", 201, json={
                "description": "Проверка гонки", "answers": {"title": "Исходная карточка"},
            })
            path = f"/api/task-builder/tasks/{task['id']}"
            self.request("POST", path + "/confirm")
            card = {field: task[field] for field in TEXT_FIELDS}
            card["title"] = "Неподтверждённая правка"
            barrier = Barrier(2)

            def mutate(operation):
                barrier.wait()
                if operation == "publish":
                    return self.client.post(path + "/publish")
                return self.client.put(path, json=card)

            with ThreadPoolExecutor(max_workers=2) as pool:
                responses = list(pool.map(mutate, ("publish", "edit")))
            self.assertEqual(sorted(response.status_code for response in responses), [200, 409])
            current = self.request("GET", path)
            if current["status"] == "published":
                self.assertEqual(current["title"], "Исходная карточка")
                self.assertTrue(current["confirmed_at"])
            else:
                self.assertIsNone(current["confirmed_at"])
                self.assertEqual(current["score"], 0)


if __name__ == "__main__":
    unittest.main()
