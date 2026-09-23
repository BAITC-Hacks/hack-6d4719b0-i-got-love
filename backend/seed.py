"""Synthetic tasks for a fresh hackathon demo database."""

from datetime import datetime, timezone
from contextlib import closing

from .db import connect, init_db
from .rating import recalculate_task


TASK_COLUMNS = (
    "id", "title", "topic", "context", "need", "users", "data",
    "constraints", "expected_result", "success_criteria", "contact",
    "interaction_format", "status", "confirmed_at",
)


def seed_demo() -> None:
    init_db()
    confirmed_at = datetime.now(timezone.utc).isoformat()
    drafts = [
        {"id": 1, "title": "Improve workshop booking", "topic": "Services", "context": "Customers call to book"},
        {"id": 2, "title": "Track school supplies", "topic": "Education", "need": "Avoid stockouts"},
        {"id": 3, "title": "Help local deliveries", "topic": "Logistics", "users": "Dispatchers"},
        {"id": 4, "title": "Review clinic queues", "topic": "Healthcare", "data": "Anonymous wait times"},
        {"id": 5, "title": "Plan volunteer shifts", "topic": "Community", "constraints": "Mobile-friendly"},
    ]
    published = [
        {"id": 6, "title": "Explore park signage", "topic": "Community"},
        {"id": 7, "title": "Shorten support replies", "topic": "Services", "context": "Replies are slow", "need": "Prioritize tickets", "users": "Support agents"},
        {"id": 8, "title": "Forecast supply demand", "topic": "Education", "context": "Demand changes each term", "need": "Plan orders", "users": "School staff", "data": "Anonymous order history"},
        {"id": 9, "title": "Route local deliveries", "topic": "Logistics", "context": "Routes overlap", "need": "Reduce travel time", "users": "Dispatchers", "data": "Delivery locations", "expected_result": "Route prototype", "constraints": "No driver tracking"},
        {"id": 10, "title": "Improve clinic check-in", "topic": "Healthcare", "context": "Morning queues are long", "need": "Simplify check-in", "users": "Patients and receptionists", "data": "Anonymous visit counts", "constraints": "No personal health data", "expected_result": "Check-in prototype", "success_criteria": "Median wait under 10 minutes", "contact": "clinic@example.test", "interaction_format": "Weekly demo call"},
    ]
    with closing(connect()) as connection, connection:
        if connection.execute("SELECT 1 FROM tasks LIMIT 1").fetchone():
            return
        placeholders = ", ".join("?" for _ in TASK_COLUMNS)
        columns = ", ".join(TASK_COLUMNS)
        for draft in drafts:
            values = {**draft, "status": "draft", "confirmed_at": None}
            connection.execute(
                f"INSERT INTO tasks ({columns}) VALUES ({placeholders})",
                tuple(values.get(column, "") for column in TASK_COLUMNS),
            )
        for card in published:
            values = {**card, "status": "published", "confirmed_at": confirmed_at}
            connection.execute(
                f"INSERT INTO tasks ({columns}) VALUES ({placeholders})",
                tuple(values.get(column, "") for column in TASK_COLUMNS),
            )
            recalculate_task(connection, card["id"])


if __name__ == "__main__":
    seed_demo()
