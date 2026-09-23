"""Task builder API. Only this server calls the optional external AI endpoint."""

import json
import os
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import APIRouter, FastAPI, HTTPException
from pydantic import BaseModel, Field

if (Path(__file__).resolve().parents[1] / "backend" / "db.py").exists():
    from backend import db as shared_db
else:
    shared_db = None
if (Path(__file__).resolve().parents[1] / "backend" / "rating.py").exists():
    from backend import rating as shared_rating
else:
    shared_rating = None


TEXT_FIELDS = (
    "title", "topic", "context", "need", "users", "data", "constraints",
    "expected_result", "success_criteria", "contact", "interaction_format",
)
QUESTION_FIELDS = tuple(field for field in TEXT_FIELDS if field != "context")
FALLBACK_QUESTIONS = (
    {"field": "need", "text": "Какую конкретную потребность бизнеса должна закрыть задача?"},
    {"field": "users", "text": "Кто будет пользоваться результатом?"},
    {"field": "expected_result", "text": "Какой результат вы хотите получить от команды?"},
    {"field": "success_criteria", "text": "По каким признакам вы поймёте, что задача решена?"},
    {"field": "data", "text": "Какие данные вы готовы предоставить команде?"},
)
QUESTION_PROMPT = """Ты помогаешь бизнесу уточнить описание задачи для хакатона.
Задай от 3 до 5 открытых, уместных уточняющих вопросов на русском языке.
Не предполагай фактов, которых нет в описании. Не отвечай за пользователя.
Каждый вопрос должен относиться к одному различному полю из списка:
title, topic, need, users, data, constraints, expected_result,
success_criteria, contact, interaction_format.
Верни только JSON: {"questions":[{"field":"need","text":"..."}]}.
"""

app = FastAPI(title="Task builder API")
router = APIRouter()


class DescriptionInput(BaseModel):
    description: str = Field(min_length=1)


class DraftInput(DescriptionInput):
    answers: dict[str, str]


class CardInput(BaseModel):
    title: str = ""
    topic: str = ""
    context: str = ""
    need: str = ""
    users: str = ""
    data: str = ""
    constraints: str = ""
    expected_result: str = ""
    success_criteria: str = ""
    contact: str = ""
    interaction_format: str = ""


def db_path() -> Path:
    return Path(os.environ.get("TASK_BUILDER_DB_PATH", Path(__file__).with_name("tasks.db")))


def connect() -> sqlite3.Connection:
    if shared_db is not None and "TASK_BUILDER_DB_PATH" not in os.environ:
        shared_db.init_db()
        return shared_db.connect()
    connection = sqlite3.connect(db_path())
    connection.row_factory = sqlite3.Row
    connection.execute("""CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '', topic TEXT NOT NULL DEFAULT '',
        context TEXT NOT NULL DEFAULT '', need TEXT NOT NULL DEFAULT '',
        users TEXT NOT NULL DEFAULT '', data TEXT NOT NULL DEFAULT '',
        constraints TEXT NOT NULL DEFAULT '', expected_result TEXT NOT NULL DEFAULT '',
        success_criteria TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '',
        interaction_format TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
        score INTEGER NOT NULL DEFAULT 0, confirmed_at TEXT
    )""")
    return connection


def get_task(connection: sqlite3.Connection, task_id: int) -> dict:
    row = connection.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    return {key: row[key] for key in ("id", *TEXT_FIELDS, "status", "score", "confirmed_at")}


def validate_questions(payload: object) -> list[dict[str, str]]:
    if not isinstance(payload, dict) or not isinstance(payload.get("questions"), list):
        raise ValueError("Ожидался объект с массивом questions")
    questions = payload["questions"]
    if not 3 <= len(questions) <= 5:
        raise ValueError("Нужно от 3 до 5 вопросов")
    fields = set()
    result = []
    for item in questions:
        if not isinstance(item, dict):
            raise ValueError("Некорректный вопрос")
        field, question = item.get("field"), item.get("text")
        if field not in QUESTION_FIELDS or field in fields or not isinstance(question, str) or not question.strip():
            raise ValueError("Некорректное поле или текст вопроса")
        fields.add(field)
        result.append({"field": field, "text": question.strip()})
    return result


