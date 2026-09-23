"""Focused checks for the builder flow and AI fallback."""

import io
import json
import os
import sqlite3
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError

from fastapi import HTTPException
from fastapi.testclient import TestClient

from task_builder import server
from backend.test_support import register_user


class BuilderTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.db_setting = patch.dict(os.environ, {
            "APP_DB_PATH": f"{self.directory.name}/tasks.db",
            "AI_API_URL": "", "AI_API_KEY": "", "AI_MODEL": "", "OLLAMA_MODEL": "",
        })
        self.db_setting.start()
        from backend.integration import app
        self.client = TestClient(app)
        self.client.__enter__()
        self.user = register_user(self.client)

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.db_setting.stop()
        self.directory.cleanup()

    def test_description_to_published_card_without_invented_fields(self):
        description = "У нас долго обрабатываются обращения клиентов."
        with patch.object(server, "external_questions", side_effect=ValueError("bad response")):
            prompt = server.questions(server.DescriptionInput(description=description), user=self.user)
        self.assertEqual(len(prompt["questions"]), 5)
        self.assertEqual(prompt["source"], "local")
        self.assertIn("некорректный", prompt["warning"])

        draft = server.create_draft(server.DraftInput(description=description, answers={
            "need": "Сократить время ответа", "users": "Операторы",
            "expected_result": "Прототип распределения обращений",
        }), user=self.user)
        self.assertEqual(draft["context"], description)
        self.assertEqual(draft["data"], "")
        self.assertEqual(draft["contact"], "")
        self.assertEqual(draft["score"], 0)
        with self.assertRaises(HTTPException) as unconfirmed:
            server.publish_task(draft["id"], user=self.user)
        self.assertEqual(unconfirmed.exception.status_code, 409)

        card = {field: draft[field] for field in server.TEXT_FIELDS}
        card["title"] = "Быстрее отвечать клиентам"
        saved = server.edit_task(draft["id"], server.CardInput(**card), user=self.user)
        self.assertIsNone(saved["confirmed_at"])
        confirmed = server.confirm_task(draft["id"], user=self.user)
        self.assertIsNotNone(confirmed["confirmed_at"])

        card["constraints"] = "Без персональных данных"
        edited = server.edit_task(draft["id"], server.CardInput(**card), user=self.user)
        self.assertIsNone(edited["confirmed_at"])
        with self.assertRaises(HTTPException):
            server.publish_task(draft["id"], user=self.user)
        server.confirm_task(draft["id"], user=self.user)
        published = server.publish_task(draft["id"], user=self.user)
        self.assertEqual(published["status"], "published")
        self.assertEqual(server.read_task(draft["id"], user=self.user)["constraints"], "Без персональных данных")

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


class AIProviderTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.environment = patch.dict(os.environ, {"APP_DB_PATH": f"{self.directory.name}/ai.db"}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        from backend.integration import app
        self.client = TestClient(app)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)
        self.user = register_user(self.client)
        self.request = server.DescriptionInput(description="Пекарня теряет заказы")
        self.generated = {"questions": [
            {"field": "need", "text": "Какие заказы теряются?"},
            {"field": "users", "text": "Кто принимает заказы?"},
            {"field": "data", "text": "Какая история заказов доступна?"},
        ]}

    def test_ollama_request_uses_schema_and_returns_model_questions(self):
        os.environ.update(OLLAMA_MODEL="test-model", OLLAMA_BASE_URL="http://localhost:11434/")
        response = io.BytesIO(json.dumps({"message": {"content": json.dumps(self.generated)}}).encode())
        with patch.object(server, "urlopen", return_value=response) as send:
            result = server.questions(self.request, user=self.user)
        self.assertEqual(result, {"questions": self.generated["questions"], "source": "ollama", "warning": None, "fallback_reason": None})
        request = send.call_args.args[0]
        self.assertEqual(request.full_url, "http://localhost:11434/api/chat")
        self.assertEqual(request.method, "POST")
        self.assertEqual(send.call_args.kwargs["timeout"], 60)
        body = json.loads(request.data)
        self.assertEqual(body["model"], "test-model")
        self.assertFalse(body["stream"])
        self.assertEqual(body["options"], {"temperature": 0, "num_predict": 700})
        schema = body["format"]["properties"]["questions"]
        self.assertEqual((schema["minItems"], schema["maxItems"]), (3, 5))
        self.assertEqual(schema["items"]["properties"]["field"]["enum"], list(server.QUESTION_FIELDS))
        self.assertEqual(body["messages"][1]["content"], self.request.description)
        self.assertIsNone(request.get_header("Authorization"))

    def test_complete_external_configuration_has_priority(self):
        os.environ.update(AI_API_URL="https://provider.test/chat", AI_API_KEY="test-secret", AI_MODEL="external-model", OLLAMA_MODEL="test-model")
        response = io.BytesIO(json.dumps({"choices": [{"message": {"content": json.dumps(self.generated)}}]}).encode())
        with patch.object(server, "urlopen", return_value=response) as send:
            result = server.questions(self.request, user=self.user)
        self.assertEqual(result["source"], "external")
        self.assertIsNone(result["fallback_reason"])
        request = send.call_args.args[0]
        self.assertEqual(request.full_url, "https://provider.test/chat")
        self.assertEqual(request.get_header("Authorization"), "Bearer test-secret")
        self.assertEqual(json.loads(request.data)["model"], "external-model")
        self.assertEqual(send.call_args.kwargs["timeout"], 12)

    def test_no_or_partial_configuration_does_not_make_network_call(self):
        for configuration in ({}, {"AI_API_KEY": "test-secret"}):
            with self.subTest(configuration=bool(configuration)), patch.dict(os.environ, configuration), patch.object(server, "urlopen") as send:
                result = server.questions(self.request, user=self.user)
                self.assertEqual(result["source"], "local")
                self.assertEqual(result["fallback_reason"], "not_configured")
                self.assertIn("не подключён", result["warning"])
                self.assertNotIn("test-secret", result["warning"])
                send.assert_not_called()

    def test_provider_connection_errors_are_distinguished(self):
        os.environ["OLLAMA_MODEL"] = "test-model"
        failures = (URLError("secret-network-details"), TimeoutError("secret-timeout"), HTTPError("secret-url", 404, "Model unavailable", {}, None))
        for failure in failures:
            with self.subTest(error=type(failure).__name__), patch.object(server, "urlopen", side_effect=failure):
                result = server.questions(self.request, user=self.user)
            self.assertEqual(result["source"], "local")
            self.assertEqual(result["fallback_reason"], "unavailable")
            self.assertEqual(result["questions"], list(server.FALLBACK_QUESTIONS))
            self.assertNotIn("secret", result["warning"])

    def test_invalid_provider_payloads_return_explicit_fallback(self):
        os.environ["OLLAMA_MODEL"] = "test-model"
        duplicate_fields = {"questions": [self.generated["questions"][0]] * 3}
        invented_answer = {"questions": [
            *self.generated["questions"][:2],
            {"field": "data", "text": "Доступна история заказов"},
        ]}
        responses = (b"not-json", b"{}", b'{"message":{"content":"not-json"}}',
                     json.dumps({"message": {"content": json.dumps(duplicate_fields)}}).encode(),
                     json.dumps({"message": {"content": json.dumps(invented_answer)}}).encode())
        for payload in responses:
            with self.subTest(payload=payload), patch.object(server, "urlopen", return_value=io.BytesIO(payload)):
                result = server.questions(self.request, user=self.user)
            self.assertEqual(result["fallback_reason"], "invalid_response")
            self.assertEqual(result["source"], "local")
            self.assertIn("некорректный", result["warning"])


if __name__ == "__main__":
    unittest.main()
