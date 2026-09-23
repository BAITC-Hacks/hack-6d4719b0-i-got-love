"""Task builder API with server-side external or local Ollama questions."""

import json
import os
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
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
QUESTION_PROMPT = """Ты интервьюируешь представителя бизнеса перед хакатоном.
Задай ровно 3 коротких уточняющих вопроса на русском языке по его описанию.
Каждый text — вопрос к человеку, начинается с вопросительного слова и заканчивается знаком ?.
Спрашивай недостающие конкретные сведения, а не пересказывай уже известную проблему.
Запрещено отвечать за человека, дописывать факты, утверждать наличие данных или обещать результаты.
Уточняй только то, чего нет в описании. Если данные неизвестны, спроси, какие данные доступны.
Выбери 3 разных поля из списка: need, users, data, constraints, expected_result,
success_criteria, contact, interaction_format, title, topic.
Смысл полей: need — потребность бизнеса; users — пользователи решения;
data — доступные материалы; constraints — границы и ограничения;
expected_result — конкретный результат работы команды (например, прототип);
success_criteria — измеримые признаки успеха; contact — контакт представителя бизнеса;
interaction_format — как бизнес будет консультировать студенческую команду, а не канал общения с клиентами;
title — название задачи; topic — её отрасль.
Пример формата (вопросы адаптируй к описанию пользователя):
{"questions":[{"field":"need","text":"Какой этап процесса сейчас вызывает больше всего трудностей?"},
{"field":"data","text":"Какие данные о процессе вы можете предоставить команде?"},
{"field":"success_criteria","text":"Какое изменение показателей будет означать успех решения?"}]}
Верни только JSON с questions, без ответов и пояснений.
"""
QUESTION_SCHEMA = {
    "type": "object",
    "properties": {"questions": {
        "type": "array", "minItems": 3, "maxItems": 5,
        "items": {
            "type": "object",
            "properties": {
                "field": {"type": "string", "enum": list(QUESTION_FIELDS)},
                "text": {"type": "string", "minLength": 1, "pattern": r"\?$"},
            },
            "required": ["field", "text"], "additionalProperties": False,
        },
    }},
    "required": ["questions"], "additionalProperties": False,
}

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
    return task_response(row)


def task_response(row: sqlite3.Row) -> dict:
    task = {key: row[key] for key in ("id", *TEXT_FIELDS, "status", "score", "confirmed_at")}
    if shared_rating is not None:
        task.update(shared_rating.evaluate(task, confirmed=bool(task["confirmed_at"])))
        task["rating_preview"] = shared_rating.evaluate(task)
    return task


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
        if not isinstance(field, str) or field not in QUESTION_FIELDS or field in fields or not isinstance(question, str) or not question.strip().endswith("?"):
            raise ValueError("Некорректное поле или текст вопроса")
        fields.add(field)
        result.append({"field": field, "text": question.strip()})
    return result


def external_questions(description: str) -> list[dict[str, str]]:
    url, key, model = (os.environ.get(name, "").strip() for name in ("AI_API_URL", "AI_API_KEY", "AI_MODEL"))
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


def ollama_questions(description: str) -> list[dict[str, str]]:
    model = os.environ.get("OLLAMA_MODEL", "").strip()
    if not model:
        raise RuntimeError("Локальная модель не настроена")
    base_url = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": QUESTION_PROMPT},
            {"role": "user", "content": description},
        ],
        "stream": False,
        "format": QUESTION_SCHEMA,
        "options": {"temperature": 0, "num_predict": 700},
    }
    request = Request(
        f"{base_url}/api/chat",
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=60) as response:
        data = json.load(response)
    return validate_questions(json.loads(data["message"]["content"]))


