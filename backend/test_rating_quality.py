"""Readability checks reject filler while keeping transparent field weights."""

import os
import tempfile
import unittest
from contextlib import closing
from unittest.mock import patch

from .db import connect
from .rating import EDITABLE_FIELDS, evaluate, field_issue, reconcile_ratings
from .seed import seed_demo


class RatingReadabilityTests(unittest.TestCase):
    def test_random_single_words_and_placeholders_never_earn_points(self):
        for text in ("", " ", "asdasd", "jkokkp", "ijijji", "asd", "qweqwe123", "test", "тест", "foo bar", "asdf qwerty", "ааааа ббббб", "abcabcabc defdefdef"):
            with self.subTest(text=text):
                result = evaluate({field: text for field in EDITABLE_FIELDS})
                self.assertEqual(result["score"], 0)
                self.assertEqual(len(result["missing_fields"]), 9)
                self.assertEqual(set(result["field_issues"]), set(result["missing_fields"]))

    def test_legitimate_russian_and_english_text_and_contacts(self):
        for text in ("Операторы поддержки", "Ответ за 10 минут", "Данные CSV", "Provide order history", "SQL database", "Провести тест прототипа"):
            with self.subTest(text=text):
                self.assertIsNone(field_issue("data", text))
        for contact in ("clinic@example.test", "+7 (701) 234-56-78", "@support_team", "https://business.test/contact", "Иван Ли"):
            with self.subTest(contact=contact):
                self.assertIsNone(field_issue("contact", contact))
        for contact in ("asdasd", "jkokkp", "@qweqwe", "111111111", "123", "https://[broken", "not-an-email"):
            with self.subTest(contact=contact):
                self.assertIsNotNone(field_issue("contact", contact))
        self.assertIsNotNone(field_issue("users", "Покупатели"))
        self.assertIsNotNone(field_issue("users", "Покупатели покупатели"))

    def test_valid_fields_keep_exact_weights_and_confirmation_rule(self):
        card = {field: "Подробное описание" for field in EDITABLE_FIELDS}
        card["contact"] = "contact@business.test"
        self.assertEqual(evaluate(card)["score"], 100)
        self.assertEqual(evaluate(card, confirmed=False)["score"], 0)
        card["data"] = "asdasd"
        result = evaluate(card)
        self.assertEqual(result["score"], 80)
        self.assertEqual(result["missing_fields"], ["data"])
        self.assertEqual(result["score_breakdown"]["data"], {"earned": 0, "max": 20})

    def test_reconciliation_corrects_stale_scores_without_changing_content(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"APP_DB_PATH": f"{directory}/test.db"}):
            seed_demo()
            with closing(connect()) as connection, connection:
                connection.execute("UPDATE tasks SET title = 'Пользовательская карточка', context = 'asdasd', need = 'jkokkp', users = 'ijijji', data = 'qweqwe123', constraints = 'asd', expected_result = 'asd', success_criteria = 'asd', contact = 'asd', interaction_format = 'asd', score = 100 WHERE id = 7")
                before = dict(connection.execute("SELECT * FROM tasks WHERE id = 7").fetchone())
                self.assertEqual(reconcile_ratings(connection), 1)
                after = dict(connection.execute("SELECT * FROM tasks WHERE id = 7").fetchone())
                self.assertEqual(after, {**before, "score": 0})
                self.assertEqual(reconcile_ratings(connection), 0)
                self.assertEqual(connection.execute("SELECT score FROM tasks WHERE id = 10").fetchone()[0], 100)


if __name__ == "__main__":
    unittest.main()
