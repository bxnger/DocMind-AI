import os
from dataclasses import dataclass
from pathlib import Path

from app.envfile import load_env_file

load_env_file()  # backend/.env, before the settings below read the environment

MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024
MAX_PAGES = 300
MAX_DOCUMENTS_PER_CONVERSATION = 5
MAX_MESSAGE_CHARS = 2000
SUPPORTED_EXTENSIONS = {".pdf": "pdf", ".docx": "docx"}


@dataclass(frozen=True)
class Settings:
    data_dir: Path = Path(os.environ.get("DATA_DIR", "data"))
    cors_origins: tuple[str, ...] = tuple(
        os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",")
    )
    claude_model: str = os.environ.get("CLAUDE_MODEL", "claude-opus-5-5")
    llm_provider: str = os.environ.get("LLM_PROVIDER", "anthropic").strip().lower()
    # Quotes, spaces and a leading "models/" are common copy-paste leftovers and would give a 404.
    gemini_model: str = (
        os.environ.get("GEMINI_MODEL", "").strip().strip("\"'").removeprefix("models/") or "gemini-3.5-flash-lite"
    )
    # Asked when the main model is rate limited or slow. Empty: the other of flash / flash-lite. "off" disables it.
    gemini_fallback_model: str = os.environ.get("GEMINI_FALLBACK_MODEL", "").strip().strip("\"'").removeprefix("models/")
    # Empty means the model's own default. For gemini-3.5-flash-lite that is "minimal" according to the docs.
    gemini_thinking_level: str = os.environ.get("GEMINI_THINKING_LEVEL", "").strip().lower()
    upload_limit_per_minute: int = 30
    chat_limit_per_minute: int = 30
