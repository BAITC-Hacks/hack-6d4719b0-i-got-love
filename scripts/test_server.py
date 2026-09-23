"""Serve an isolated, seeded database for browser tests; never touches app.db."""

import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

with tempfile.TemporaryDirectory(prefix="lovelab-e2e-") as directory:
    os.environ["APP_DB_PATH"] = str(Path(directory) / "test.db")
    os.environ.pop("TASK_BUILDER_DB_PATH", None)
    for name in ("AI_API_URL", "AI_API_KEY", "AI_MODEL"):
        os.environ.pop(name, None)
    from backend.seed import seed_demo as seed_tasks
    from backend.team_proposals import seed_demo as seed_teams
    import uvicorn

    seed_tasks()
    seed_teams()
    uvicorn.run("backend.integration:app", host="127.0.0.1", port=8765)
