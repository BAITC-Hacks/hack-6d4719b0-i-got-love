"""Combined API for the shared React application."""

from backend.main import app
from backend.team_proposals import router as team_proposals_router
from task_builder.server import router as task_builder_router


app.include_router(task_builder_router)
app.include_router(team_proposals_router)
