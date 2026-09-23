"""Combined API and optional built React application."""

from pathlib import Path
from contextlib import closing

from fastapi import HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.db import connect
from backend.main import app
from backend.team_proposals import router as team_proposals_router
from task_builder.server import router as task_builder_router

app.include_router(task_builder_router)
app.include_router(team_proposals_router)


@app.get("/api/health")
def health():
    with closing(connect()) as connection:
        connection.execute("SELECT 1 FROM tasks LIMIT 1")
    return {"status": "ok"}


DIST = Path(__file__).resolve().parents[1] / "dist"
if (DIST / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.get("/", include_in_schema=False)
def frontend():
    index = DIST / "index.html"
    if not index.is_file():
        raise HTTPException(status_code=503, detail="Сначала выполните npm run build или запустите npm run dev")
    return FileResponse(index, headers={"Cache-Control": "no-cache"})
