"""FastAPI entry point for the shared catalog."""

from contextlib import asynccontextmanager, closing

from fastapi import FastAPI, HTTPException, Query

from .db import connect, init_db
from .rating import evaluate


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title="HackAlem task catalog", lifespan=lifespan)


def catalog_item(row) -> dict:
    task = dict(row)
    confirmed = bool(task.pop("confirmed_at"))
    task.update(evaluate(task, confirmed=confirmed))
    return task


@app.get("/api/catalog")
def list_catalog(
    sort: str = Query("score_desc", pattern="^(score_desc|score_asc)$"),
    topic: str | None = None,
    level: str | None = Query(None, pattern="^(draft|working|ready|priority)$"),
):
    query = "SELECT * FROM tasks WHERE status = 'published'"
    parameters = []
    if topic:
        query += " AND LOWER(topic) = LOWER(?)"
        parameters.append(topic)
    direction = "DESC" if sort == "score_desc" else "ASC"
    query += f" ORDER BY score {direction}, id ASC"
    with closing(connect()) as connection:
        items = [catalog_item(row) for row in connection.execute(query, parameters)]
    if level:
        items = [item for item in items if item["level"] == level]
    return {"items": items, "total": len(items)}


@app.get("/api/catalog/{task_id}")
def get_catalog_task(task_id: int):
    with closing(connect()) as connection:
        row = connection.execute(
            "SELECT * FROM tasks WHERE id = ? AND status = 'published'", (task_id,)
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Published task not found")
    return catalog_item(row)
