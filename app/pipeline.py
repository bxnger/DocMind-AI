import logging

from app.chunking import build_chunks
from app.config import MAX_PAGES
from app.errors import AppError
from app.extraction import ExtractionError, extract_docx, extract_pdf
from app.language import detect_language
from app.store import Store

log = logging.getLogger(__name__)


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
        segments = extract_pdf(path) if is_pdf else extract_docx(path)
        if is_pdf and len(segments) > MAX_PAGES:
            raise ExtractionError("PARSE_FAILED", f"The document has more than {MAX_PAGES} pages")
        if not any(segment.text for segment in segments):
            raise ExtractionError(
                "NO_TEXT_FOUND", "No text found. Scanned documents need OCR, which is not supported yet"
            )

        store.set_stage(doc_id, "indexing")
        store.save_content(doc_id, segments, build_chunks(segments))
        language = detect_language(" ".join(segment.text for segment in segments))
        store.mark_ready(doc_id, page_count=len(segments) if is_pdf else None, language=language)
    except ExtractionError as exc:
        store.mark_failed(doc_id, exc.code, exc.message)
    except Exception:
        log.exception("Indexing failed for document %s", doc_id)
        store.mark_failed(doc_id, "INDEXING_FAILED", "The document could not be indexed")
