"""Shared SQLite connection and schema for the API modules."""

import os
import sqlite3
from contextlib import closing
from pathlib import Path


SCHEMA = Path(__file__).with_name("schema.sql")
DEFAULT_DB = Path(__file__).with_name("app.db")


def connect() -> sqlite3.Connection:
    path = os.environ.get("APP_DB_PATH", str(DEFAULT_DB))
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_db() -> None:
    with closing(connect()) as connection, connection:
        connection.executescript(SCHEMA.read_text(encoding="utf-8"))
        # Preserve legacy demo records as unowned; never assign them to a signup.
        connection.execute("BEGIN IMMEDIATE")
        for table in ("tasks", "teams"):
            columns = {row["name"] for row in connection.execute(f"PRAGMA table_info({table})")}
            if "owner_user_id" not in columns:
                connection.execute(f"ALTER TABLE {table} ADD COLUMN owner_user_id INTEGER REFERENCES users(id)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner_user_id)")
        connection.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_owner ON teams(owner_user_id) WHERE owner_user_id IS NOT NULL")
