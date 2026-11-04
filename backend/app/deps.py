import logging
import os
from collections.abc import Mapping
from functools import lru_cache

from app.config import Settings
from app.llm import Answerer, ClaudeAnswerer
from app.store import Store

logger = logging.getLogger("app.deps")


@lru_cache
def get_settings() -> Settings:
    return Settings()


@lru_cache
def get_store() -> Store:
    return Store(get_settings().data_dir)


@lru_cache
def get_answerer() -> Answerer | None:
    """None when the chosen provider has no API key: chat then answers 503 LLM_UNAVAILABLE."""
    return build_answerer(get_settings(), os.environ)


def build_answerer(settings: Settings, env: Mapping[str, str]) -> Answerer | None:
    if settings.llm_provider == "anthropic":
        return ClaudeAnswerer(model=settings.claude_model) if env.get("ANTHROPIC_API_KEY") else None
    if settings.llm_provider == "gemini":
        api_key = env.get("GEMINI_API_KEY")
        if not api_key:
            return None
        from app.llm_gemini import THINKING_LEVELS, GeminiAnswerer

        level = settings.gemini_thinking_level
        if level and level not in THINKING_LEVELS:
            logger.error("Unknown GEMINI_THINKING_LEVEL %r: expected one of %s. Using the model default", level, THINKING_LEVELS)
            level = ""
        return GeminiAnswerer(model=settings.gemini_model, api_key=api_key, thinking_level=level or None)
    logger.error("Unknown LLM_PROVIDER %r: expected anthropic or gemini", settings.llm_provider)
    return None
