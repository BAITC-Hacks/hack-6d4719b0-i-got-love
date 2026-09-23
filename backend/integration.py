"""Combined API and optional built React application."""

from pathlib import Path
from contextlib import closing
from urllib.parse import urlsplit

from fastapi import HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.datastructures import Headers, MutableHeaders, URL
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from backend.db import connect
from backend.auth import router as auth_router
from backend.main import app
from backend.team_proposals import router as team_proposals_router
from task_builder.server import router as task_builder_router


MAX_REQUEST_BYTES = 128 * 1024
FRONTEND_CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data:; connect-src 'self'; object-src 'none'; "
    "base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
)


def origin_parts(value: str) -> tuple[str, str, int]:
    origin = urlsplit(value)
    if origin.scheme not in ("http", "https") or not origin.hostname or origin.username or origin.password:
        raise ValueError("Invalid origin")
    if origin.path not in ("", "/") or origin.query or origin.fragment:
        raise ValueError("Invalid origin")
    port = origin.port if origin.port is not None else (443 if origin.scheme == "https" else 80)
    return origin.scheme, origin.hostname, port


class HttpSecurityMiddleware:
    """Bound bodies before routing and reject unsolicited browser writes.

    Authentication and ownership are enforced by route dependencies.
    Non-browser clients without Origin still need valid session cookies.
    """

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def secure_send(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["X-Content-Type-Options"] = "nosniff"
                headers["Referrer-Policy"] = "no-referrer"
                if scope["path"].startswith("/api/"):
                    headers["Cache-Control"] = "no-store"
                if scope["path"] == "/":
                    headers["Content-Security-Policy"] = FRONTEND_CSP
            await send(message)

        async def reject(status_code: int, detail: str) -> None:
            await JSONResponse({"detail": detail}, status_code=status_code)(scope, receive, secure_send)

        headers = Headers(scope=scope)
        if scope["method"] not in ("GET", "HEAD", "OPTIONS"):
            if headers.get("sec-fetch-site", "").lower() == "cross-site":
                await reject(403, "Запрос с другого сайта запрещён")
                return
            if "origin" in headers:
                try:
                    same_origin = origin_parts(headers["origin"]) == origin_parts(str(URL(scope=scope).replace(path="", query="")))
                except ValueError:
                    same_origin = False
                if not same_origin:
                    await reject(403, "Запрос с другого сайта запрещён")
                    return

        if "content-length" in headers:
            try:
                declared_length = int(headers["content-length"])
                if declared_length < 0:
                    raise ValueError
            except ValueError:
                await reject(400, "Некорректный размер запроса")
                return
            if declared_length > MAX_REQUEST_BYTES:
                await reject(413, "Запрос превышает допустимый размер 128 КБ")
                return

        buffered_body = bytearray()
        size = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > MAX_REQUEST_BYTES:
                await reject(413, "Запрос превышает допустимый размер 128 КБ")
                return
            buffered_body.extend(chunk)
            if not message.get("more_body", False):
                break

        body = bytes(buffered_body)
        delivered = False

        async def replay_body() -> Message:
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        await self.app(scope, replay_body, secure_send)


app.add_middleware(HttpSecurityMiddleware)
app.include_router(auth_router)
app.include_router(task_builder_router)
app.include_router(team_proposals_router)


@app.exception_handler(RequestValidationError)
async def safe_auth_validation(request, exception):
    if request.url.path.startswith("/api/auth/"):
        # Pydantic's normal errors can echo the entire body, including passwords.
        return JSONResponse({"detail": "Проверьте поля учётной записи"}, status_code=422)
    return await request_validation_exception_handler(request, exception)


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
