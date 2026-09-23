"""Rating of business-confirmed task fields."""

from datetime import datetime, timezone
from typing import Mapping
import sqlite3


CRITERIA = {
    "context_and_need": {"context": 10, "need": 10},
    "data": {"data": 20},
    "expected_result": {"expected_result": 15},
    "success_criteria": {"success_criteria": 15},
    "constraints": {"constraints": 10},
    "users": {"users": 10},
    "business_contact": {"contact": 5, "interaction_format": 5},
}
EDITABLE_FIELDS = (
    "title", "topic", "context", "need", "users", "data", "constraints",
    "expected_result", "success_criteria", "contact", "interaction_format",
)


def level_for(score: int) -> str:
    if score < 40:
        return "draft"
    if score < 70:
        return "working"
    if score < 90:
        return "ready"
    return "priority"


def evaluate(task: Mapping, confirmed: bool = True) -> dict:
    breakdown = {}
    missing = []
    score = 0
    for criterion, fields in CRITERIA.items():
        earned = 0
        for name, weight in fields.items():
            if str(task[name] or "").strip():
                if confirmed:
                    earned += weight
            else:
                missing.append(name)
        maximum = sum(fields.values())
        breakdown[criterion] = {"earned": earned, "max": maximum}
        score += earned
    return {
        "score": score,
        "level": level_for(score),
        "score_breakdown": breakdown,
        "missing_fields": missing,
    }


def recalculate_task(connection: sqlite3.Connection, task_id: int) -> dict:
    """Persist the score after a confirmed edit; call inside the caller's transaction."""
    row = connection.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if row is None:
        raise ValueError(f"Task {task_id} does not exist")
    result = evaluate(row, confirmed=bool(row["confirmed_at"]))
    connection.execute("UPDATE tasks SET score = ? WHERE id = ?", (result["score"], task_id))
    return result


def confirm_task(connection: sqlite3.Connection, task_id: int, updates: Mapping) -> dict:
    """Save business-approved field changes and recalculate in the same transaction."""
    invalid = set(updates) - set(EDITABLE_FIELDS)
    if invalid:
        raise ValueError(f"Fields cannot be confirmed: {', '.join(sorted(invalid))}")
    if connection.execute("SELECT 1 FROM tasks WHERE id = ?", (task_id,)).fetchone() is None:
        raise ValueError(f"Task {task_id} does not exist")
    if updates:
        columns = ", ".join(f"{name} = ?" for name in updates)
        connection.execute(
            f"UPDATE tasks SET {columns} WHERE id = ?",
            (*updates.values(), task_id),
        )
    connection.execute(
        "UPDATE tasks SET confirmed_at = ? WHERE id = ?",
        (datetime.now(timezone.utc).isoformat(), task_id),
    )
    return recalculate_task(connection, task_id)
