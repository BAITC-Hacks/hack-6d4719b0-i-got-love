"""Team profiles, business decisions, and one-time progress awards."""

import json
from contextlib import closing
from typing import Literal
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from .db import connect, init_db


PROGRESS_POINTS = 10
router = APIRouter()


class ProposalInput(BaseModel):
    task_id: int = Field(gt=0)
    team_id: int = Field(gt=0)
    idea: str = Field(min_length=1)
    plan: str = Field(min_length=1)
    duration: str = Field(min_length=1)
    prototype_url: str = Field(min_length=1)


class DecisionInput(BaseModel):
    decision: Literal["selected", "rejected"]


TEAMS = (
    ("Pixel Lab", ["E-commerce", "Пользовательский опыт", "Сервисы"], ["UX/UI-дизайн", "Исследования", "Прототипирование"], ["Figma", "Webflow"]),
    ("Data Pulse", ["Аналитика", "E-commerce", "Персонализация"], ["Анализ данных", "Метрики", "Сегментация"], ["Python", "SQL", "Metabase"]),
    ("Green Stack", ["Устойчивое развитие", "Логистика", "Маркетплейсы"], ["Сервис-дизайн", "Логистика", "Исследование процессов"], ["React", "Node.js", "PostgreSQL"]),
    ("Craft Code", ["Мобильные сервисы", "Автоматизация", "Малый бизнес"], ["Frontend-разработка", "Интеграции", "Быстрое прототипирование"], ["TypeScript", "React", "Vite"]),
    ("Market Makers", ["Рост продаж", "Лояльность", "Контент"], ["Маркетинговая стратегия", "Копирайтинг", "A/B-тестирование"], ["Figma", "Google Analytics", "Notion"]),
)

DEMO_PROPOSALS = (
    (1, "Собрать понятный сценарий повторного заказа с персональными рекомендациями и заметной историей покупок.", "Проведём короткие интервью, соберём карту пути клиента и проверим кликабельный прототип на пяти пользователях.", "2 недели", "https://example.com/prototypes/pixel-lab"),
    (2, "Найти этапы, где клиенты чаще всего прекращают повторную покупку, и предложить точечные подсказки.", "Опишем события аналитики, проверим доступные данные и подготовим макет персонализированного блока.", "10 рабочих дней", "https://example.com/prototypes/data-pulse"),
    (3, "Сделать повторный заказ короче: сохранить прошлую корзину и заранее показать варианты доставки.", "Разберём путь заказа, нарисуем два варианта сценария и соберём прототип экрана повторной покупки.", "3 недели", "https://example.com/prototypes/green-stack"),
    (4, "Добавить быстрый повтор заказа с редактированием количества и заменой отсутствующих товаров.", "Сверим ограничения каталога и доставки, подготовим интерактивный прототип мобильного сценария.", "12 дней", "https://example.com/prototypes/craft-code"),
    (5, "Поддержать возврат клиентов личным списком избранного и полезными напоминаниями.", "Составим карту сообщений, проверим частоту контакта и соберём прототип персонального кабинета.", "2,5 недели", "https://example.com/prototypes/market-makers"),
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
def list_proposals(task_id: int | None = Query(default=None, gt=0)) -> list[dict]:
    query = "SELECT * FROM proposals"
    parameters = ()
    if task_id is not None:
        query += " WHERE task_id = ?"
        parameters = (task_id,)
    query += " ORDER BY id DESC"
    with closing(connect()) as connection:
        return [_proposal(row) for row in connection.execute(query, parameters)]


@router.post("/api/proposals", status_code=201)
def create_proposal(request: ProposalInput) -> dict:
    values = {
        "idea": request.idea.strip(),
        "plan": request.plan.strip(),
        "duration": request.duration.strip(),
        "prototype_url": request.prototype_url.strip(),
    }
    if any(not value for value in values.values()):
        raise HTTPException(status_code=422, detail="Заполните все поля отклика")
    prototype_url = urlparse(values["prototype_url"])
    if prototype_url.scheme not in ("https", "http") or not prototype_url.netloc:
        raise HTTPException(status_code=422, detail="Укажите ссылку на прототип с http:// или https://")

    with closing(connect()) as connection, connection:
        if connection.execute(
            "SELECT 1 FROM tasks WHERE id = ? AND status = 'published'", (request.task_id,)
        ).fetchone() is None:
            raise HTTPException(status_code=404, detail="Опубликованная задача не найдена")
        if connection.execute("SELECT 1 FROM teams WHERE id = ?", (request.team_id,)).fetchone() is None:
            raise HTTPException(status_code=404, detail="Команда не найдена")
        cursor = connection.execute(
            """INSERT INTO proposals (task_id, team_id, idea, plan, duration, prototype_url)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (request.task_id, request.team_id, values["idea"], values["plan"], values["duration"], values["prototype_url"]),
        )
        row = connection.execute("SELECT * FROM proposals WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return _proposal(row)


@router.patch("/api/proposals/{proposal_id}/decision")
def decide_proposal(proposal_id: int, request: DecisionInput) -> dict:
    with closing(connect()) as connection, connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute("SELECT * FROM proposals WHERE id = ?", (proposal_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Отклик не найден")
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
def confirm_progress(proposal_id: int) -> dict:
    with closing(connect()) as connection, connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute("SELECT * FROM proposals WHERE id = ?", (proposal_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Отклик не найден")
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
