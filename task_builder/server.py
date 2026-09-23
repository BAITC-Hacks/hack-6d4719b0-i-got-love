"""Task builder API with server-side external or local Ollama questions."""

import json
import os
import sqlite3
from contextlib import closing
from http.client import HTTPException as HTTPClientException
from threading import BoundedSemaphore
from typing import Annotated, Literal
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from fastapi import APIRouter, Depends, HTTPException, Path as APIPath
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from backend import db as shared_db
from backend import rating as shared_rating
from backend.auth import require_user


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
                "text": {"type": "string", "minLength": 1, "maxLength": 500, "pattern": r"\?$"},
            },
            "required": ["field", "text"], "additionalProperties": False,
        },
    }},
    "required": ["questions"], "additionalProperties": False,
}

class NoAIRedirects(HTTPRedirectHandler):
    """Do not forward descriptions or credentials to a redirected destination."""

    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


urlopen = build_opener(NoAIRedirects()).open
AI_RESPONSE_LIMIT = 64 * 1024
AI_GENERATION_SLOTS = BoundedSemaphore(2)

router = APIRouter()


class DescriptionInput(BaseModel):
    description: str = Field(min_length=1, max_length=10000)


class DraftInput(DescriptionInput):
    answers: dict[str, Annotated[str, Field(max_length=10000)]] = Field(max_length=len(QUESTION_FIELDS))


class CardInput(BaseModel):
    model_config = ConfigDict(str_max_length=10000)

    title: str = Field(default="", max_length=200)
    topic: str = Field(default="", max_length=100)
    context: str = ""
    need: str = ""
    users: str = ""
    data: str = ""
    constraints: str = ""
    expected_result: str = ""
    success_criteria: str = ""
    contact: str = Field(default="", max_length=500)
    interaction_format: str = Field(default="", max_length=1000)


def connect() -> sqlite3.Connection:
    shared_db.init_db()
    return shared_db.connect()


def require_business(user: dict) -> None:
    if user["role"] != "business":
        raise HTTPException(status_code=403, detail="Конструктор доступен только представителям бизнеса")


def require_task_owner(task: dict, user: dict) -> None:
    require_business(user)
    if task["owner_user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Вы можете изменять только свои задачи")


def get_task(connection: sqlite3.Connection, task_id: int) -> dict:
    row = connection.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    return task_response(row)


def task_response(row: sqlite3.Row) -> dict:
    task = {key: row[key] for key in ("id", *TEXT_FIELDS, "status", "score", "confirmed_at", "owner_user_id")}
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
        if not isinstance(field, str) or field not in QUESTION_FIELDS or field in fields or not isinstance(question, str) or len(question) > 500 or not question.strip().endswith("?"):
            raise ValueError("Некорректное поле или текст вопроса")
        question.encode("utf-8")  # Reject malformed Unicode before JSON response encoding.
        fields.add(field)
        result.append({"field": field, "text": question.strip()})
    return result


def read_ai_response(response) -> object:
    payload = response.read(AI_RESPONSE_LIMIT + 1)
    if len(payload) > AI_RESPONSE_LIMIT:
        raise ValueError("Ответ ИИ превышает допустимый размер")
    return json.loads(payload)


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
        data = read_ai_response(response)
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
        data = read_ai_response(response)
    return validate_questions(json.loads(data["message"]["content"]))


@router.post("/api/task-builder/questions")
def questions(request: DescriptionInput, user: dict = Depends(require_user)) -> dict:
    require_business(user)
    description = request.description.strip()
    if not description:
        raise HTTPException(status_code=422, detail="Введите описание")
    external_configured = all(os.environ.get(name, "").strip() for name in ("AI_API_URL", "AI_API_KEY", "AI_MODEL"))
    source = "ollama" if not external_configured and os.environ.get("OLLAMA_MODEL", "").strip() else "external"
    if not AI_GENERATION_SLOTS.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="ИИ сейчас обрабатывает другие запросы. Попробуйте ещё раз чуть позже.", headers={"Retry-After": "5"})
    try:
        result = ollama_questions(description) if source == "ollama" else external_questions(description)
        return {"questions": result, "source": source, "warning": None, "fallback_reason": None}
    except RuntimeError:
        reason = "not_configured"
        warning = "ИИ пока не подключён. Сейчас доступны стандартные вопросы — вы можете продолжить работу."
    except (HTTPError, URLError, TimeoutError, OSError, HTTPClientException):
        reason = "unavailable"
        warning = "Не удалось связаться с ИИ. Показаны стандартные вопросы — попробуйте получить уточняющие вопросы позже."
    except (ValueError, KeyError, IndexError, TypeError):
        reason = "invalid_response"
        warning = "ИИ вернул некорректный ответ. Показаны стандартные вопросы — вы можете продолжить работу."
    finally:
        AI_GENERATION_SLOTS.release()
    return {"questions": list(FALLBACK_QUESTIONS), "source": "local", "warning": warning, "fallback_reason": reason}


