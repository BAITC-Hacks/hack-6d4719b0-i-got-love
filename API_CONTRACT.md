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

The task builder should call the shared rating recalculation after business
confirmation or a confirmed edit. Publishing and team proposals must not apply
a score threshold.

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
