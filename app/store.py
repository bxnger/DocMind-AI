import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.errors import AppError

SCHEMA = """
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    status TEXT NOT NULL,
    stage TEXT,
    page_count INTEGER,
    language TEXT,
    ocr_used INTEGER,
    error_json TEXT,
    created_at TEXT NOT NULL
)
"""


class Store:
    """SQLite for metadata, one file per document on disk."""

    def __init__(self, data_dir: Path) -> None:
        self.files_dir = data_dir / "files"
        self.files_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = data_dir / "app.db"
        with self._connect() as conn:
            conn.execute(SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def new_id(self) -> str:
        return uuid.uuid4().hex

    def file_path(self, doc_id: str, kind: str) -> Path:
        return self.files_dir / f"{doc_id}.{kind}"

    def insert(self, doc_id: str, name: str, kind: str, size_bytes: int) -> dict:
        created_at = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO documents (id, name, kind, size_bytes, status, stage, created_at)"
                " VALUES (?, ?, ?, ?, 'processing', 'queued', ?)",
                (doc_id, name, kind, size_bytes, created_at),
            )
        return self.get(doc_id)

    def list(self) -> list[dict]:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM documents ORDER BY created_at DESC").fetchall()
        return [self._to_dict(row) for row in rows]

    def get(self, doc_id: str) -> dict:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
        if row is None:
            raise AppError(404, "DOCUMENT_NOT_FOUND", "Document not found")
        return self._to_dict(row)

    def delete(self, doc_id: str) -> None:
        doc = self.get(doc_id)
        with self._connect() as conn:
            conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
        self.file_path(doc_id, doc["kind"]).unlink(missing_ok=True)

    @staticmethod
    def _to_dict(row: sqlite3.Row) -> dict:
        return {
            "id": row["id"],
            "name": row["name"],
            "kind": row["kind"],
            "size_bytes": row["size_bytes"],
            "status": row["status"],
            "stage": row["stage"],
            "page_count": row["page_count"],
            "language": row["language"],
            "ocr_used": None if row["ocr_used"] is None else bool(row["ocr_used"]),
            "has_preview": row["kind"] == "pdf",
            "created_at": row["created_at"],
            "error": json.loads(row["error_json"]) if row["error_json"] else None,
        }
