"""Password accounts and opaque, expiring server-side cookie sessions."""

import hashlib
import hmac
import json
import re
import secrets
import sqlite3
import time
from collections import OrderedDict, deque
from contextlib import closing
from threading import BoundedSemaphore, Lock
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StrictBool

from backend.db import connect

router = APIRouter(prefix="/api/auth", tags=["Учётная запись"])
COOKIE_NAME = "lovelab_session"
SESSION_SECONDS = 8 * 60 * 60
SCRYPT_N = 2**17
_RATE_SECONDS = 10 * 60
_RATE_BUCKETS_MAX = 4096
_rate_buckets: OrderedDict[tuple[str, str], deque[float]] = OrderedDict()
_rate_lock = Lock()
_password_slots = BoundedSemaphore(2)
_dummy_salt = secrets.token_bytes(32)


class RegisterInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=1, max_length=254)
    password: str = Field(repr=False)
    role: Literal["business", "team"]
    team_name: str | None = Field(default=None, min_length=1, max_length=100)


class LoginInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(min_length=1, max_length=254)
    password: str = Field(repr=False)


class ProfileInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=120)
    available: StrictBool | None = None
    team_name: str | None = Field(default=None, min_length=1, max_length=100)
    interests: list[Annotated[str, Field(min_length=1, max_length=80)]] | None = Field(default=None, max_length=12)
    skills: list[Annotated[str, Field(min_length=1, max_length=80)]] | None = Field(default=None, max_length=12)
    technologies: list[Annotated[str, Field(min_length=1, max_length=80)]] | None = Field(default=None, max_length=12)


def _email(value: str) -> str:
    value = value.strip().casefold()
    local, separator, domain = value.partition("@")
    if (not separator or len(value) > 254 or len(local) > 64 or not local
            or local.startswith(".") or local.endswith(".") or ".." in local
            or not re.fullmatch(r"[a-z0-9.!#$%&'*+/=?^_`{|}~-]+", local)
            or not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+", domain)):
        raise HTTPException(422, "Укажите корректный адрес электронной почты")
    return value


def _password(value: str) -> str:
    if not 12 <= len(value) <= 128:
        raise HTTPException(422, "Пароль должен содержать от 12 до 128 символов")
    return value


def _name(value: str) -> str:
    value = value.strip()
    if not value:
        raise HTTPException(422, "Укажите имя")
    return value


def _rate(key: tuple[str, str], limit: int, *, record: bool = True) -> None:
    now = time.monotonic()
    with _rate_lock:
        bucket = _rate_buckets.pop(key, deque())
        while bucket and bucket[0] <= now - _RATE_SECONDS:
            bucket.popleft()
        _rate_buckets[key] = bucket
        while len(_rate_buckets) > _RATE_BUCKETS_MAX:
            _rate_buckets.popitem(last=False)
        if len(bucket) >= limit:
            raise HTTPException(429, "Слишком много попыток. Попробуйте через 10 минут", headers={"Retry-After": str(_RATE_SECONDS)})
        if record:
            bucket.append(now)


def _client_ip(request: Request) -> str:
    # Uvicorn resolves only explicitly trusted proxy peers; never parse X-Forwarded-For here.
    return request.client.host if request.client else "unknown"


def _derive_password(password: str, salt: bytes) -> str:
    if not _password_slots.acquire(blocking=False):
        raise HTTPException(429, "Сервис входа занят. Попробуйте через несколько секунд", headers={"Retry-After": "3"})
    try:
        return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=SCRYPT_N, r=8, p=1,
                              dklen=64, maxmem=256 * 1024 * 1024).hex()
    finally:
        _password_slots.release()


def user_payload(connection: sqlite3.Connection, user: sqlite3.Row) -> dict:
    team = connection.execute("SELECT * FROM teams WHERE owner_user_id = ?", (user["id"],)).fetchone()
    return {"id": user["id"], "name": user["name"], "email": user["email"], "role": user["role"],
            "available": bool(user["available"]), "team_id": team["id"] if team else None,
            "team_name": team["name"] if team else None,
            **{field: json.loads(team[field]) if team else [] for field in ("interests", "skills", "technologies")}}


def _token_hash(request: Request) -> str | None:
    token = request.cookies.get(COOKIE_NAME, "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
        return None
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def optional_user(request: Request) -> dict | None:
    token_hash = _token_hash(request)
    if token_hash is None:
        return None
    with closing(connect()) as connection:
        user = connection.execute(
            "SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id "
            "WHERE sessions.token_hash = ? AND sessions.expires_at > ?", (token_hash, int(time.time())),
        ).fetchone()
        return user_payload(connection, user) if user else None


def require_user(request: Request) -> dict:
    user = optional_user(request)
    if user is None:
        raise HTTPException(401, "Войдите в учётную запись")
    return user


def _start_session(connection: sqlite3.Connection, user_id: int, request: Request, response: Response) -> None:
    token = secrets.token_urlsafe(32)
    old_hash = _token_hash(request)
    connection.execute("DELETE FROM sessions WHERE expires_at <= ? OR token_hash = ?", (int(time.time()), old_hash))
    connection.execute("INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)",
                       (hashlib.sha256(token.encode("ascii")).hexdigest(), user_id, int(time.time()) + SESSION_SECONDS))
    response.set_cookie(COOKIE_NAME, token, max_age=SESSION_SECONDS, httponly=True, secure=request.url.scheme == "https", samesite="lax", path="/")


@router.post("/register", status_code=201)
def register(data: RegisterInput, request: Request, response: Response) -> dict:
    _rate(("register-ip", _client_ip(request)), 20)
    email = _email(data.email)
    password = _password(data.password)
    name = _name(data.name)
    team_name = _name(data.team_name) if data.team_name is not None else name
    salt = secrets.token_bytes(32)
    password_hash = _derive_password(password, salt)
    try:
        with closing(connect()) as connection, connection:
            cursor = connection.execute(
                "INSERT INTO users(name, email, password_hash, salt, role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (name, email, password_hash, salt.hex(), data.role, int(time.time())),
            )
            user_id = cursor.lastrowid
            if data.role == "team":
                connection.execute("INSERT INTO teams(name, owner_user_id) VALUES (?, ?)", (team_name, user_id))
            _start_session(connection, user_id, request, response)
            return {"user": user_payload(connection, connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())}
    except sqlite3.IntegrityError:
        raise HTTPException(409, "Учётная запись с такой почтой уже существует") from None


@router.post("/login")
def login(data: LoginInput, request: Request, response: Response) -> dict:
    _rate(("login-ip", _client_ip(request)), 50)
    email = _email(data.email)
    password = _password(data.password)
    _rate(("login-failed-email", email), 10, record=False)
    with closing(connect()) as connection, connection:
        user = connection.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        calculated = _derive_password(password, bytes.fromhex(user["salt"]) if user else _dummy_salt)
        expected = user["password_hash"] if user else "0" * 128
        valid = hmac.compare_digest(calculated, expected)
        if user is None or not valid:
            _rate(("login-failed-email", email), 10)
            raise HTTPException(401, "Неверная почта или пароль")
        _start_session(connection, user["id"], request, response)
        return {"user": user_payload(connection, user)}


@router.get("/me")
def me(request: Request) -> dict:
    return {"user": optional_user(request)}


@router.post("/logout")
def logout(request: Request, response: Response) -> dict:
    with closing(connect()) as connection, connection:
        connection.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(request),))
    response.delete_cookie(COOKIE_NAME, path="/", httponly=True, secure=request.url.scheme == "https", samesite="lax")
    return {"user": None}


@router.patch("/profile")
def profile(data: ProfileInput, user: dict = Depends(require_user)) -> dict:
    if not data.model_fields_set:
        raise HTTPException(422, "Укажите изменения профиля")
    if any(getattr(data, field) is None for field in data.model_fields_set):
        raise HTTPException(422, "Поля профиля не могут быть пустыми")
    team_fields = data.model_fields_set & {"team_name", "interests", "skills", "technologies"}
    if team_fields and user["role"] != "team":
        raise HTTPException(403, "Командный профиль доступен только участникам команд")
    team_values = {}
    for field in team_fields:
        value = getattr(data, field)
        if field == "team_name":
            team_values["name"] = _name(value)
        else:
            values = [item.strip() for item in value]
            if any(not item for item in values):
                raise HTTPException(422, "Удалите пустые значения из профиля команды")
            team_values[field] = json.dumps(list(dict.fromkeys(values)), ensure_ascii=False)
    with closing(connect()) as connection, connection:
        if data.name is not None:
            connection.execute("UPDATE users SET name = ? WHERE id = ?", (_name(data.name), user["id"]))
        if data.available is not None:
            connection.execute("UPDATE users SET available = ? WHERE id = ?", (int(data.available), user["id"]))
        for field, value in team_values.items():
            connection.execute(f"UPDATE teams SET {field} = ? WHERE owner_user_id = ?", (value, user["id"]))
        updated = connection.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
        return {"user": user_payload(connection, updated)}
