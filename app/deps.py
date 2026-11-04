import os
from functools import lru_cache

from app.config import Settings
from app.llm import Answerer, ClaudeAnswerer
from app.store import Store


@lru_cache
def get_settings() -> Settings:
    return Settings()


@lru_cache
def get_store() -> Store:
    return Store(get_settings().data_dir)


@lru_cache
def get_answerer() -> Answerer | None:
    """None when no API key is configured: chat then answers 503 LLM_UNAVAILABLE."""
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return None
    return ClaudeAnswerer(model=get_settings().claude_model)
