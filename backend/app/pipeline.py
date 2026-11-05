import json
import logging
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

from app.chunking import build_chunks
from app.config import (
    MAX_OCR_PAGES,
    MAX_PAGES,
    WORKER_CONCURRENCY,
    WORKER_MEMORY_MB,
    WORKER_TIMEOUT_SECONDS,
)
from app.errors import AppError
from app.extraction import ExtractionError, Segment, extract_pdf, ocr_languages, read_document
from app.language import detect_language
from app.store import Store

log = logging.getLogger(__name__)

# Tests that replace the OCR call turn this off: a replacement cannot reach another process.
ISOLATE = True
BACKEND_DIR = Path(__file__).resolve().parent.parent
MAX_WORKER_OUTPUT_BYTES = 128 * 1024 * 1024
POLL_SECONDS = 0.1
# Only what reading a file needs. API keys and bot tokens stay out of the worker.
WORKER_ENV_NAMES = ("PATH", "LANG", "LC_ALL", "TESSDATA_PREFIX", "SYSTEMROOT", "TEMP", "TMP", "VIRTUAL_ENV")
_slots = threading.BoundedSemaphore(WORKER_CONCURRENCY)


def recover_unfinished(store: Store) -> None:
    """On startup: documents left `processing` by a restart are processed again, comparisons fail."""
    store.fail_unfinished_comparisons()
    for doc_id in store.unfinished_document_ids():
        process_document(store, doc_id)


def _resident_mb(pid: int) -> int:
    """Resident memory of a process, or 0 when it cannot be read (Windows; the process has just ended)."""
    try:
        with open(f"/proc/{pid}/statm", encoding="ascii") as stat:
            return int(stat.read().split()[1]) * os.sysconf("SC_PAGE_SIZE") // (1024 * 1024)
    except OSError:
        pass
    try:
        output = subprocess.run(["ps", "-o", "rss=", "-p", str(pid)], capture_output=True, text=True, timeout=2).stdout
        return int(output.strip() or 0) // 1024
    except (OSError, ValueError, subprocess.SubprocessError):
        return 0


def _kill(process: subprocess.Popen) -> None:
    try:
        if hasattr(os, "killpg"):
            os.killpg(process.pid, signal.SIGKILL)  # the whole group: OCR can start helpers
        else:
            process.kill()
    except OSError:
        pass
    process.wait()


def read_in_worker(path: Path, kind: str, on_ocr) -> tuple[list[Segment], bool, list[dict] | None]:
    """Runs app.worker under a time and memory limit. Blocking here is fine: this is a background thread."""
    too_complex = ExtractionError("DOCUMENT_TOO_COMPLEX", "This file needs too much time or memory to read")
    with _slots, tempfile.TemporaryDirectory(dir=path.parent, prefix=".worker-") as directory:
        output = Path(directory) / "result.json"
        job = {
            "path": str(path), "kind": kind, "output": str(output), "maxPages": MAX_PAGES, "maxOcrPages": MAX_OCR_PAGES,
            "memoryMb": WORKER_MEMORY_MB, "seconds": WORKER_TIMEOUT_SECONDS,
        }
        env = {name: os.environ[name] for name in WORKER_ENV_NAMES if name in os.environ}
        env.update(PYTHONPATH=str(BACKEND_DIR), HOME=directory, TMPDIR=directory)
        process = subprocess.Popen(
            [sys.executable, "-m", "app.worker", json.dumps(job)], env=env, cwd=BACKEND_DIR,
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True,
        )
        deadline = time.monotonic() + WORKER_TIMEOUT_SECONDS
        told_ocr = False
        while process.poll() is None:
            if not told_ocr and Path(str(output) + ".ocr").exists():
                told_ocr = True
                on_ocr()
            if time.monotonic() > deadline or _resident_mb(process.pid) > WORKER_MEMORY_MB:
                _kill(process)
                log.warning("Worker stopped at its limit, kind=%s", kind)
                raise too_complex
            time.sleep(POLL_SECONDS)
        if process.returncode != 0 or not output.exists() or output.stat().st_size > MAX_WORKER_OUTPUT_BYTES:
            raise too_complex
        result = json.loads(output.read_text(encoding="utf-8"))
    if "error" in result:
        raise ExtractionError(result["error"]["code"], result["error"]["message"])
    return [Segment(**segment) for segment in result["segments"]], result["ocrUsed"], result["blocks"]


def process_document(store: Store, doc_id: str) -> None:
    """Runs after upload. Ends the document in `ready` or `failed`."""
    try:
        doc = store.get(doc_id)
    except AppError:
        return  # deleted before processing started

    path = store.file_path(doc_id, doc["kind"])
    is_pdf = doc["kind"] == "pdf"
    try:
        store.set_stage(doc_id, "extracting")
        on_ocr = lambda: store.set_stage(doc_id, "ocr")  # noqa: E731
        if ISOLATE:
            segments, ocr_used, blocks = read_in_worker(path, doc["kind"], on_ocr)
        else:
            segments, ocr_used = read_document(
                path, doc["kind"], MAX_PAGES, MAX_OCR_PAGES, extract_pdf, ocr_languages, on_ocr
            )
            blocks = None
        if blocks is not None:
            path.with_suffix(".blocks.json").write_text(json.dumps(blocks, ensure_ascii=False), encoding="utf-8")

        store.set_stage(doc_id, "indexing")
        store.save_content(doc_id, segments, build_chunks(segments))
        language = detect_language(" ".join(segment.text for segment in segments))
        store.mark_ready(
            doc_id, page_count=len(segments) if is_pdf else None, language=language, ocr_used=ocr_used
        )
    except ExtractionError as exc:
        store.mark_failed(doc_id, exc.code, exc.message)
    except Exception:
        log.exception("Indexing failed for document %s", doc_id)
        store.mark_failed(doc_id, "INDEXING_FAILED", "The document could not be indexed")
    try:
        store.get(doc_id)
    except AppError:  # deleted while it was being read: leave nothing behind
        store.remove_files(doc_id, doc["kind"])
        store.clear_content(doc_id)
