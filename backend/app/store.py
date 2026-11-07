import json
import secrets
import sqlite3
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
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
    """
    CREATE TABLE IF NOT EXISTS sessions (
        owner_id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        client_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS ai_usage (
        day TEXT NOT NULL,
        scope TEXT NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (day, scope)
    )
    """,
    # Procurement records of one session: a document's part list, a price list, a photo confirmation. JSON bodies.
    """
    CREATE TABLE IF NOT EXISTS records (
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        document_id TEXT,
        data_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (kind, id)
    )
    """,
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def seconds_until_midnight() -> int:
    now = datetime.now(timezone.utc)
    return int((datetime(now.year, now.month, now.day, tzinfo=timezone.utc) + timedelta(days=1) - now).total_seconds()) + 1


@dataclass(frozen=True)
class UploadQuota:
    max_documents: int
    max_bytes: int
    max_processing: int
    global_max_processing: int
    global_max_bytes: int


class Store:
    """SQLite for metadata and text, one file per document on disk."""

    def __init__(self, data_dir: Path) -> None:
        self.files_dir = data_dir / "files"
        self.files_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = data_dir / "app.db"
        with self._db() as conn:
            for statement in SCHEMA:
                conn.execute(statement)
            # Databases made before not_found reasons were saved get the column; their old rows keep NULL.
            columns = {row[1] for row in conn.execute("PRAGMA table_info(messages)")}
            if "reason" not in columns:
                conn.execute("ALTER TABLE messages ADD COLUMN reason TEXT")
            # Rows made before sessions have no owner, so no session can reach them. Nothing old becomes public.
            for table in ("documents", "conversations", "comparisons"):
                if "owner_id" not in {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}:
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN owner_id TEXT")
            if "is_demo" not in {row[1] for row in conn.execute("PRAGMA table_info(documents)")}:
                conn.execute("ALTER TABLE documents ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0")

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

    @staticmethod
    def new_owner_id() -> str:
        return secrets.token_hex(16)

    def file_path(self, doc_id: str, kind: str) -> Path:
        return self.files_dir / f"{doc_id}.{kind}"

    # Documents

    def insert(
        self, doc_id: str, name: str, kind: str, size_bytes: int, owner_id: str | None = None, quota: UploadQuota | None = None
    ) -> dict:
        with self._db() as conn:
            conn.execute("BEGIN IMMEDIATE")  # the check and the insert are one step, so parallel uploads cannot pass together
            if quota:
                self._check_upload_quota(conn, owner_id, size_bytes, quota)
            conn.execute(
                "INSERT INTO documents (id, name, kind, size_bytes, status, stage, created_at, owner_id)"
                " VALUES (?, ?, ?, ?, 'processing', 'queued', ?, ?)",
                (doc_id, name, kind, size_bytes, _now(), owner_id),
            )
        return self.get(doc_id)

    @staticmethod
    def _check_upload_quota(conn: sqlite3.Connection, owner_id: str | None, size_bytes: int, quota: UploadQuota) -> None:
        count, stored, processing = conn.execute(
            "SELECT COUNT(*), COALESCE(SUM(CASE WHEN status != 'failed' THEN size_bytes END), 0),"
            " COALESCE(SUM(status = 'processing'), 0) FROM documents WHERE owner_id = ?",
            (owner_id,),
        ).fetchone()
        if count >= quota.max_documents or stored + size_bytes > quota.max_bytes:
            raise AppError(429, "QUOTA_EXCEEDED", "This session's document quota is full. Delete a document first")
        if processing >= quota.max_processing:
            raise AppError(429, "RATE_LIMITED", "Wait for your documents to finish processing", retryable=True, retry_after=10)
        total, queued = conn.execute(
            "SELECT COALESCE(SUM(CASE WHEN status != 'failed' THEN size_bytes END), 0),"
            " COALESCE(SUM(status = 'processing'), 0) FROM documents"
        ).fetchone()
        if queued >= quota.global_max_processing:
            raise AppError(429, "RATE_LIMITED", "The server is busy processing documents", retryable=True, retry_after=30)
        if total + size_bytes > quota.global_max_bytes:
            raise AppError(503, "STORAGE_FULL", "The server has no room for more documents", retryable=True)

    def list(self, owner_id: str | None = None) -> list[dict]:
        """A session's own documents and the public demo ones. Without an owner: all, for maintenance only."""
        where, params = ("WHERE owner_id = ? OR is_demo = 1", (owner_id,)) if owner_id else ("", ())
        with self._db() as conn:
            rows = conn.execute(f"SELECT * FROM documents {where} ORDER BY created_at DESC, rowid DESC", params).fetchall()
        return [self._document(row) for row in rows]

    def get(self, doc_id: str, owner_id: str | None = None) -> dict:
        """With an owner, someone else's document does not exist. Routes always pass the owner."""
        with self._db() as conn:
            if owner_id:
                row = conn.execute(
                    "SELECT * FROM documents WHERE id = ? AND (owner_id = ? OR is_demo = 1)", (doc_id, owner_id)
                ).fetchone()
            else:
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
            conn.execute("DELETE FROM comparisons WHERE document_a_id = ? OR document_b_id = ?", (doc_id, doc_id))
            conn.execute("DELETE FROM records WHERE document_id = ?", (doc_id,))
            conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
        self.remove_files(doc_id, doc["kind"])

    def remove_files(self, doc_id: str, kind: str) -> None:
        path = self.file_path(doc_id, kind)
        path.unlink(missing_ok=True)
        path.with_suffix(".blocks.json").unlink(missing_ok=True)

    def mark_demo(self, doc_id: str) -> None:
        with self._db() as conn:
            conn.execute("UPDATE documents SET is_demo = 1, owner_id = NULL WHERE id = ?", (doc_id,))

    # Sessions

    def create_session(self, owner_id: str, token_hash: str, client_key: str, ttl_hours: int, max_active: int) -> str:
        now = datetime.now(timezone.utc)
        expires = (now + timedelta(hours=ttl_hours)).isoformat()
        with self._db() as conn:
            conn.execute("BEGIN IMMEDIATE")
            active = conn.execute("SELECT COUNT(*) FROM sessions WHERE expires_at > ?", (now.isoformat(),)).fetchone()[0]
            if active >= max_active:
                raise AppError(429, "RATE_LIMITED", "Too many active sessions, try again later", retryable=True, retry_after=300)
            conn.execute(
                "INSERT INTO sessions (owner_id, token_hash, client_key, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
                (owner_id, token_hash, client_key, now.isoformat(), expires),
            )
        return expires

    def find_session(self, token_hash: str) -> dict | None:
        with self._db() as conn:
            row = conn.execute(
                "SELECT owner_id, client_key, expires_at FROM sessions WHERE token_hash = ? AND expires_at > ?",
                (token_hash, _now()),
            ).fetchone()
        return dict(row) if row else None

    def session_usage(self, owner_id: str) -> dict:
        with self._db() as conn:
            documents, stored = conn.execute(
                "SELECT COUNT(*), COALESCE(SUM(CASE WHEN status != 'failed' THEN size_bytes END), 0) FROM documents WHERE owner_id = ?",
                (owner_id,),
            ).fetchone()
            used = conn.execute("SELECT count FROM ai_usage WHERE day = ? AND scope = ?", (_today(), f"session:{owner_id}")).fetchone()
        return {"documents": documents, "storedBytes": stored, "aiRequestsToday": used[0] if used else 0}

    def delete_owner_data(self, owner_id: str) -> None:
        with self._db() as conn:
            doc_ids = [row[0] for row in conn.execute("SELECT id FROM documents WHERE owner_id = ? AND is_demo = 0", (owner_id,))]
            conversation_ids = [row[0] for row in conn.execute("SELECT id FROM conversations WHERE owner_id = ?", (owner_id,))]
        for doc_id in doc_ids:
            self.delete(doc_id)
        for conversation_id in conversation_ids:
            self.delete_conversation(conversation_id)
        with self._db() as conn:
            conn.execute("DELETE FROM comparisons WHERE owner_id = ?", (owner_id,))
            conn.execute("DELETE FROM records WHERE owner_id = ?", (owner_id,))

    # Procurement records

    def put_record(self, kind: str, record_id: str, owner_id: str, data: dict, document_id: str | None = None) -> None:
        with self._db() as conn:
            conn.execute(
                "INSERT INTO records (kind, id, owner_id, document_id, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
                " ON CONFLICT(kind, id) DO UPDATE SET data_json = excluded.data_json",
                (kind, record_id, owner_id, document_id, json.dumps(data, ensure_ascii=False), _now()),
            )

    def get_record(self, kind: str, record_id: str, owner_id: str) -> dict | None:
        """None when it does not exist or belongs to another session: the caller says 404 either way."""
        with self._db() as conn:
            row = conn.execute(
                "SELECT data_json FROM records WHERE kind = ? AND id = ? AND owner_id = ?", (kind, record_id, owner_id)
            ).fetchone()
        return json.loads(row["data_json"]) if row else None

    def list_records(self, kind: str, owner_id: str, document_id: str | None = None) -> list[dict]:
        query = "SELECT data_json FROM records WHERE kind = ? AND owner_id = ?"
        params: list = [kind, owner_id]
        if document_id is not None:
            query += " AND document_id = ?"
            params.append(document_id)
        with self._db() as conn:
            rows = conn.execute(query + " ORDER BY created_at, rowid", params).fetchall()
        return [json.loads(row["data_json"]) for row in rows]

    def count_records(self, kind: str, owner_id: str) -> int:
        with self._db() as conn:
            return conn.execute("SELECT COUNT(*) FROM records WHERE kind = ? AND owner_id = ?", (kind, owner_id)).fetchone()[0]

    def delete_record(self, kind: str, record_id: str, owner_id: str) -> bool:
        with self._db() as conn:
            cursor = conn.execute("DELETE FROM records WHERE kind = ? AND id = ? AND owner_id = ?", (kind, record_id, owner_id))
        return cursor.rowcount > 0

    def delete_session(self, owner_id: str) -> None:
        self.delete_owner_data(owner_id)
        with self._db() as conn:
            conn.execute("DELETE FROM sessions WHERE owner_id = ?", (owner_id,))

    def purge_expired_sessions(self) -> int:
        with self._db() as conn:
            owners = [row[0] for row in conn.execute("SELECT owner_id FROM sessions WHERE expires_at <= ?", (_now(),))]
            conn.execute("DELETE FROM ai_usage WHERE day < ?", ((datetime.now(timezone.utc) - timedelta(days=2)).date().isoformat(),))
        for owner_id in owners:
            self.delete_session(owner_id)
        return len(owners)

    # AI budget. Kept in the database, so a restart does not hand out a new day's worth of requests.

    def reserve_ai_request(
        self, owner_id: str, client_key: str, session_limit: int, client_limit: int, global_limit: int
    ) -> None:
        day = _today()
        scopes = [(f"session:{owner_id}", session_limit, "AI_SESSION_BUDGET_EXCEEDED"), (f"client:{client_key}", client_limit, "AI_BUDGET_EXCEEDED"), ("global", global_limit, "AI_BUDGET_EXCEEDED")]
        with self._db() as conn:
            conn.execute("BEGIN IMMEDIATE")
            for scope, limit, code in scopes:
                row = conn.execute("SELECT count FROM ai_usage WHERE day = ? AND scope = ?", (day, scope)).fetchone()
                if (row[0] if row else 0) >= limit:
                    raise AppError(429, code, "The daily AI allowance is used up. It renews at 00:00 UTC", retry_after=seconds_until_midnight())
            for scope, _limit, _code in scopes:
                conn.execute(
                    "INSERT INTO ai_usage (day, scope, count) VALUES (?, ?, 1)"
                    " ON CONFLICT (day, scope) DO UPDATE SET count = count + 1",
                    (day, scope),
                )

    def unfinished_document_ids(self) -> list[str]:
        """Documents whose processing was cut off, for example by a server restart."""
        with self._db() as conn:
            rows = conn.execute("SELECT id FROM documents WHERE status = 'processing' ORDER BY rowid").fetchall()
        return [row["id"] for row in rows]

    def fail_unfinished_part_lists(self) -> int:
        """A part list left `processing` by a restart would be polled forever: it fails, and POST starts it again."""
        error = {"code": "INTERNAL_ERROR", "message": "The server restarted during the extraction. Start it again"}
        changed = 0
        with self._db() as conn:
            rows = conn.execute("SELECT id, owner_id, data_json FROM records WHERE kind = 'part_list'").fetchall()
            for row in rows:
                data = json.loads(row["data_json"])
                if data.get("status") == "processing":
                    data.update(status="failed", progress=None, error=error)
                    conn.execute(
                        "UPDATE records SET data_json = ? WHERE kind = 'part_list' AND id = ? AND owner_id = ?",
                        (json.dumps(data, ensure_ascii=False), row["id"], row["owner_id"]),
                    )
                    changed += 1
        return changed

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

    def clear_content(self, doc_id: str) -> None:
        with self._db() as conn:
            conn.execute("DELETE FROM chunks WHERE document_id = ?", (doc_id,))
            conn.execute("DELETE FROM segments WHERE document_id = ?", (doc_id,))

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
        """Keeps only the record of the failure: no partial text and no stored file stay behind."""
        error = {"code": code, "message": message, "retryable": False, "requestId": None}
        row = None
        with self._db() as conn:
            row = conn.execute("SELECT kind FROM documents WHERE id = ?", (doc_id,)).fetchone()
            conn.execute("DELETE FROM chunks WHERE document_id = ?", (doc_id,))
            conn.execute("DELETE FROM segments WHERE document_id = ?", (doc_id,))
            conn.execute(
                "UPDATE documents SET status = 'failed', stage = NULL, error_json = ? WHERE id = ?",
                (json.dumps(error), doc_id),
            )
        if row:
            self.remove_files(doc_id, row["kind"])

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
            "is_demo": bool(row["is_demo"]),
            "created_at": row["created_at"],
            "error": json.loads(row["error_json"]) if row["error_json"] else None,
        }

    # Conversations

    def create_conversation(self, title: str, document_ids: list[str], owner_id: str | None = None, max_owned: int | None = None) -> dict:
        conversation_id = self.new_id()
        now = _now()
        with self._db() as conn:
            conn.execute("BEGIN IMMEDIATE")
            if max_owned is not None and conn.execute("SELECT COUNT(*) FROM conversations WHERE owner_id = ?", (owner_id,)).fetchone()[0] >= max_owned:
                raise AppError(429, "QUOTA_EXCEEDED", "This session has too many conversations. Delete one first")
            conn.execute(
                "INSERT INTO conversations (id, title, created_at, updated_at, owner_id) VALUES (?, ?, ?, ?, ?)",
                (conversation_id, title, now, now, owner_id),
            )
            for position, document_id in enumerate(document_ids):
                conn.execute(
                    "INSERT INTO conversation_documents (conversation_id, document_id, position) VALUES (?, ?, ?)",
                    (conversation_id, document_id, position),
                )
        return self.get_conversation(conversation_id)

    def get_conversation(self, conversation_id: str, owner_id: str | None = None) -> dict:
        with self._db() as conn:
            if owner_id:
                row = conn.execute("SELECT * FROM conversations WHERE id = ? AND owner_id = ?", (conversation_id, owner_id)).fetchone()
            else:
                row = conn.execute("SELECT * FROM conversations WHERE id = ?", (conversation_id,)).fetchone()
            if row is None:
                raise AppError(404, "CONVERSATION_NOT_FOUND", "Conversation not found")
            return self._conversation(conn, row)

    def list_conversations(self, owner_id: str | None = None) -> list[dict]:
        where, params = ("WHERE owner_id = ?", (owner_id,)) if owner_id else ("", ())
        with self._db() as conn:
            rows = conn.execute(f"SELECT * FROM conversations {where} ORDER BY updated_at DESC, rowid DESC", params).fetchall()
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
        reason: str | None = None,
    ) -> dict:
        message_id = message_id or self.new_id()
        now = _now()
        with self._db() as conn:
            conn.execute(
                "INSERT INTO messages (id, conversation_id, role, content, answer_status, sources_json, created_at, reason)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    message_id,
                    conversation_id,
                    role,
                    content,
                    answer_status,
                    json.dumps(sources, ensure_ascii=False) if sources is not None else None,
                    now,
                    reason,
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
            "reason": reason,
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
                "reason": row["reason"],  # why a not_found happened, the same values as the done event
            }
            for row in rows
        ]

    # Comparisons

    def create_comparison(
        self, document_a_id: str, document_b_id: str, owner_id: str | None = None, max_owned: int | None = None, max_running: int | None = None
    ) -> dict:
        comparison_id = self.new_id()
        with self._db() as conn:
            conn.execute("BEGIN IMMEDIATE")
            if max_owned is not None:
                owned, mine = conn.execute(
                    "SELECT COUNT(*), COALESCE(SUM(status = 'processing'), 0) FROM comparisons WHERE owner_id = ?", (owner_id,)
                ).fetchone()
                if owned >= max_owned:
                    raise AppError(429, "QUOTA_EXCEEDED", "This session has too many comparisons")
                running = conn.execute("SELECT COUNT(*) FROM comparisons WHERE status = 'processing'").fetchone()[0]
                if mine >= 1 or (max_running is not None and running >= max_running):
                    raise AppError(429, "RATE_LIMITED", "A comparison is already running, try again soon", retryable=True, retry_after=10)
            conn.execute(
                "INSERT INTO comparisons (id, document_a_id, document_b_id, status, progress, created_at, owner_id)"
                " VALUES (?, ?, ?, 'processing', 0.0, ?, ?)",
                (comparison_id, document_a_id, document_b_id, _now(), owner_id),
            )
        return self.get_comparison(comparison_id)

    def get_comparison(self, comparison_id: str, owner_id: str | None = None) -> dict:
        with self._db() as conn:
            if owner_id:
                row = conn.execute("SELECT * FROM comparisons WHERE id = ? AND owner_id = ?", (comparison_id, owner_id)).fetchone()
            else:
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
