import os
import tempfile
import unittest
from contextlib import closing

from fastapi import HTTPException

from .db import connect
from .seed import seed_demo as seed_tasks
from .team_proposals import (
    DecisionInput,
    ProposalInput,
    confirm_progress,
    create_proposal,
    decide_proposal,
    list_proposals,
    list_teams,
    seed_demo,
)


class TeamProposalTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.previous_path = os.environ.get("APP_DB_PATH")
        os.environ["APP_DB_PATH"] = os.path.join(self.directory.name, "test.db")
        seed_tasks()
        seed_demo()

    def tearDown(self):
        if self.previous_path is None:
            os.environ.pop("APP_DB_PATH", None)
        else:
            os.environ["APP_DB_PATH"] = self.previous_path
        self.directory.cleanup()

    def test_demo_seeds_five_teams_and_proposals(self):
        self.assertEqual(len(list_teams()), 5)
        self.assertEqual(len(list_proposals(task_id=7)), 5)

    def test_accepts_multiple_proposals_without_a_limit(self):
        for index in range(20):
            create_proposal(ProposalInput(
                task_id=7,
                team_id=1,
                idea=f"Идея {index}",
                plan="Проверка прототипа",
                duration="5 дней",
                prototype_url="https://example.com/prototype",
            ))
        self.assertEqual(len(list_proposals(task_id=7)), 25)

    def test_business_can_select_multiple_or_reject_and_award_once(self):
        with closing(connect()) as connection:
            task_score = connection.execute("SELECT score FROM tasks WHERE id = 7").fetchone()[0]
        decide_proposal(1, DecisionInput(decision="selected"))
        decide_proposal(2, DecisionInput(decision="selected"))
        decide_proposal(3, DecisionInput(decision="rejected"))
        self.assertEqual([item["decision"] for item in list_proposals(task_id=7) if item["id"] in (1, 2, 3)].count("selected"), 2)

        first = confirm_progress(1)
        repeated = confirm_progress(1)
        self.assertTrue(first["progress_confirmed"])
        self.assertTrue(repeated["progress_confirmed"])
        with closing(connect()) as connection:
            points = connection.execute("SELECT points FROM teams WHERE id = 1").fetchone()[0]
            saved_task_score = connection.execute("SELECT score FROM tasks WHERE id = 7").fetchone()[0]
        self.assertEqual(points, 10)
        self.assertEqual(saved_task_score, task_score)

    def test_pending_proposal_cannot_receive_points(self):
        with self.assertRaises(HTTPException) as raised:
            confirm_progress(1)
        self.assertEqual(raised.exception.status_code, 409)
        with closing(connect()) as connection:
            points = connection.execute("SELECT points FROM teams WHERE id = 1").fetchone()[0]
        self.assertEqual(points, 0)

    def test_rejects_invalid_prototype_link(self):
        with self.assertRaises(HTTPException) as raised:
            create_proposal(ProposalInput(
                task_id=7,
                team_id=1,
                idea="Проверить сценарий",
                plan="Собрать прототип",
                duration="5 дней",
                prototype_url="https://",
            ))
        self.assertEqual(raised.exception.status_code, 422)


if __name__ == "__main__":
    unittest.main()
