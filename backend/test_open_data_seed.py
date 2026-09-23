"""Open-data teaching briefs are repeatable and never replace user content."""

import os
import tempfile
import unittest
from contextlib import closing
from unittest.mock import patch

from fastapi.testclient import TestClient

from .db import connect
from .integration import app
from .open_data_seed import OPEN_DATA_TASKS, seed_open_data_tasks
from .seed import seed_demo
from .test_support import register_user


class OpenDataSeedTests(unittest.TestCase):
    def test_five_public_cases_are_valid_idempotent_and_preserve_user_task(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"APP_DB_PATH": f"{directory}/test.db"}):
            seed_demo()
            with TestClient(app) as client:
                register_user(client)
                response = client.post("/api/task-builder/drafts", json={"description": "Потребность настоящего пользователя", "answers": {"title": "Моя собственная задача"}})
                self.assertEqual(response.status_code, 201)
                own_task = response.json()
                self.assertEqual(seed_open_data_tasks(), 5)
                catalog = client.get("/api/catalog").json()
                cases = [task for task in catalog["items"] if task["title"] in {item["title"] for item in OPEN_DATA_TASKS}]
                self.assertEqual(len(cases), 5)
                for task in cases:
                    self.assertEqual(task["score"], 90)
                    self.assertIsNone(task["owner_user_id"])
                    self.assertEqual(task["missing_fields"], ["contact", "interaction_format"])
                    self.assertEqual(task["contact"], "")
                    self.assertEqual(task["interaction_format"], "")
                    self.assertIn("Учебный кейс", task["context"])
                    self.assertIn("https://", task["data"])
                with closing(connect()) as connection:
                    snapshot = [tuple(row) for row in connection.execute("SELECT * FROM tasks ORDER BY id")]
                self.assertEqual(seed_open_data_tasks(), 0)
                with closing(connect()) as connection:
                    self.assertEqual([tuple(row) for row in connection.execute("SELECT * FROM tasks ORDER BY id")], snapshot)
                self.assertEqual(client.get(f"/api/task-builder/tasks/{own_task['id']}").json(), own_task)


if __name__ == "__main__":
    unittest.main()
