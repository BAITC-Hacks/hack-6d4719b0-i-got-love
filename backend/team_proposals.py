"""Team profiles, business decisions, and one-time progress awards."""

import json
from contextlib import closing
from typing import Annotated, Literal
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field

from .db import connect, init_db
from .auth import require_user


PROGRESS_POINTS = 10
router = APIRouter()


class ProposalInput(BaseModel):
    task_id: int = Field(gt=0, le=2**63 - 1)
    team_id: int = Field(gt=0, le=2**63 - 1)
    idea: str = Field(min_length=1, max_length=10000)
    plan: str = Field(min_length=1, max_length=10000)
    duration: str = Field(min_length=1, max_length=200)
    prototype_url: str = Field(min_length=1, max_length=2048)


class DecisionInput(BaseModel):
    decision: Literal["selected", "rejected"]


TEAMS = (
    ("Пиксель Лаб", ["Электронная коммерция", "Пользовательский опыт", "Сервисы"], ["Дизайн интерфейсов", "Исследования", "Прототипирование"], ["Figma", "Webflow"]),
    ("Пульс данных", ["Аналитика", "Электронная коммерция", "Персонализация"], ["Анализ данных", "Метрики", "Сегментация"], ["Python", "SQL", "Metabase"]),
    ("Зелёный стек", ["Устойчивое развитие", "Логистика", "Маркетплейсы"], ["Сервис-дизайн", "Логистика", "Исследование процессов"], ["React", "Node.js", "PostgreSQL"]),
    ("Крафт Код", ["Мобильные сервисы", "Автоматизация", "Малый бизнес"], ["Веб-разработка", "Интеграции", "Быстрое прототипирование"], ["TypeScript", "React", "Vite"]),
    ("Мастера роста", ["Рост продаж", "Лояльность", "Контент"], ["Маркетинговая стратегия", "Копирайтинг", "A/B-тестирование"], ["Figma", "Google Analytics", "Notion"]),
)

DEMO_PROPOSALS = (
    (1, "Сделать очередь обращений понятнее: показать приоритет, тему и время ожидания ответа.", "Проведём интервью с операторами, соберём карту работы с обращением и проверим кликабельный прототип.", "2 недели", ""),
    (2, "Найти причины долгого ответа и предложить прозрачные правила приоритизации обращений.", "Согласуем доступ к обезличенной истории, изучим время обработки и подготовим макет отчёта.", "10 рабочих дней", ""),
    (3, "Сократить передачу обращений между операторами с помощью распределения по темам.", "Изучим процесс поддержки, согласуем правила распределения и проверим прототип на учебных примерах.", "3 недели", ""),
    (4, "Подготовить единый экран оператора с очередью, фильтрами и шаблонами ответов.", "Уточним ограничения интеграции, соберём интерактивный прототип и проверим основные сценарии.", "12 дней", ""),
    (5, "Улучшить первые ответы клиентам: объяснять следующий шаг и ожидаемое время решения.", "Согласуем тон сообщений, подготовим шаблоны и проверим их понятность на учебных обращениях.", "2,5 недели", ""),
)


def seed_demo() -> None:
    """Add five synthetic teams and proposals without overwriting existing data."""
    init_db()
    with closing(connect()) as connection, connection:
        if connection.execute("SELECT COUNT(*) FROM teams").fetchone()[0] == 0:
            connection.executemany(
                "INSERT INTO teams (name, interests, skills, technologies) VALUES (?, ?, ?, ?)",
                [
                    (name, json.dumps(interests, ensure_ascii=False), json.dumps(skills, ensure_ascii=False), json.dumps(technologies, ensure_ascii=False))
                    for name, interests, skills, technologies in TEAMS
                ],
            )

        if connection.execute("SELECT COUNT(*) FROM proposals").fetchone()[0] == 0:
            if connection.execute("SELECT 1 FROM tasks WHERE id = 7 AND status = 'published'").fetchone():
                connection.executemany(
                    """INSERT INTO proposals (task_id, team_id, idea, plan, duration, prototype_url)
                       VALUES (7, ?, ?, ?, ?, ?)""",
                    DEMO_PROPOSALS,
                )


def _team(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "interests": json.loads(row["interests"]),
        "skills": json.loads(row["skills"]),
        "technologies": json.loads(row["technologies"]),
        "points": row["points"],
        "owner_user_id": row["owner_user_id"],
    }


def _proposal(row) -> dict:
    return {
        "id": row["id"],
        "task_id": row["task_id"],
        "team_id": row["team_id"],
        "idea": row["idea"],
        "plan": row["plan"],
        "duration": row["duration"],
        "prototype_url": row["prototype_url"],
        "decision": row["decision"],
        "progress_confirmed": bool(row["progress_confirmed"]),
    }


@router.get("/api/teams")
def list_teams() -> list[dict]:
    with closing(connect()) as connection:
        return [_team(row) for row in connection.execute("SELECT * FROM teams ORDER BY id")]


