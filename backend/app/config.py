import os
from dataclasses import dataclass
from pathlib import Path

from app.envfile import load_env_file

load_env_file()  # backend/.env, before the settings below read the environment

def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        return default


MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024
# A request larger than this is refused while it is being read. Multipart adds a little to the file itself.
MAX_UPLOAD_BODY_BYTES = MAX_FILE_SIZE_BYTES + 1024 * 1024
MAX_JSON_BODY_BYTES = 256 * 1024
MAX_DOCX_ENTRIES = 2000
MAX_DOCX_UNPACKED_BYTES = 100 * 1024 * 1024
# XML costs several times its size in memory once parsed, unlike the images that make up most large files.
MAX_DOCX_XML_BYTES = 32 * 1024 * 1024
MAX_OCR_PAGES = _int("MAX_OCR_PAGES", 50)
WORKER_TIMEOUT_SECONDS = _int("WORKER_TIMEOUT_SECONDS", 180)
WORKER_MEMORY_MB = _int("WORKER_MEMORY_MB", 768)
WORKER_CONCURRENCY = _int("WORKER_CONCURRENCY", 2)
MAX_PAGES = 300
MAX_DOCUMENTS_PER_CONVERSATION = 5
MAX_MESSAGE_CHARS = 2000
SUPPORTED_EXTENSIONS = {".pdf": "pdf", ".docx": "docx"}


@dataclass(frozen=True)
class Settings:
    data_dir: Path = Path(os.environ.get("DATA_DIR", "data"))
    cors_origins: tuple[str, ...] = tuple(
        origin.strip() for origin in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",") if origin.strip()
    )
    # "production" enforces https CORS origins and turns on HSTS. /docs exists only with "development".
    app_env: str = os.environ.get("APP_ENV", "").strip().lower()
    # Addresses of our own reverse proxy. X-Forwarded-For is believed only from these.
    trusted_proxies: tuple[str, ...] = tuple(
        item.strip() for item in os.environ.get("TRUSTED_PROXY_IPS", "").split(",") if item.strip()
    )
    session_ttl_hours: int = _int("SESSION_TTL_HOURS", 72)
    max_active_sessions: int = _int("MAX_ACTIVE_SESSIONS", 5000)
    session_limit_per_minute: int = _int("SESSION_LIMIT_PER_MINUTE", 30)
    facts_limit_per_minute: int = _int("FACTS_LIMIT_PER_MINUTE", 20)
    text_limit_per_minute: int = _int("TEXT_LIMIT_PER_MINUTE", 30)
    compare_limit_per_minute: int = _int("COMPARE_LIMIT_PER_MINUTE", 6)
    # Store search and barcodes: the shops are also protected by their own pause, one request at a time and a cache.
    search_limit_per_minute: int = _int("SEARCH_LIMIT_PER_MINUTE", 20)
    read_limit_per_minute: int = _int("READ_LIMIT_PER_MINUTE", 600)
    session_max_documents: int = _int("SESSION_MAX_DOCUMENTS", 10)
    session_max_bytes: int = _int("SESSION_MAX_MB", 100) * 1024 * 1024
    session_max_processing: int = _int("SESSION_MAX_PROCESSING", 6)
    session_max_conversations: int = _int("SESSION_MAX_CONVERSATIONS", 50)
    session_max_comparisons: int = _int("SESSION_MAX_COMPARISONS", 20)
    global_max_processing: int = _int("GLOBAL_MAX_PROCESSING", 20)
    global_max_comparing: int = _int("GLOBAL_MAX_COMPARING", 2)
    global_max_bytes: int = _int("GLOBAL_MAX_STORAGE_MB", 5120) * 1024 * 1024
    ai_session_daily_limit: int = _int("AI_SESSION_DAILY_LIMIT", 40)
    # One address may hold many sessions, and a venue shares one address: higher than a session, lower than the total.
    ai_client_daily_limit: int = _int("AI_CLIENT_DAILY_LIMIT", 300)
    ai_global_daily_limit: int = _int("AI_GLOBAL_DAILY_LIMIT", 1000)
    ai_emergency_stop: bool = os.environ.get("AI_EMERGENCY_STOP", "").strip() == "1"
    claude_model: str = os.environ.get("CLAUDE_MODEL", "claude-opus-5-5")
    llm_provider: str = os.environ.get("LLM_PROVIDER", "anthropic").strip().lower()
    # Quotes, spaces and a leading "models/" are common copy-paste leftovers and would give a 404.
    gemini_model: str = (
        os.environ.get("GEMINI_MODEL", "").strip().strip("\"'").removeprefix("models/") or "gemini-3.5-flash-lite"
    )
    # Asked when the main model is rate limited or slow. Empty: the other of flash / flash-lite. "off" disables it.
    # Optional independent backup used when Gemini is rate limited or down (needs GROQ_API_KEY).
    groq_model: str = os.environ.get("GROQ_MODEL", "").strip().strip("\"'") or "qwen/qwen3.8-27b"
    gemini_fallback_model: str = os.environ.get("GEMINI_FALLBACK_MODEL", "").strip().strip("\"'").removeprefix("models/")
    # Empty means the model's own default. For gemini-3.5-flash-lite that is "minimal" according to the docs.
    gemini_thinking_level: str = os.environ.get("GEMINI_THINKING_LEVEL", "").strip().lower()
    upload_limit_per_minute: int = _int("UPLOAD_LIMIT_PER_MINUTE", 6)
    chat_limit_per_minute: int = _int("CHAT_LIMIT_PER_MINUTE", 12)
