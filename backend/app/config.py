import os
from dataclasses import dataclass
from pathlib import Path

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
        os.environ.get("GEMINI_MODEL", "").strip().strip("\"'").removeprefix("models/") or "gemini-2.5-flash-lite"
    )
    # Empty means the model's own default. For gemini-3.5-flash-lite that is "minimal" according to the docs.
    gemini_thinking_level: str = os.environ.get("GEMINI_THINKING_LEVEL", "").strip().lower()
    upload_limit_per_minute: int = 30
    chat_limit_per_minute: int = 30