@router.get("/api/proposals")
def list_proposals(task_id: int | None = Query(default=None, gt=0, le=2**63 - 1)) -> list[dict]:
    query = "SELECT * FROM proposals"
    parameters = ()
    if task_id is not None:
        query += " WHERE task_id = ?"
        parameters = (task_id,)
    query += " ORDER BY id DESC"
    with closing(connect()) as connection:
        return [_proposal(row) for row in connection.execute(query, parameters)]


@router.post("/api/proposals", status_code=201)
def create_proposal(request: ProposalInput, user: dict = Depends(require_user)) -> dict:
    if user["role"] != "team":
        raise HTTPException(status_code=403, detail="Подавать отклик может только команда")
    values = {
        "idea": request.idea.strip(),
        "plan": request.plan.strip(),
        "duration": request.duration.strip(),
        "prototype_url": request.prototype_url.strip(),
    }
    if any(not value for value in values.values()):
        raise HTTPException(status_code=422, detail="Заполните все поля отклика")
    try:
        raw_url = values["prototype_url"]
        prototype_url = urlparse(raw_url)
        if (prototype_url.scheme not in ("https", "http") or not prototype_url.hostname
                or prototype_url.username is not None or prototype_url.password is not None
                or "\\" in raw_url or any(character.isspace() or ord(character) < 32 or ord(character) == 127 for character in raw_url)):
            raise ValueError("Некорректная ссылка")
        prototype_url.port  # Access validates malformed and out-of-range ports.
    except ValueError:
        raise HTTPException(status_code=422, detail="Укажите корректную ссылку на прототип с http:// или https:// без логина и пароля") from None

    with closing(connect()) as connection, connection:
        if connection.execute(
            "SELECT 1 FROM tasks WHERE id = ? AND status = 'published'", (request.task_id,)
        ).fetchone() is None:
            raise HTTPException(status_code=404, detail="Опубликованная задача не найдена")
        if connection.execute("SELECT 1 FROM teams WHERE id = ? AND owner_user_id = ?", (request.team_id, user["id"])).fetchone() is None:
            raise HTTPException(status_code=403, detail="Вы можете подать отклик только от своей команды")
        cursor = connection.execute(
            """INSERT INTO proposals (task_id, team_id, idea, plan, duration, prototype_url)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (request.task_id, request.team_id, values["idea"], values["plan"], values["duration"], values["prototype_url"]),
        )
        row = connection.execute("SELECT * FROM proposals WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return _proposal(row)


@router.patch("/api/proposals/{proposal_id}/decision")
def decide_proposal(proposal_id: Annotated[int, Path(gt=0, le=2**63 - 1)], request: DecisionInput, user: dict = Depends(require_user)) -> dict:
    if user["role"] != "business":
        raise HTTPException(status_code=403, detail="Решение принимает владелец бизнес-задачи")
    with closing(connect()) as connection, connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute("SELECT p.*, t.owner_user_id AS task_owner_id FROM proposals p JOIN tasks t ON t.id = p.task_id WHERE p.id = ?", (proposal_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Отклик не найден")
        if row["task_owner_id"] != user["id"]:
            raise HTTPException(status_code=403, detail="Вы можете принимать решения только по своей задаче")
        if row["progress_confirmed"]:
            raise HTTPException(status_code=409, detail="Подтверждённый этап нельзя изменить")
        if row["decision"] == request.decision:
            return _proposal(row)
        if row["decision"] != "pending":
            raise HTTPException(status_code=409, detail="Для этого отклика уже принято решение")
        connection.execute("UPDATE proposals SET decision = ? WHERE id = ?", (request.decision, proposal_id))
        updated = connection.execute("SELECT * FROM proposals WHERE id = ?", (proposal_id,)).fetchone()
        return _proposal(updated)


@router.post("/api/proposals/{proposal_id}/progress")
def confirm_progress(proposal_id: Annotated[int, Path(gt=0, le=2**63 - 1)], user: dict = Depends(require_user)) -> dict:
    if user["role"] != "business":
        raise HTTPException(status_code=403, detail="Этап подтверждает владелец бизнес-задачи")
    with closing(connect()) as connection, connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute("SELECT p.*, t.owner_user_id AS task_owner_id FROM proposals p JOIN tasks t ON t.id = p.task_id WHERE p.id = ?", (proposal_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Отклик не найден")
        if row["task_owner_id"] != user["id"]:
            raise HTTPException(status_code=403, detail="Вы можете подтверждать этапы только по своей задаче")
        if row["progress_confirmed"]:
            return _proposal(row)
        if row["decision"] != "selected":
            raise HTTPException(status_code=409, detail="Сначала выберите команду вручную")
        connection.execute("UPDATE proposals SET progress_confirmed = 1 WHERE id = ?", (proposal_id,))
        connection.execute("UPDATE teams SET points = points + ? WHERE id = ?", (PROGRESS_POINTS, row["team_id"]))
        updated = connection.execute("SELECT * FROM proposals WHERE id = ?", (proposal_id,)).fetchone()
        return _proposal(updated)


if __name__ == "__main__":
    seed_demo()
