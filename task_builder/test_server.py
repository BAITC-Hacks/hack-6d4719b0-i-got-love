"""Focused checks for the builder flow and AI fallback."""

import os
import sqlite3
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi import HTTPException

from task_builder import server


class BuilderTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.db_setting = patch.dict(os.environ, {"TASK_BUILDER_DB_PATH": f"{self.directory.name}/tasks.db"})
        self.db_setting.start()

    def tearDown(self):
        self.db_setting.stop()
        self.directory.cleanup()

    def test_description_to_published_card_without_invented_fields(self):
        description = "У нас долго обрабатываются обращения клиентов."
        with patch.object(server, "external_questions", side_effect=ValueError("bad response")):
            prompt = server.questions(server.DescriptionInput(description=description))
        self.assertEqual(len(prompt["questions"]), 5)
        self.assertEqual(prompt["source"], "local")
        self.assertIn("некорректный", prompt["warning"])

        draft = server.create_draft(server.DraftInput(description=description, answers={
            "need": "Сократить время ответа", "users": "Операторы",
            "expected_result": "Прототип распределения обращений",
        }))
        self.assertEqual(draft["context"], description)
        self.assertEqual(draft["data"], "")
        self.assertEqual(draft["contact"], "")
        self.assertEqual(draft["score"], 0)
        with self.assertRaises(HTTPException) as unconfirmed:
            server.publish_task(draft["id"])
        self.assertEqual(unconfirmed.exception.status_code, 409)

        card = {field: draft[field] for field in server.TEXT_FIELDS}
        card["title"] = "Быстрее отвечать клиентам"
        saved = server.edit_task(draft["id"], server.CardInput(**card))
        self.assertIsNone(saved["confirmed_at"])
        confirmed = server.confirm_task(draft["id"])
        self.assertIsNotNone(confirmed["confirmed_at"])

        card["constraints"] = "Без персональных данных"
        edited = server.edit_task(draft["id"], server.CardInput(**card))
        self.assertIsNone(edited["confirmed_at"])
        with self.assertRaises(HTTPException):
            server.publish_task(draft["id"])
        server.confirm_task(draft["id"])
        published = server.publish_task(draft["id"])
        self.assertEqual(published["status"], "published")
        self.assertEqual(server.read_task(draft["id"])["constraints"], "Без персональных данных")

    def test_malformed_ai_questions_are_rejected(self):
        invalid = {"questions": [
            {"field": "need", "text": "Что нужно?"},
            {"field": "need", "text": "Почему?"},
            {"field": "users", "text": "Кому?"},
        ]}
        with self.assertRaises(ValueError):
            server.validate_questions(invalid)
        for field in ([], {}, None, 42):
            with self.subTest(field=field), self.assertRaises(ValueError):
                server.validate_questions({"questions": [
                    {"field": field, "text": "Что нужно?"},
                    {"field": "users", "text": "Для кого?"},
                    {"field": "data", "text": "Какие данные доступны?"},
                ]})

    def test_shared_database_is_used_when_available(self):
        connection = sqlite3.connect(":memory:")
        shared = SimpleNamespace(init_db=Mock(), connect=Mock(return_value=connection))
        with patch.object(server, "shared_db", shared), patch.dict(os.environ, {}, clear=True):
            self.assertIs(server.connect(), connection)
        shared.init_db.assert_called_once_with()
        shared.connect.assert_called_once_with()
        connection.close()


if __name__ == "__main__":
    unittest.main()
