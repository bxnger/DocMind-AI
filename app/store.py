import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from app.errors import AppError
from app.extraction import Segment

SCHEMA = [
    """
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
    """,
    """
    CREATE TABLE IF NOT EXISTS segments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        page INTEGER,
        location TEXT,
        text TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id TEXT NOT NULL,
        segment_id INTEGER NOT NULL,
        text TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS conversation_documents (
        conversation_id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        PRIMARY KEY (conversation_id, document_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS comparisons (
        id TEXT PRIMARY KEY,
        document_a_id TEXT NOT NULL,
        document_b_id TEXT NOT NULL,
        status TEXT NOT NULL,
        progress REAL,
        summary TEXT,
        differences_json TEXT,
        error_json TEXT,
        created_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        answer_status TEXT,
        sources_json TEXT,
        created_at TEXT NOT NULL
    )
    """,
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Store:
    """SQLite for metadata and text, one file per document on disk."""

    def __init__(self, data_dir: Path) -> None:
        self.files_dir = data_dir / "files"
        self.files_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = data_dir / "app.db"
        with self._db() as conn:
            for statement in SCHEMA:
                conn.execute(statement)

    @contextmanager
    def _db(self) -> Iterator[sqlite3.Connection]:
        # Background tasks write while requests read: WAL plus a wait avoids "database is locked".
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    @staticmethod
    def new_id() -> str:
        return uuid.uuid4().hex

    def file_path(self, doc_id: str, kind: str) -> Path:
        return self.files_dir / f"{doc_id}.{kind}"

    # Documents

    def insert(self, doc_id: str, name: str, kind: str, size_bytes: int) -> dict:
        with self._db() as conn:
            conn.execute(
                "INSERT INTO documents (id, name, kind, size_bytes, status, stage, created_at)"
                " VALUES (?, ?, ?, ?, 'processing', 'queued', ?)",
                (doc_id, name, kind, size_bytes, _now()),
            )
        return self.get(doc_id)

    def list(self) -> list[dict]:
        with self._db() as conn:
            rows = conn.execute("SELECT * FROM documents ORDER BY created_at DESC, rowid DESC").fetchall()
        return [self._document(row) for row in rows]

    def get(self, doc_id: str) -> dict:
        with self._db() as conn:
            row = conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
        if row is None:
            raise AppError(404, "DOCUMENT_NOT_FOUND", "Document not found")
        return self._document(row)

    def delete(self, doc_id: str) -> None:
        doc = self.get(doc_id)
        with self._db() as conn:
            conn.execute("DELETE FROM chunks WHERE document_id = ?", (doc_id,))
            conn.execute("DELETE FROM segments WHERE document_id = ?", (doc_id,))
            conn.execute("DELETE FROM conversation_documents WHERE document_id = ?", (doc_id,))
            conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
        self.file_path(doc_id, doc["kind"]).unlink(missing_ok=True)

    def unfinished_document_ids(self) -> list[str]:
        """Documents whose processing was cut off, for example by a server restart."""
        with self._db() as conn:
            rows = conn.execute("SELECT id FROM documents WHERE status = 'processing' ORDER BY rowid").fetchall()
        return [row["id"] for row in rows]

    def fail_unfinished_comparisons(self) -> None:
        error = {
            "code": "INTERNAL_ERROR",
            "message": "The server restarted during the comparison. Start it again",
            "retryable": True,
            "requestId": None,
        }
        with self._db() as conn:
            conn.execute(
                "UPDATE comparisons SET status = 'failed', progress = NULL, error_json = ?"
                " WHERE status = 'processing'",
                (json.dumps(error),),
            )

    def set_stage(self, doc_id: str, stage: str) -> None:
        with self._db() as conn:
            conn.execute("UPDATE documents SET stage = ? WHERE id = ?", (stage, doc_id))

    def save_content(self, doc_id: str, segments: list[Segment], chunks: list[tuple[int, str]]) -> None:
        """Replaces any earlier text for the document. `chunks` holds (segment index, text)."""
        with self._db() as conn:
            conn.execute("DELETE FROM chunks WHERE document_id = ?", (doc_id,))
            conn.execute("DELETE FROM segments WHERE document_id = ?", (doc_id,))
            segment_ids = []
            for seq, segment in enumerate(segments):
                cursor = conn.execute(
                    "INSERT INTO segments (document_id, seq, page, location, text) VALUES (?, ?, ?, ?, ?)",
                    (doc_id, seq, segment.page, segment.location, segment.text),
                )
                segment_ids.append(cursor.lastrowid)
            for seq, text in chunks:
                conn.execute(
                    "INSERT INTO chunks (document_id, segment_id, text) VALUES (?, ?, ?)",
                    (doc_id, segment_ids[seq], text),
                )

    def mark_ready(
        self, doc_id: str, page_count: int | None, language: str | None = None, ocr_used: bool = False
    ) -> None:
        with self._db() as conn:
            conn.execute(
                "UPDATE documents SET status = 'ready', stage = NULL, page_count = ?, language = ?,"
                " ocr_used = ?, error_json = NULL WHERE id = ?",
                (page_count, language, int(ocr_used), doc_id),
            )

    def segments_for_document(self, doc_id: str) -> list[dict]:
        with self._db() as conn:
            rows = conn.execute(
                "SELECT page, location, text FROM segments WHERE document_id = ? ORDER BY seq", (doc_id,)
            ).fetchall()
        return [{"page": row["page"], "location": row["location"], "text": row["text"]} for row in rows]

    def get_page_text(self, doc_id: str, page: int) -> str | None:
        with self._db() as conn:
            row = conn.execute(
                "SELECT text FROM segments WHERE document_id = ? AND page = ?", (doc_id, page)
            ).fetchone()
        return None if row is None else row["text"]

    def mark_failed(self, doc_id: str, code: str, message: str) -> None:
        error = {"code": code, "message": message, "retryable": False, "requestId": None}
        with self._db() as conn:
            conn.execute(
                "UPDATE documents SET status = 'failed', stage = NULL, error_json = ? WHERE id = ?",
                (json.dumps(error), doc_id),
            )

    def chunks_for_documents(self, doc_ids: list[str]) -> list[dict]:
        """Chunks of the given documents, in upload order, each with its source segment."""
        if not doc_ids:
            return []
        marks = ",".join("?" for _ in doc_ids)
        with self._db() as conn:
            rows = conn.execute(
                f"""
                SELECT chunks.text AS text, segments.text AS segment_text, segments.page AS page,
                       segments.location AS location, documents.id AS document_id, documents.name AS document_name
                FROM chunks
                JOIN segments ON segments.id = chunks.segment_id
                JOIN documents ON documents.id = chunks.document_id
                WHERE chunks.document_id IN ({marks})
                ORDER BY documents.created_at, documents.rowid, segments.seq, chunks.id
                """,
                doc_ids,
            ).fetchall()
        return [
            {
                "documentId": row["document_id"],
                "documentName": row["document_name"],
                "page": row["page"],
                "location": row["location"],
                "text": row["text"],
                "segmentText": row["segment_text"],
            }
            for row in rows
        ]

    @staticmethod
    def _document(row: sqlite3.Row) -> dict:
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

    # Conversations

    def create_conversation(self, title: str, document_ids: list[str]) -> dict:
        conversation_id = self.new_id()
        now = _now()
        with self._db() as conn:
            conn.execute(
                "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (conversation_id, title, now, now),
            )
            for position, document_id in enumerate(document_ids):
                conn.execute(
                    "INSERT INTO conversation_documents (conversation_id, document_id, position) VALUES (?, ?, ?)",
                    (conversation_id, document_id, position),
                )
        return self.get_conversation(conversation_id)

    def get_conversation(self, conversation_id: str) -> dict:
        with self._db() as conn:
            row = conn.execute("SELECT * FROM conversations WHERE id = ?", (conversation_id,)).fetchone()
            if row is None:
                raise AppError(404, "CONVERSATION_NOT_FOUND", "Conversation not found")
            return self._conversation(conn, row)

    def list_conversations(self) -> list[dict]:
        with self._db() as conn:
            rows = conn.execute("SELECT * FROM conversations ORDER BY updated_at DESC, rowid DESC").fetchall()
            return [self._conversation(conn, row) for row in rows]

    def delete_conversation(self, conversation_id: str) -> None:
        self.get_conversation(conversation_id)
        with self._db() as conn:
            conn.execute("DELETE FROM messages WHERE conversation_id = ?", (conversation_id,))
            conn.execute("DELETE FROM conversation_documents WHERE conversation_id = ?", (conversation_id,))
            conn.execute("DELETE FROM conversations WHERE id = ?", (conversation_id,))

    def add_message(
        self,
        conversation_id: str,
        role: str,
        content: str,
        answer_status: str | None = None,
        sources: list[dict] | None = None,
        message_id: str | None = None,
    ) -> dict:
        message_id = message_id or self.new_id()
        now = _now()
        with self._db() as conn:
            conn.execute(
                "INSERT INTO messages (id, conversation_id, role, content, answer_status, sources_json, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    message_id,
                    conversation_id,
                    role,
                    content,
                    answer_status,
                    json.dumps(sources, ensure_ascii=False) if sources is not None else None,
                    now,
                ),
            )
            conn.execute("UPDATE conversations SET updated_at = ? WHERE id = ?", (now, conversation_id))
        return {
            "id": message_id,
            "role": role,
            "content": content,
            "createdAt": now,
            "answerStatus": answer_status,
            "sources": sources,
        }

    def list_messages(self, conversation_id: str) -> list[dict]:
        self.get_conversation(conversation_id)
        with self._db() as conn:
            rows = conn.execute(
                "SELECT * FROM messages WHERE conversation_id = ? ORDER BY rowid", (conversation_id,)
            ).fetchall()
        return [
            {
                "id": row["id"],
                "role": row["role"],
                "content": row["content"],
                "createdAt": row["created_at"],
                "answerStatus": row["answer_status"],
                "sources": json.loads(row["sources_json"]) if row["sources_json"] else None,
            }
            for row in rows
        ]

    # Comparisons

    def create_comparison(self, document_a_id: str, document_b_id: str) -> dict:
        comparison_id = self.new_id()
        with self._db() as conn:
            conn.execute(
                "INSERT INTO comparisons (id, document_a_id, document_b_id, status, progress, created_at)"
                " VALUES (?, ?, ?, 'processing', 0.0, ?)",
                (comparison_id, document_a_id, document_b_id, _now()),
            )
        return self.get_comparison(comparison_id)

    def get_comparison(self, comparison_id: str) -> dict:
        with self._db() as conn:
            row = conn.execute("SELECT * FROM comparisons WHERE id = ?", (comparison_id,)).fetchone()
        if row is None:
            raise AppError(404, "COMPARISON_NOT_FOUND", "Comparison not found")
        return {
            "id": row["id"],
            "documentAId": row["document_a_id"],
            "documentBId": row["document_b_id"],
            "status": row["status"],
            "progress": row["progress"],
            "summary": row["summary"],
            "differences": json.loads(row["differences_json"]) if row["differences_json"] else None,
            "error": json.loads(row["error_json"]) if row["error_json"] else None,
        }

    def set_comparison_progress(self, comparison_id: str, progress: float) -> None:
        with self._db() as conn:
            conn.execute("UPDATE comparisons SET progress = ? WHERE id = ?", (progress, comparison_id))

    def finish_comparison(self, comparison_id: str, summary: str, differences: list[dict]) -> None:
        with self._db() as conn:
            conn.execute(
                "UPDATE comparisons SET status = 'ready', progress = 1.0, summary = ?, differences_json = ?"
                " WHERE id = ?",
                (summary, json.dumps(differences, ensure_ascii=False), comparison_id),
            )

    def fail_comparison(self, comparison_id: str, code: str, message: str) -> None:
        error = {"code": code, "message": message, "retryable": False, "requestId": None}
        with self._db() as conn:
            conn.execute(
                "UPDATE comparisons SET status = 'failed', progress = NULL, error_json = ? WHERE id = ?",
                (json.dumps(error), comparison_id),
            )

    @staticmethod
    def _conversation(conn: sqlite3.Connection, row: sqlite3.Row) -> dict:
        document_ids = [
            doc["document_id"]
            for doc in conn.execute(
                "SELECT document_id FROM conversation_documents WHERE conversation_id = ? ORDER BY position",
                (row["id"],),
            ).fetchall()
        ]
        return {
            "id": row["id"],
            "title": row["title"],
            "documentIds": document_ids,
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }
