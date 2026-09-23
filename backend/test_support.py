"""Real auth registrations and explicit ownership fixtures for disposable test DBs."""

from contextlib import closing

from .db import connect


def register_user(client, role="business", email=None):
    from . import auth
    auth._rate_buckets.clear()
    response = client.post("/api/auth/register", json={
        "name": "Тестовый бизнес" if role == "business" else "Тестовая команда",
        "email": email or f"{role}@example.test",
        "password": "Test-password-2026!",
        "role": role,
    })
    assert response.status_code == 201, response.text
    return response.json()["user"]


def own_seed_tasks(user):
    with closing(connect()) as connection, connection:
        connection.execute("UPDATE tasks SET owner_user_id = ? WHERE id BETWEEN 1 AND 10", (user["id"],))


def own_seed_team_user(client):
    user = register_user(client, "team")
    with closing(connect()) as connection, connection:
        connection.execute("DELETE FROM teams WHERE id = ?", (user["team_id"],))
        connection.execute("UPDATE teams SET owner_user_id = ? WHERE id = 1", (user["id"],))
    return {**user, "team_id": 1}
