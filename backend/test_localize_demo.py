"""Russian seed content and conservative, repeatable legacy-data translation."""

import json
import os
import re
import tempfile
import unittest
from contextlib import closing
from unittest.mock import patch

from .db import connect
from .localize_demo import LEGACY_PROTOTYPE_URLS, LEGACY_TASK_FIELDS, LEGACY_TEAM_FIELDS, localize_demo_data
from .seed import seed_demo as seed_tasks
from .team_proposals import seed_demo as seed_teams


class LocalizationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.environment = patch.dict(os.environ, {"APP_DB_PATH": f"{self.directory.name}/tasks.db"})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        seed_tasks()
        seed_teams()

    def test_fresh_seed_is_russian_without_changing_rating(self):
        with closing(connect()) as connection:
            tasks = list(connection.execute("SELECT * FROM tasks ORDER BY id"))
            teams = list(connection.execute("SELECT * FROM teams ORDER BY id"))
            prototype_urls = [row[0] for row in connection.execute("SELECT prototype_url FROM proposals")]
        self.assertEqual(prototype_urls, [""] * 5)
        self.assertEqual(tasks[6]["title"], "Сократить время ответа поддержки")
        for task in tasks:
            for field in ("title", "topic", "context", "need", "users", "data", "constraints", "expected_result", "success_criteria", "interaction_format"):
                if task[field]:
                    self.assertRegex(task[field], "[А-Яа-яЁё]")
                    self.assertIsNone(re.search("[A-Za-z]", task[field]))
        self.assertEqual([task["score"] for task in tasks[5:]], [0, 30, 50, 75, 100])
        self.assertEqual([team["name"] for team in teams], ["Пиксель Лаб", "Пульс данных", "Зелёный стек", "Крафт Код", "Мастера роста"])
        self.assertIn("Электронная коммерция", json.loads(teams[0]["interests"]))
        self.assertIn("Дизайн интерфейсов", json.loads(teams[0]["skills"]))
        self.assertIn("Веб-разработка", json.loads(teams[3]["skills"]))
        self.assertIn("React", json.loads(teams[3]["technologies"]))
        self.assertEqual(localize_demo_data(), 0)

    def test_legacy_migration_preserves_edits_links_and_progress(self):
        with closing(connect()) as connection, connection:
            for task_id, fields in LEGACY_TASK_FIELDS.items():
                for field, (original, _) in fields.items():
                    connection.execute(f"UPDATE tasks SET {field} = ? WHERE id = ?", (original, task_id))
            for team_id, fields in LEGACY_TEAM_FIELDS.items():
                for field, (original, _) in fields.items():
                    value = json.dumps(original) if isinstance(original, list) else original
                    connection.execute(f"UPDATE teams SET {field} = ? WHERE id = ?", (value, team_id))
            connection.execute("UPDATE tasks SET title = 'Название заказчика', need = 'Custom business requirement' WHERE id = 7")
            connection.execute("UPDATE teams SET name = 'My custom team', points = 20 WHERE id = 1")
            edited_skills = json.dumps(["UX/UI-дизайн", "Навык заказчика"], ensure_ascii=False)
            connection.execute("UPDATE teams SET skills = ? WHERE id = 1", (edited_skills,))
            connection.execute("UPDATE proposals SET decision = 'selected', progress_confirmed = 1 WHERE id = 1")
            connection.execute("INSERT INTO tasks (id, title, topic) VALUES (11, 'Shorten support replies', 'Services')")
            before_tasks = [tuple(row) for row in connection.execute("SELECT id, status, score, confirmed_at FROM tasks ORDER BY id")]
            before_proposals = [tuple(row) for row in connection.execute("SELECT * FROM proposals ORDER BY id")]
        self.assertGreater(localize_demo_data(), 0)
        self.assertEqual(localize_demo_data(), 0)
        with closing(connect()) as connection:
            self.assertEqual([tuple(row) for row in connection.execute("SELECT id, status, score, confirmed_at FROM tasks ORDER BY id")], before_tasks)
            self.assertEqual([tuple(row) for row in connection.execute("SELECT * FROM proposals ORDER BY id")], before_proposals)
            task = connection.execute("SELECT * FROM tasks WHERE id = 7").fetchone()
            self.assertEqual(task["title"], "Название заказчика")
            self.assertEqual(task["need"], "Custom business requirement")
            self.assertEqual(task["context"], "Клиенты долго ждут ответа")
            self.assertEqual(task["topic"], "Услуги")
            team = connection.execute("SELECT * FROM teams WHERE id = 1").fetchone()
            self.assertEqual(team["name"], "My custom team")
            self.assertEqual(team["points"], 20)
            self.assertEqual(team["skills"], edited_skills)
            self.assertIn("Электронная коммерция", json.loads(team["interests"]))
            self.assertEqual(connection.execute("SELECT name FROM teams WHERE id = 2").fetchone()[0], "Пульс данных")
            self.assertEqual(connection.execute("SELECT title FROM tasks WHERE id = 11").fetchone()[0], "Shorten support replies")

    def test_only_known_seed_prototype_placeholders_are_removed(self):
        with closing(connect()) as connection, connection:
            for proposal_id, placeholder in LEGACY_PROTOTYPE_URLS.items():
                connection.execute("UPDATE proposals SET prototype_url = ? WHERE id = ?", (placeholder, proposal_id))
            connection.execute("UPDATE proposals SET decision = 'selected', progress_confirmed = 1 WHERE id = 1")
            connection.execute("UPDATE teams SET points = 10 WHERE id = 1")
            real_url = "https://www.figma.com/design/customer-prototype"
            connection.execute("UPDATE proposals SET prototype_url = ? WHERE id = 2", (real_url,))
            connection.execute("INSERT INTO proposals (id, task_id, team_id, prototype_url) VALUES (6, 7, 1, ?)", (LEGACY_PROTOTYPE_URLS[1],))
            before = [tuple(row) for row in connection.execute("SELECT id, task_id, team_id, idea, plan, duration, decision, progress_confirmed FROM proposals ORDER BY id")]
        self.assertEqual(localize_demo_data(), 4)
        self.assertEqual(localize_demo_data(), 0)
        with closing(connect()) as connection:
            self.assertEqual([tuple(row) for row in connection.execute("SELECT id, task_id, team_id, idea, plan, duration, decision, progress_confirmed FROM proposals ORDER BY id")], before)
            urls = [row[0] for row in connection.execute("SELECT prototype_url FROM proposals ORDER BY id")]
            self.assertEqual(urls, ["", real_url, "", "", "", LEGACY_PROTOTYPE_URLS[1]])
            self.assertEqual(connection.execute("SELECT points FROM teams WHERE id = 1").fetchone()[0], 10)


if __name__ == "__main__":
    unittest.main()
