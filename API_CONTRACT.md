# API contract for integration

This branch owns the shared SQLite schema, rating and catalog. Other modules can
import `backend.db.connect` and `backend.db.init_db`. Set `APP_DB_PATH` to use a
different database. The internal `tasks.confirmed_at` column records when the
business confirmed the card; an unconfirmed draft does not earn points.

The task fields match `TEAM_PLAN.md`. Catalog responses add the computed
`level`, `score_breakdown`, and `missing_fields`. For the two combined criteria,
`context` and `need` contribute 10 points each; `contact` and
`interaction_format` contribute 5 each. Blank fields earn zero. These response
additions are proposed here for team review before integration.

Planned catalog routes:

- `GET /api/catalog?sort=score_desc&topic=...&level=...` — published tasks only.
  `sort` accepts `score_desc` or `score_asc`; omitted filters include all topics
  and levels. No minimum score applies.
- `GET /api/catalog/{task_id}` — one published task, regardless of score.

`GET /api/catalog` returns `{ "items": [...], "total": 5 }`; the second route
returns one item. Both routes are implemented in `backend.main`. The level
values are `draft`, `working`, `ready`, and `priority` for scores 0–39,
40–69, 70–89, and 90–100.

The task builder should call `backend.rating.confirm_task(connection, task_id,
updates)` inside its transaction after business confirmation or a confirmed
edit. It saves approved fields, sets `confirmed_at`, and recalculates `score`
atomically. Its `updates` keys must come from the base Task text fields.
Publishing and team proposals must not apply a score threshold.

For a local demo: install `requirements.txt`, run `python -m backend.seed`, then
run `uvicorn backend.main:app --reload`. Seeding adds five drafts and five
published cards only if the database has no tasks.

The React catalog is in `frontend/src/Catalog.tsx`. Run `npm install` and
`npm run dev` from `frontend`; Vite proxies `/api` to the FastAPI server on
port 8000. The component accepts an optional `onRespond(taskId)` callback for
the proposal screen owned by `feat/team-proposals`. It does not filter or
disable that callback by score.

Example item in either catalog response (abridged task text):

```json
{
  "id": 1,
  "title": "Reduce support response time",
  "topic": "Support",
  "context": "Response times rose last month",
  "need": "Prioritize incoming requests",
  "users": "Support agents",
  "data": "Anonymized ticket history",
  "constraints": "No personal data in prototypes",
  "expected_result": "A triage prototype",
  "success_criteria": "",
  "contact": "support@example.test",
  "interaction_format": "",
  "status": "published",
  "score": 80,
  "level": "ready",
  "score_breakdown": {
    "context_and_need": {"earned": 20, "max": 20},
    "data": {"earned": 20, "max": 20},
    "expected_result": {"earned": 15, "max": 15},
    "success_criteria": {"earned": 0, "max": 15},
    "constraints": {"earned": 10, "max": 10},
    "users": {"earned": 10, "max": 10},
    "business_contact": {"earned": 5, "max": 10}
  },
  "missing_fields": ["success_criteria", "interaction_format"]
}
```
