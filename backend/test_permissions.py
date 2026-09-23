"""Exercise roles and ownership through real registered sessions."""

import os
import tempfile
import unittest
from contextlib import closing
from unittest.mock import patch

from fastapi.testclient import TestClient

from .db import connect
from .integration import app
from .seed import seed_demo as seed_tasks
from .team_proposals import seed_demo as seed_teams
from .test_support import register_user


class PermissionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        environment = patch.dict(os.environ, {"APP_DB_PATH": f"{self.directory.name}/permissions.db", "OLLAMA_MODEL": ""})
        environment.start()
        self.addCleanup(environment.stop)
        seed_tasks()
        seed_teams()
        self.public = self.client()
        self.business = self.client()
        self.business_user = register_user(self.business, email="owner@example.test")
        self.other_business = self.client()
        self.other_business_user = register_user(self.other_business, email="other-owner@example.test")
        self.team = self.client()
        self.team_user = register_user(self.team, "team", "team@example.test")
        self.other_team = self.client()
        self.other_team_user = register_user(self.other_team, "team", "other-team@example.test")

    def client(self):
        client = TestClient(app)
        client.__enter__()
        self.addCleanup(client.__exit__, None, None, None)
        return client

    def draft(self):
        response = self.business.post("/api/task-builder/drafts", json={
            "description": "Клиенты долго ждут ответа", "answers": {"title": "Ускорить поддержку", "need": "Сократить ожидание"},
        })
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_anonymous_read_only_catalog_and_protected_business_actions(self):
        for path in ("/api/catalog", "/api/catalog/7", "/api/teams", "/api/proposals?task_id=7"):
            self.assertEqual(self.public.get(path).status_code, 200)
        cases = (
            ("GET", "/api/task-builder/tasks", None),
            ("GET", "/api/task-builder/tasks/1", None),
            ("POST", "/api/task-builder/questions", {"description": "Контекст"}),
            ("POST", "/api/task-builder/drafts", {"description": "Контекст", "answers": {}}),
            ("PUT", "/api/task-builder/tasks/1", {"title": "Правка"}),
            ("PUT", "/api/task-builder/tasks/7/confirmed", {"title": "Правка"}),
            ("POST", "/api/task-builder/tasks/1/confirm", None),
            ("POST", "/api/task-builder/tasks/1/publish", None),
            ("PATCH", "/api/proposals/1/decision", {"decision": "selected"}),
            ("POST", "/api/proposals/1/progress", None),
        )
        for method, path, body in cases:
            with self.subTest(path=path):
                response = self.public.request(method, path, json=body) if body is not None else self.public.request(method, path)
                self.assertEqual(response.status_code, 401, response.text)

    def test_builder_is_private_and_role_restricted(self):
        task = self.draft()
        self.assertEqual(task["owner_user_id"], self.business_user["id"])
        path = f"/api/task-builder/tasks/{task['id']}"
        self.assertEqual(self.business.get("/api/task-builder/tasks").json()["total"], 1)
        self.assertEqual(self.other_business.get("/api/task-builder/tasks").json()["items"], [])
        self.assertEqual(self.other_business.get(path).status_code, 403)
        self.assertEqual(self.other_business.put(path, json={"title": "Чужая правка"}).status_code, 403)
        self.assertEqual(self.other_business.post(path + "/confirm").status_code, 403)
        self.assertEqual(self.other_business.post(path + "/publish").status_code, 403)
        for path in ("/api/task-builder/tasks", path):
            self.assertEqual(self.team.get(path).status_code, 403)
        with patch("task_builder.server.external_questions") as provider:
            self.assertEqual(self.team.post("/api/task-builder/questions", json={"description": "Контекст"}).status_code, 403)
            provider.assert_not_called()
        self.assertEqual(self.team.post("/api/task-builder/drafts", json={"description": "Контекст", "answers": {}}).status_code, 403)

    def test_only_own_team_can_propose_and_task_owner_can_award(self):
        task = self.draft()
        path = f"/api/task-builder/tasks/{task['id']}"
        proposal = {"task_id": task["id"], "team_id": self.team_user["team_id"], "idea": "Помощник оператора", "plan": "Прототип и проверка", "duration": "Неделя", "prototype_url": "https://prototype.test/view"}
        self.assertEqual(self.team.post("/api/proposals", json=proposal).status_code, 404)
        self.assertEqual(self.business.post(path + "/confirm").status_code, 200)
        self.assertEqual(self.business.post(path + "/publish").status_code, 200)
        self.assertEqual(self.public.get(f"/api/catalog/{task['id']}").json()["owner_user_id"], self.business_user["id"])
        self.assertEqual(self.other_business.get(path).status_code, 403)
        self.assertEqual(self.other_business.put(path + "/confirmed", json={"title": "Чужая правка"}).status_code, 403)
        self.assertEqual(self.public.post("/api/proposals", json=proposal).status_code, 401)
        self.assertEqual(self.business.post("/api/proposals", json=proposal).status_code, 403)
        self.assertEqual(self.other_team.post("/api/proposals", json=proposal).status_code, 403)
        response = self.team.post("/api/proposals", json=proposal)
        self.assertEqual(response.status_code, 201, response.text)
        proposal_id = response.json()["id"]
        for client in (self.other_business, self.team):
            self.assertEqual(client.patch(f"/api/proposals/{proposal_id}/decision", json={"decision": "selected"}).status_code, 403)
            self.assertEqual(client.post(f"/api/proposals/{proposal_id}/progress").status_code, 403)
        self.assertEqual(self.business.patch(f"/api/proposals/{proposal_id}/decision", json={"decision": "selected"}).status_code, 200)
        for _ in range(2):
            self.assertEqual(self.business.post(f"/api/proposals/{proposal_id}/progress").status_code, 200)
        teams = self.public.get("/api/teams").json()
        mine = next(team for team in teams if team["id"] == self.team_user["team_id"])
        self.assertEqual(mine["points"], 10)
        self.assertEqual(mine["owner_user_id"], self.team_user["id"])
        self.assertEqual(self.public.get(f"/api/catalog/{task['id']}").json()["score"], 20)

    def test_legacy_demo_owners_stay_null_and_read_only(self):
        self.assertEqual(self.business.get("/api/task-builder/tasks").json()["total"], 0)
        for path, body in (("/api/task-builder/tasks/1", {"title": "Захват", "owner_user_id": self.business_user["id"]}),
                           ("/api/task-builder/tasks/7/confirmed", {"title": "Захват", "owner_user_id": self.business_user["id"]})):
            self.assertEqual(self.business.put(path, json=body).status_code, 403)
        self.assertEqual(self.business.patch("/api/proposals/1/decision", json={"decision": "selected"}).status_code, 403)
        self.assertEqual(self.business.post("/api/proposals/1/progress").status_code, 403)
        with closing(connect()) as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM tasks WHERE owner_user_id IS NULL").fetchone()[0], 10)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM teams WHERE owner_user_id IS NULL").fetchone()[0], 5)
            self.assertEqual(connection.execute("SELECT decision FROM proposals WHERE id = 1").fetchone()[0], "pending")


if __name__ == "__main__":
    unittest.main()
