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
