"""Rating of business-confirmed task fields."""

from datetime import datetime, timezone
import json
from pathlib import Path
import re
from typing import Mapping
import sqlite3
from urllib.parse import urlparse


RULES = json.loads(Path(__file__).with_name("rating_rules.json").read_text(encoding="utf-8"))
PLACEHOLDERS = set(RULES["placeholder_words"])
ACRONYMS = set(RULES["allowed_acronyms"])


def readable_words(value: str) -> list[str]:
    """A transparent shape check, not a semantic or factual quality assessment."""
    result = []
    for word in re.findall(r"[^\W\d_]+", value.casefold()):
        if len(word) < 2 or word in PLACEHOLDERS:
            continue
        if any(len(word) % len(base) == 0 and word == base * (len(word) // len(base)) for base in PLACEHOLDERS):
            continue
        if any(len(word) >= size * 3 and len(word) % size == 0 and word == word[:size] * (len(word) // size) for size in (1, 2, 3)):
            continue
        if re.fullmatch(r"[a-zа-яё]+", word) and not re.search(r"[aeiouyаеёиоуыэюя]", word) and word not in ACRONYMS:
            continue
        result.append(word)
    return result


def field_issue(name: str, value: object) -> str | None:
    text = str(value or "").strip()
    if not text:
        return RULES["empty_reason"]
    words = readable_words(text)
    if name == "contact":
        if re.fullmatch(r"[^@\s]+@(?:[\w-]+\.)+[\w-]{2,}", text):
            return None
        digits = re.sub(r"\D", "", text)
        if re.fullmatch(r"\+?[\d()\s.\-]+", text) and 7 <= len(digits) <= 15 and len(set(digits)) > 1:
            return None
        if re.fullmatch(r"@[a-zA-Z][a-zA-Z0-9_]{4,31}", text) and words:
            return None
        try:
            url = urlparse(text)
            if (url.scheme in ("http", "https") and url.hostname and url.username is None
                    and "\\" not in text and not any(character.isspace() or ord(character) < 32 for character in text)):
                url.port
                return None
        except ValueError:
            pass
        if len(text.split()) >= 2 and re.fullmatch(r"[^\W\d_]+(?:[\s'’-][^\W\d_]+)+", text) and len(set(words)) >= RULES["min_distinct_words"]:
            return None
        return RULES["contact_reason"]
    if not words:
        return RULES["placeholder_reason"]
    if len(set(words)) < RULES["min_distinct_words"] or sum(map(len, words)) < RULES["min_letters"]:
        return RULES["detail_reason"]
    return None


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
    issues = {}
    score = 0
    for criterion, fields in CRITERIA.items():
        earned = 0
        for name, weight in fields.items():
            issue = field_issue(name, task[name])
            if issue is None:
                if confirmed:
                    earned += weight
            else:
                missing.append(name)
                issues[name] = issue
        maximum = sum(fields.values())
        breakdown[criterion] = {"earned": earned, "max": maximum}
        score += earned
    return {
        "score": score,
        "level": level_for(score),
        "score_breakdown": breakdown,
        "missing_fields": missing,
        "field_issues": issues,
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


def reconcile_ratings(connection: sqlite3.Connection) -> int:
    """Refresh persisted scores with current rules without changing users' text."""
    changed = 0
    for row in connection.execute("SELECT * FROM tasks").fetchall():
        score = evaluate(row, confirmed=bool(row["confirmed_at"]))["score"]
        if score != row["score"]:
            connection.execute("UPDATE tasks SET score = ? WHERE id = ?", (score, row["id"]))
            changed += 1
    return changed
