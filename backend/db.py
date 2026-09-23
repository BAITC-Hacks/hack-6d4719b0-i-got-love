"""Shared SQLite connection and schema for the API modules."""

import os
import sqlite3
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
    with connect() as connection:
        connection.executescript(SCHEMA.read_text(encoding="utf-8"))
