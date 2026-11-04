import asyncio
import logging
import os
import uuid
from collections.abc import Mapping
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings
from app.deps import get_settings, get_store
from app.errors import register_error_handlers
from app.extraction import ocr_languages
from app.pipeline import recover_unfinished
from app.ratelimit import RateLimiter
from app.store import Store
from app.routers import comparisons, conversations, documents
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
        return (
            f"provider=gemini model={settings.gemini_model} thinking={thinking}"
            f" key={'set' if env.get('GEMINI_API_KEY') else 'MISSING'}"
        )
    if provider == "anthropic":
        return f"provider=anthropic model={settings.claude_model} key={'set' if env.get('ANTHROPIC_API_KEY') else 'MISSING'}"
    return f"provider={provider!r} is not supported, expected anthropic or gemini"


VERSION = "0.2.0"


def create_app(settings: Settings | None = None, store: Store | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging()
    logger.info("LLM %s", describe_llm(settings, os.environ))

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # Finish what a restart interrupted, without delaying startup.
        app.state.recovery = asyncio.create_task(asyncio.to_thread(recover_unfinished, store or get_store()))
        yield

    app = FastAPI(title="Document Assistant API", version=VERSION, lifespan=lifespan)
    app.state.upload_limiter = RateLimiter(settings.upload_limit_per_minute)
    app.state.chat_limiter = RateLimiter(settings.chat_limit_per_minute)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-Id"],
    )

    @app.middleware("http")
    async def add_request_id(request: Request, call_next):
        request.state.request_id = uuid.uuid4().hex
        response = await call_next(request)
        response.headers["X-Request-Id"] = request.state.request_id
        return response

    register_error_handlers(app)

    @app.get("/api/v1/health")
    def health() -> dict:
        return {"status": "ok"}

    @app.get("/api/v1/capabilities", response_model=Capabilities)
    def capabilities() -> Capabilities:
        return build_capabilities(VERSION, ocr=ocr_languages() is not None)

    app.include_router(documents.router, prefix="/api/v1")
    app.include_router(conversations.router, prefix="/api/v1")
    app.include_router(comparisons.router, prefix="/api/v1")
    return app


app = create_app()