def external_questions(description: str) -> list[dict[str, str]]:
    url, key, model = (os.environ.get(name) for name in ("AI_API_URL", "AI_API_KEY", "AI_MODEL"))
    if not all((url, key, model)):
        raise RuntimeError("AI API не настроен")
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": QUESTION_PROMPT},
            {"role": "user", "content": description},
        ],
        "temperature": 0,
    }
    request = Request(
        url,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=12) as response:
        data = json.load(response)
    content = data["choices"][0]["message"]["content"]
    return validate_questions(json.loads(content))


@router.post("/api/task-builder/questions")
def questions(request: DescriptionInput) -> dict:
    description = request.description.strip()
    if not description:
        raise HTTPException(status_code=422, detail="Введите описание")
    try:
        return {"questions": external_questions(description), "source": "external", "warning": None}
    except (RuntimeError, ValueError, KeyError, IndexError, TypeError, json.JSONDecodeError,
            HTTPError, URLError, TimeoutError, OSError):
        return {
            "questions": list(FALLBACK_QUESTIONS),
            "source": "local",
            "warning": "AI API недоступен или вернул некорректный ответ. Показаны локальные вопросы.",
        }


@router.post("/api/task-builder/drafts", status_code=201)
def create_draft(request: DraftInput) -> dict:
    description = request.description.strip()
    if not description:
        raise HTTPException(status_code=422, detail="Введите описание")
    if any(field not in QUESTION_FIELDS or not isinstance(value, str)
           for field, value in request.answers.items()):
        raise HTTPException(status_code=422, detail="Некорректное поле ответа")
    card = {field: "" for field in TEXT_FIELDS}
    card["context"] = description
    for field, value in request.answers.items():
        card[field] = value.strip()
    with closing(connect()) as connection, connection:
        columns = ", ".join(TEXT_FIELDS)
        placeholders = ", ".join("?" for _ in TEXT_FIELDS)
        cursor = connection.execute(
            f"INSERT INTO tasks ({columns}) VALUES ({placeholders})",
            tuple(card[field] for field in TEXT_FIELDS),
        )
        return get_task(connection, cursor.lastrowid)


@router.get("/api/task-builder/tasks/{task_id}")
def read_task(task_id: int) -> dict:
    with closing(connect()) as connection, connection:
        return get_task(connection, task_id)


@router.put("/api/task-builder/tasks/{task_id}")
def edit_task(task_id: int, card: CardInput) -> dict:
    with closing(connect()) as connection, connection:
        current = get_task(connection, task_id)
        if current["status"] != "draft":
            raise HTTPException(status_code=409, detail="Опубликованную задачу нельзя менять в конструкторе")
        values = card.model_dump()
        connection.execute(
            f"UPDATE tasks SET {', '.join(field + ' = ?' for field in TEXT_FIELDS)}, confirmed_at = NULL, score = 0 WHERE id = ?",
            tuple(values[field].strip() for field in TEXT_FIELDS) + (task_id,),
        )
        return get_task(connection, task_id)


@router.post("/api/task-builder/tasks/{task_id}/confirm")
def confirm_task(task_id: int) -> dict:
    with closing(connect()) as connection, connection:
        current = get_task(connection, task_id)
        if current["status"] != "draft":
            raise HTTPException(status_code=409, detail="Задача уже опубликована")
        if not current["title"].strip():
            raise HTTPException(status_code=422, detail="Укажите название задачи")
        if shared_rating is not None and shared_db is not None and "TASK_BUILDER_DB_PATH" not in os.environ:
            shared_rating.confirm_task(connection, task_id, {})
        else:
            connection.execute(
                "UPDATE tasks SET confirmed_at = ? WHERE id = ?",
                (datetime.now(timezone.utc).isoformat(), task_id),
            )
        return get_task(connection, task_id)


@router.post("/api/task-builder/tasks/{task_id}/publish")
def publish_task(task_id: int) -> dict:
    with closing(connect()) as connection, connection:
        current = get_task(connection, task_id)
        if current["status"] != "draft" or not current["confirmed_at"]:
            raise HTTPException(status_code=409, detail="Сначала подтвердите текущую версию карточки")
        connection.execute("UPDATE tasks SET status = 'published' WHERE id = ?", (task_id,))
        return get_task(connection, task_id)


app.include_router(router)
