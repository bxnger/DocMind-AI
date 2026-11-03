from functools import lru_cache

from app.config import Settings
from app.store import Store


@lru_cache
def get_settings() -> Settings:
    return Settings()


@lru_cache
def get_store() -> Store:
    return Store(get_settings().data_dir)
