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
        from app.llm_gemini import BACKUP_BUDGET_SECONDS, PRIMARY_BUDGET_SECONDS, THINKING_LEVELS, GeminiAnswerer

        level = settings.gemini_thinking_level
        if level and level not in THINKING_LEVELS:
            logger.error("Unknown GEMINI_THINKING_LEVEL %r: expected one of %s. Using the model default", level, THINKING_LEVELS)
            level = ""
        external = groq_backup(settings, env)
        fallback = fallback_model(settings)
        backup_gemini = (
            GeminiAnswerer(fallback, api_key, thinking_level=level or None, timeout_seconds=BACKUP_BUDGET_SECONDS if external else None)
            if fallback
            else None
        )
        return GeminiAnswerer(
            settings.gemini_model,
            api_key,
            thinking_level=level or None,
            timeout_seconds=PRIMARY_BUDGET_SECONDS if (backup_gemini or external) else None,
            fallback=backup_gemini,
            external=external,
        )
    if settings.llm_provider == "groq":
        from app.llm_groq import GroqAnswerer

        return GroqAnswerer(settings.groq_model, env["GROQ_API_KEY"]) if env.get("GROQ_API_KEY") else None
    logger.error("Unknown LLM_PROVIDER %r: expected anthropic, gemini or groq", settings.llm_provider)
    return None


def fallback_model(settings: Settings) -> str:
    """The second Gemini model, or "" when switching is turned off.

    By default the same family with or without "-lite" (3.5-flash <-> 3.5-flash-lite), so it follows
    whichever version the account supports.
    """
    chosen = settings.gemini_fallback_model
    if chosen.lower() == "off":
        return ""
    if chosen:
        return chosen if chosen != settings.gemini_model else ""
    model = settings.gemini_model
    return model.removesuffix("-lite") if model.endswith("-lite") else f"{model}-lite"


def groq_backup(settings: Settings, env: Mapping[str, str]):
    """The Groq backup when GROQ_API_KEY is set, else None."""
    if not env.get("GROQ_API_KEY"):
        return None
    from app.llm_groq import GroqAnswerer

    return GroqAnswerer(settings.groq_model, env["GROQ_API_KEY"])