@router.post("/api/task-builder/drafts", status_code=201)
def create_draft(request: DraftInput, user: dict = Depends(require_user)) -> dict:
    require_business(user)
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
    try:
        CardInput.model_validate(card)
    except ValidationError:
        raise HTTPException(status_code=422, detail="Поле карточки превышает допустимую длину") from None
    with closing(connect()) as connection, connection:
        columns = ", ".join(TEXT_FIELDS)
        placeholders = ", ".join("?" for _ in TEXT_FIELDS)
        cursor = connection.execute(
            f"INSERT INTO tasks ({columns}, owner_user_id) VALUES ({placeholders}, ?)",
            tuple(card[field] for field in TEXT_FIELDS) + (user["id"],),
        )
        return get_task(connection, cursor.lastrowid)


@router.get("/api/task-builder/tasks")
def list_tasks(status: Literal["draft", "published"] | None = None, user: dict = Depends(require_user)) -> dict:
    require_business(user)
    query = "SELECT * FROM tasks WHERE owner_user_id = ?"
    parameters = (user["id"],)
    if status is not None:
        query += " AND status = ?"
        parameters += (status,)
    with closing(connect()) as connection:
        items = [task_response(row) for row in connection.execute(query + " ORDER BY id DESC", parameters)]
    return {"items": items, "total": len(items)}


@router.get("/api/task-builder/tasks/{task_id}")
def read_task(task_id: Annotated[int, APIPath(gt=0, le=2**63 - 1)], user: dict = Depends(require_user)) -> dict:
    require_business(user)
    with closing(connect()) as connection, connection:
        current = get_task(connection, task_id)
        require_task_owner(current, user)
        return current


@router.put("/api/task-builder/tasks/{task_id}")
def edit_task(task_id: Annotated[int, APIPath(gt=0, le=2**63 - 1)], card: CardInput, user: dict = Depends(require_user)) -> dict:
    require_business(user)
    with closing(connect()) as connection, connection:
        connection.execute("BEGIN IMMEDIATE")
        current = get_task(connection, task_id)
        require_task_owner(current, user)
        if current["status"] != "draft":
            raise HTTPException(status_code=409, detail="Опубликованную задачу нельзя менять в конструкторе")
        values = card.model_dump()
        connection.execute(
            f"UPDATE tasks SET {', '.join(field + ' = ?' for field in TEXT_FIELDS)}, confirmed_at = NULL, score = 0 WHERE id = ?",
            tuple(values[field].strip() for field in TEXT_FIELDS) + (task_id,),
        )
        return get_task(connection, task_id)


@router.put("/api/task-builder/tasks/{task_id}/confirmed")
def edit_confirmed_task(task_id: Annotated[int, APIPath(gt=0, le=2**63 - 1)], card: CardInput, user: dict = Depends(require_user)) -> dict:
    require_business(user)
    """Save an explicitly approved published edit without hiding its proposals."""
    values = {field: value.strip() for field, value in card.model_dump().items()}
    with closing(connect()) as connection, connection:
        connection.execute("BEGIN IMMEDIATE")
        current = get_task(connection, task_id)
        require_task_owner(current, user)
        if current["status"] != "published":
            raise HTTPException(status_code=409, detail="Сначала подтвердите и опубликуйте черновик")
        if not values["title"]:
            raise HTTPException(status_code=422, detail="Укажите название задачи")
        shared_rating.confirm_task(connection, task_id, values)
        return get_task(connection, task_id)


@router.post("/api/task-builder/tasks/{task_id}/confirm")
def confirm_task(task_id: Annotated[int, APIPath(gt=0, le=2**63 - 1)], user: dict = Depends(require_user)) -> dict:
    require_business(user)
    with closing(connect()) as connection, connection:
        connection.execute("BEGIN IMMEDIATE")
        current = get_task(connection, task_id)
        require_task_owner(current, user)
        if current["status"] != "draft":
            raise HTTPException(status_code=409, detail="Задача уже опубликована")
        if not current["title"].strip():
            raise HTTPException(status_code=422, detail="Укажите название задачи")
        shared_rating.confirm_task(connection, task_id, {})
        return get_task(connection, task_id)


@router.post("/api/task-builder/tasks/{task_id}/publish")
def publish_task(task_id: Annotated[int, APIPath(gt=0, le=2**63 - 1)], user: dict = Depends(require_user)) -> dict:
    require_business(user)
    with closing(connect()) as connection, connection:
        connection.execute("BEGIN IMMEDIATE")
        current = get_task(connection, task_id)
        require_task_owner(current, user)
        if current["status"] == "published":
            return current
        if not current["confirmed_at"]:
            raise HTTPException(status_code=409, detail="Сначала подтвердите текущую версию карточки")
        connection.execute("UPDATE tasks SET status = 'published' WHERE id = ?", (task_id,))
        return get_task(connection, task_id)
