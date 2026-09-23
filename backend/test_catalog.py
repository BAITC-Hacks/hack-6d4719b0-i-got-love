import os
import tempfile
import unittest
from contextlib import closing

from .db import connect
from .main import get_catalog_task, list_catalog
from .rating import confirm_task, evaluate, level_for
from .seed import seed_demo


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.previous_path = os.environ.get("APP_DB_PATH")
        os.environ["APP_DB_PATH"] = os.path.join(self.directory.name, "test.db")
        seed_demo()

    def tearDown(self):
        if self.previous_path is None:
            os.environ.pop("APP_DB_PATH", None)
        else:
            os.environ["APP_DB_PATH"] = self.previous_path
        self.directory.cleanup()

    def test_weights_and_levels(self):
        with closing(connect()) as connection:
            task = connection.execute("SELECT * FROM tasks WHERE id = 10").fetchone()
        result = evaluate(task)
        self.assertEqual(result["score"], 100)
        self.assertEqual(sum(part["max"] for part in result["score_breakdown"].values()), 100)
        self.assertEqual(result["missing_fields"], [])
        self.assertEqual([level_for(score) for score in (0, 39, 40, 69, 70, 89, 90, 100)],
                         ["draft", "draft", "working", "working", "ready", "ready", "priority", "priority"])

    def test_published_zero_score_remains_in_catalog(self):
        result = list_catalog(sort="score_asc", topic=None, level=None)
        self.assertEqual(result["total"], 5)
        self.assertEqual([item["score"] for item in result["items"]], [0, 30, 50, 75, 100])
        self.assertEqual(result["items"][0]["id"], 6)
        self.assertEqual(get_catalog_task(6)["level"], "draft")
        with closing(connect()) as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM tasks WHERE status = 'draft'").fetchone()[0], 5)

    def test_zero_score_task_accepts_proposal(self):
        with closing(connect()) as connection, connection:
            connection.execute("INSERT INTO teams (id, name) VALUES (1, 'Demo team')")
            connection.execute(
                "INSERT INTO proposals (task_id, team_id, idea) VALUES (6, 1, 'Signage prototype')"
            )
            count = connection.execute("SELECT COUNT(*) FROM proposals WHERE task_id = 6").fetchone()[0]
        self.assertEqual(count, 1)

    def test_topic_and_level_filters(self):
        result = list_catalog(sort="score_desc", topic="образование", level="working")
        self.assertEqual([item["id"] for item in result["items"]], [8])
        self.assertEqual(result["total"], 1)

    def test_confirmation_recalculates_score(self):
        with closing(connect()) as connection, connection:
            before = connection.execute("SELECT score FROM tasks WHERE id = 1").fetchone()[0]
            result = confirm_task(connection, 1, {"need": "Reduce calls", "data": "Anonymous booking logs"})
            after = connection.execute("SELECT score FROM tasks WHERE id = 1").fetchone()[0]
        self.assertEqual(before, 0)
        self.assertEqual(result["score"], 40)
        self.assertEqual(after, 40)
        self.assertIn("contact", result["missing_fields"])

        with closing(connect()) as connection, connection:
            changed = confirm_task(connection, 10, {"data": ""})
            stored = connection.execute("SELECT score FROM tasks WHERE id = 10").fetchone()[0]
        self.assertEqual(changed["score"], 80)
        self.assertEqual(stored, 80)
        self.assertIn("data", changed["missing_fields"])


if __name__ == "__main__":
    unittest.main()
