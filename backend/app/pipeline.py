import logging

from app.chunking import build_chunks
from app.config import MAX_PAGES
from app.errors import AppError
from app.extraction import ExtractionError, extract_docx, extract_pdf, ocr_languages
from app.language import detect_language
from app.store import Store

log = logging.getLogger(__name__)


def recover_unfinished(store: Store) -> None:
    """On startup: documents left `processing` by a restart are processed again, comparisons fail."""
    store.fail_unfinished_comparisons()
    for doc_id in store.unfinished_document_ids():
        process_document(store, doc_id)


def process_document(store: Store, doc_id: str) -> None:
    """Runs after upload. Ends the document in `ready` or `failed`."""
    try:
        doc = store.get(doc_id)
    except AppError:
        return  # deleted before processing started

    path = store.file_path(doc_id, doc["kind"])
    is_pdf = doc["kind"] == "pdf"
    ocr_used = False
    try:
        store.set_stage(doc_id, "extracting")
        segments = extract_pdf(path) if is_pdf else extract_docx(path)
        if is_pdf and len(segments) > MAX_PAGES:
            raise ExtractionError("PARSE_FAILED", f"The document has more than {MAX_PAGES} pages")

        if is_pdf and not any(segment.text for segment in segments):
            languages = ocr_languages()
            if languages is None:
                raise ExtractionError(
                    "NO_TEXT_FOUND", "No text found. Scanned documents need OCR, which is not set up on this server"
                )
            store.set_stage(doc_id, "ocr")
            segments = extract_pdf(path, languages)
            ocr_used = True
        if not any(segment.text for segment in segments):
            raise ExtractionError("NO_TEXT_FOUND", "No text found in the document")

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
