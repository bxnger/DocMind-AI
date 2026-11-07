import asyncio
import json
import logging
import os
import time
import uuid
from collections.abc import Mapping
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.config import MAX_JSON_BODY_BYTES, MAX_UPLOAD_BODY_BYTES, Settings
from app.deps import get_settings, get_store
from app.errors import error_body, register_error_handlers
from app.extraction import ocr_languages
from app.pipeline import recover_unfinished
from app.ratelimit import RateLimiter
from app.store import Store
from app.routers import claims, comparisons, conversations, documents, sessions
from app.schemas import Capabilities, build_capabilities

logger = logging.getLogger("app")


def configure_logging() -> None:
    """Shows the app's INFO lines (provider, model, why an answer was not_found) next to uvicorn's."""
    logger.setLevel(logging.INFO)
    if not logging.getLogger().handlers and not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(levelname)s:     %(name)s: %(message)s"))
        logger.addHandler(handler)


def describe_llm(settings: Settings, env: Mapping[str, str]) -> str:
    """Which provider and model this process will really use. Says whether a key is set, never its value."""
    provider = settings.llm_provider
    if provider == "gemini":
        thinking = settings.gemini_thinking_level or "default"
        backup = f" backup=groq:{settings.groq_model}" if env.get("GROQ_API_KEY") else ""
        return (
            f"provider=gemini model={settings.gemini_model} thinking={thinking}"
            f" key={'set' if env.get('GEMINI_API_KEY') else 'MISSING'}{backup}"
        )
    if provider == "groq":
        return f"provider=groq model={settings.groq_model} key={'set' if env.get('GROQ_API_KEY') else 'MISSING'}"
    if provider == "anthropic":
        return f"provider=anthropic model={settings.claude_model} key={'set' if env.get('ANTHROPIC_API_KEY') else 'MISSING'}"
    return f"provider={provider!r} is not supported, expected anthropic, gemini or groq"


VERSION = "0.3.0"
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Cache-Control": "no-store",
}


class BodyLimit:
    """Refuses an oversized request while reading it, so it never reaches memory or the temp directory."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http" or scope["method"] not in ("POST", "PUT", "PATCH"):
            await self.app(scope, receive, send)
            return
        limit = MAX_UPLOAD_BODY_BYTES if scope["path"].endswith("/documents") else MAX_JSON_BODY_BYTES

        async def refuse() -> None:
            body = {"error": {"code": "FILE_TOO_LARGE", "message": "The request is too large", "retryable": False, "requestId": uuid.uuid4().hex}}
            data = json.dumps(body).encode()
            await send({"type": "http.response.start", "status": 413, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(data)).encode()), (b"connection", b"close")]})
            await send({"type": "http.response.body", "body": data})

        declared = dict(scope["headers"]).get(b"content-length", b"0")
        if declared.isdigit() and int(declared) > limit:
            await refuse()
            return
        seen = 0
        over = False

        async def counted():
            nonlocal seen, over
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > limit:
                    over = True
                    raise ValueError("request body over the limit")
            return message

        async def guarded(message):
            if not over:  # the handler's own complaint about the broken body is replaced below
                await send(message)

        try:
            await self.app(scope, counted, guarded)
        except ValueError:
            if not over:
                raise
        if over:
            await refuse()


def create_app(settings: Settings | None = None, store: Store | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging()
    production = settings.app_env == "production"
    if production and any(origin == "*" or not origin.startswith("https://") for origin in settings.cors_origins):
        raise RuntimeError("In production CORS_ORIGINS must list exact https origins")
    logger.info("LLM %s", describe_llm(settings, os.environ))

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # Finish what a restart interrupted, without delaying startup.
        active = store or app.dependency_overrides.get(get_store, get_store)()
        app.state.recovery = asyncio.create_task(asyncio.to_thread(recover_unfinished, active))
        await asyncio.to_thread(active.purge_expired_sessions)
        yield

    # Fails closed: the schema and its pages exist only when development is asked for by name.
    docs = settings.app_env == "development"
    app = FastAPI(
        title="Document Assistant API", version=VERSION, lifespan=lifespan,
        docs_url="/docs" if docs else None, redoc_url="/redoc" if docs else None, openapi_url="/openapi.json" if docs else None,
    )
    app.state.settings = settings
    app.state.last_purge = time.monotonic()
    app.state.limiters = {
        "session": RateLimiter(settings.session_limit_per_minute),
        "upload": RateLimiter(settings.upload_limit_per_minute),
        "chat": RateLimiter(settings.chat_limit_per_minute),
        "compare": RateLimiter(settings.compare_limit_per_minute),
        "facts": RateLimiter(settings.facts_limit_per_minute),
        "text": RateLimiter(settings.text_limit_per_minute),
        "read": RateLimiter(settings.read_limit_per_minute),
    }

    app.add_middleware(BodyLimit)

    # Inside CORS, so a browser can also read the answer to a failed request.
    @app.middleware("http")
    async def add_request_id(request: Request, call_next):
        request.state.request_id = uuid.uuid4().hex
        try:
            response = await call_next(request)
        except Exception as exc:
            # The type only: a message can hold document text or a path.
            logger.error("Unhandled %s on %s %s id=%s", type(exc).__name__, request.method, request.url.path, request.state.request_id)
            response = JSONResponse(status_code=500, content=error_body(request, "INTERNAL_ERROR", "Something went wrong on the server", True))
        response.headers["X-Request-Id"] = request.state.request_id
        for name, value in SECURITY_HEADERS.items():
            response.headers.setdefault(name, value)
        if production:
            response.headers["Strict-Transport-Security"] = "max-age=31536000"
        return response

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "Range"],
        expose_headers=["X-Request-Id", "Retry-After", "Accept-Ranges", "Content-Range", "Content-Length"],
    )

    register_error_handlers(app)

    @app.get("/api/v1/health")
    def health() -> dict:
        return {"status": "ok"}

    @app.get("/api/v1/capabilities", response_model=Capabilities)
    def capabilities() -> Capabilities:
        return build_capabilities(VERSION, ocr=ocr_languages() is not None)

    app.include_router(sessions.router, prefix="/api/v1")
    app.include_router(documents.router, prefix="/api/v1")
    app.include_router(conversations.router, prefix="/api/v1")
    app.include_router(claims.router, prefix="/api/v1")
    app.include_router(comparisons.router, prefix="/api/v1")
    return app


app = create_app()