@router.post("/api/task-builder/questions")
def questions(request: DescriptionInput) -> dict:
    description = request.description.strip()
    if not description:
        raise HTTPException(status_code=422, detail="Введите описание")
    external_configured = all(os.environ.get(name, "").strip() for name in ("AI_API_URL", "AI_API_KEY", "AI_MODEL"))
    source = "ollama" if not external_configured and os.environ.get("OLLAMA_MODEL", "").strip() else "external"
    try:
        result = ollama_questions(description) if source == "ollama" else external_questions(description)
        return {"questions": result, "source": source, "warning": None, "fallback_reason": None}
    except RuntimeError:
        reason = "not_configured"
        warning = "ИИ пока не подключён. Сейчас доступны стандартные вопросы — вы можете продолжить работу."
    except (HTTPError, URLError, TimeoutError, OSError):
        reason = "unavailable"
        warning = "Не удалось связаться с ИИ. Показаны стандартные вопросы — попробуйте получить уточняющие вопросы позже."
    except (ValueError, KeyError, IndexError, TypeError):
        reason = "invalid_response"
        warning = "ИИ вернул некорректный ответ. Показаны стандартные вопросы — вы можете продолжить работу."
    return {"questions": list(FALLBACK_QUESTIONS), "source": "local", "warning": warning, "fallback_reason": reason}


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


@router.get("/api/task-builder/tasks")
def list_tasks(status: Literal["draft", "published"] | None = None) -> dict:
    query = "SELECT * FROM tasks"
    parameters = ()
    if status is not None:
        query += " WHERE status = ?"
        parameters = (status,)
    with closing(connect()) as connection:
        items = [task_response(row) for row in connection.execute(query + " ORDER BY id DESC", parameters)]
    return {"items": items, "total": len(items)}


@router.get("/api/task-builder/tasks/{task_id}")
def read_task(task_id: int) -> dict:
    with closing(connect()) as connection, connection:
        return get_task(connection, task_id)


@router.put("/api/task-builder/tasks/{task_id}")
def edit_task(task_id: int, card: CardInput) -> dict:
    with closing(connect()) as connection, connection:
        connection.execute("BEGIN IMMEDIATE")
        current = get_task(connection, task_id)
        if current["status"] != "draft":
            raise HTTPException(status_code=409, detail="Опубликованную задачу нельзя менять в конструкторе")
        values = card.model_dump()
        connection.execute(
            f"UPDATE tasks SET {', '.join(field + ' = ?' for field in TEXT_FIELDS)}, confirmed_at = NULL, score = 0 WHERE id = ?",
            tuple(values[field].strip() for field in TEXT_FIELDS) + (task_id,),
        )
        return get_task(connection, task_id)


@router.put("/api/task-builder/tasks/{task_id}/confirmed")
def edit_confirmed_task(task_id: int, card: CardInput) -> dict:
    """Save an explicitly approved published edit without hiding its proposals."""
    values = {field: value.strip() for field, value in card.model_dump().items()}
    with closing(connect()) as connection, connection:
        connection.execute("BEGIN IMMEDIATE")
        current = get_task(connection, task_id)
        if current["status"] != "published":
            raise HTTPException(status_code=409, detail="Сначала подтвердите и опубликуйте черновик")
        if not values["title"]:
            raise HTTPException(status_code=422, detail="Укажите название задачи")
        if shared_rating is not None:
            shared_rating.confirm_task(connection, task_id, values)
        else:
            connection.execute(
                f"UPDATE tasks SET {', '.join(field + ' = ?' for field in TEXT_FIELDS)}, confirmed_at = ? WHERE id = ?",
                tuple(values[field] for field in TEXT_FIELDS) + (datetime.now(timezone.utc).isoformat(), task_id),
            )
        return get_task(connection, task_id)


@router.post("/api/task-builder/tasks/{task_id}/confirm")
def confirm_task(task_id: int) -> dict:
    with closing(connect()) as connection, connection:
        connection.execute("BEGIN IMMEDIATE")
        current = get_task(connection, task_id)
        if current["status"] != "draft":
            raise HTTPException(status_code=409, detail="Задача уже опубликована")
        if not current["title"].strip():
            raise HTTPException(status_code=422, detail="Укажите название задачи")
        if shared_rating is not None:
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
        connection.execute("BEGIN IMMEDIATE")
        current = get_task(connection, task_id)
        if current["status"] == "published":
            return current
        if not current["confirmed_at"]:
            raise HTTPException(status_code=409, detail="Сначала подтвердите текущую версию карточки")
        connection.execute("UPDATE tasks SET status = 'published' WHERE id = ?", (task_id,))
        return get_task(connection, task_id)


app.include_router(router)
