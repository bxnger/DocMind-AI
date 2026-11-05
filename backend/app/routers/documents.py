from collections import OrderedDict
import re

from fastapi import APIRouter, BackgroundTasks, Depends, File, Request, UploadFile
from fastapi.responses import FileResponse, Response

from app.auth import Session, current_session, limited
from app.config import (
    MAX_DOCX_ENTRIES,
    MAX_DOCX_UNPACKED_BYTES,
    MAX_DOCX_XML_BYTES,
    MAX_FILE_SIZE_BYTES,
    SUPPORTED_EXTENSIONS,
)
from app.deps import get_store
from app.errors import AppError
from app.extraction import ExtractionError, inspect_docx, stored_blocks
from app.facts import extract_facts, suggested_questions
from app.highlights import quote_highlights
from app.pipeline import process_document
from app.schemas import Document, DocumentList
from app.store import Store, UploadQuota

router = APIRouter(prefix="/documents", tags=["documents"])

CHUNK_SIZE = 1024 * 1024
ZIP_MAGIC = b"PK\x03\x04"
PDF_MAGIC = b"%PDF-"
CONTROL_CHARACTERS = re.compile(r"[\x00-\x1f\x7f]")
MAX_NAME_CHARS = 255
MAX_CACHED_FACTS = 128
# Locating every fact on its page is the slow part, and a processed document does not change.
FACTS_CACHE: OrderedDict[str, dict] = OrderedDict()


def _detect_kind(filename: str) -> str:
    name = filename.lower()
    for ext, kind in SUPPORTED_EXTENSIONS.items():
        if name.endswith(ext):
            return kind
    raise AppError(415, "UNSUPPORTED_TYPE", "Only PDF and DOCX files are supported")


@router.post("", status_code=202, response_model=Document)
async def upload_document(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    store: Store = Depends(get_store),
    session: Session = Depends(limited("upload")),
) -> dict:
    filename = CONTROL_CHARACTERS.sub("", file.filename or "")[-MAX_NAME_CHARS:]
    kind = _detect_kind(filename)
    settings = request.app.state.settings

    doc_id = store.new_id()
    path = store.file_path(doc_id, kind)
    size = 0
    head = b""
    try:
        with path.open("wb") as out:
            while chunk := await file.read(CHUNK_SIZE):
                size += len(chunk)
                if size > MAX_FILE_SIZE_BYTES:
                    raise AppError(413, "FILE_TOO_LARGE", "File is larger than 20 MB")
                if len(head) < 8:
                    head += chunk[:8]
                out.write(chunk)
        if size == 0:
            raise AppError(422, "VALIDATION_ERROR", "File is empty")
        magic_ok = head.startswith(PDF_MAGIC) if kind == "pdf" else head.startswith(ZIP_MAGIC)
        if not magic_ok:
            raise AppError(415, "UNSUPPORTED_TYPE", "File content does not match its extension")
        if kind == "docx":
            try:
                inspect_docx(path, MAX_DOCX_ENTRIES, MAX_DOCX_UNPACKED_BYTES, MAX_DOCX_XML_BYTES)
            except ExtractionError as exc:
                status = 413 if exc.code == "DOCX_TOO_LARGE" else 415
                raise AppError(status, exc.code, exc.message) from None
        document = store.insert(
            doc_id, filename, kind, size, owner_id=session.owner_id,
            quota=UploadQuota(
                settings.session_max_documents, settings.session_max_bytes, settings.session_max_processing,
                settings.global_max_processing, settings.global_max_bytes,
            ),
        )
    except Exception:
        path.unlink(missing_ok=True)
        raise

    background_tasks.add_task(process_document, store, doc_id)
    return document


@router.get("", response_model=DocumentList)
def list_documents(store: Store = Depends(get_store), session: Session = Depends(limited("read"))) -> dict:
    return {"items": store.list(session.owner_id)}


@router.get("/{doc_id}", response_model=Document)
def get_document(doc_id: str, store: Store = Depends(get_store), session: Session = Depends(limited("read"))) -> dict:
    return store.get(doc_id, session.owner_id)


@router.get("/{doc_id}/file")
def get_document_file(doc_id: str, store: Store = Depends(get_store), session: Session = Depends(limited("read"))) -> FileResponse:
    doc = store.get(doc_id, session.owner_id)
    if doc["status"] != "ready":
        raise AppError(409, "DOCUMENT_NOT_READY", "Document is still being processed")
    if doc["kind"] != "pdf":
        raise AppError(404, "PREVIEW_UNAVAILABLE", "No preview for this document")
    return FileResponse(store.file_path(doc_id, "pdf"), media_type="application/pdf")


@router.get("/{doc_id}/pages/{page}")
def get_document_page(doc_id: str, page: int, store: Store = Depends(get_store), session: Session = Depends(limited("read"))) -> dict:
    doc = store.get(doc_id, session.owner_id)
    if doc["status"] != "ready":
        raise AppError(409, "DOCUMENT_NOT_READY", "Document is still being processed")
    text = store.get_page_text(doc_id, page)
    if text is None:
        raise AppError(404, "PAGE_NOT_FOUND", "Page not found")
    return {"documentId": doc_id, "page": page, "text": text}


@router.get("/{doc_id}/text")
def get_document_text(doc_id: str, store: Store = Depends(get_store), session: Session = Depends(limited("text"))) -> dict:
    """The extracted text, for a reader that shows it without the original layout.

    PDF: one block per page. DOCX: one block per heading, paragraph or table row, each with the heading it sits
    under. Word has no stable pages, so there are none; use `index` and `section`.
    """
    doc = store.get(doc_id, session.owner_id)
    if doc["status"] != "ready":
        raise AppError(409, "DOCUMENT_NOT_READY", "Document is still being processed")
    if doc["kind"] == "docx":
        try:
            blocks = stored_blocks(store.file_path(doc_id, "docx"))
        except (ExtractionError, OSError):
            raise AppError(500, "INTERNAL_ERROR", "The document text could not be read") from None
        for block in blocks:
            block["page"] = None
    else:
        blocks = [
            {"index": number, "kind": "page", "section": None, "page": segment["page"], "text": segment["text"]}
            for number, segment in enumerate(store.segments_for_document(doc_id))
        ]
    return {"documentId": doc_id, "kind": doc["kind"], "language": doc.get("language"), "blocks": blocks}


def fact_segments(store: Store, doc: dict) -> list[dict]:
    """The text the facts are found in. A DOCX section joins its heading, paragraphs and table rows into one string,
    so a "sentence" could run from a heading into a paragraph or across rows: for DOCX each block is its own segment,
    and its index travels with the fact as `paragraph`."""
    if doc["kind"] == "docx":
        try:
            blocks = stored_blocks(store.file_path(doc["id"], "docx"))
        except (ExtractionError, OSError):
            return store.segments_for_document(doc["id"])
        return [
            {"page": None, "location": block["section"], "text": block["text"], "paragraph": block["index"]}
            for block in blocks
            if block["kind"] != "heading"
        ]
    return store.segments_for_document(doc["id"])


@router.get("/{doc_id}/facts")
def get_document_facts(doc_id: str, store: Store = Depends(get_store), session: Session = Depends(limited("facts"))) -> dict:
    """Dates, deadlines, amounts and percentages with their exact sentence, plus questions worth asking."""
    doc = store.get(doc_id, session.owner_id)  # always first: the cache below is shared
    if doc["status"] != "ready":
        raise AppError(409, "DOCUMENT_NOT_READY", "Document is still being processed")
    if doc_id in FACTS_CACHE:
        return FACTS_CACHE[doc_id]
    facts = extract_facts(fact_segments(store, doc))
    for fact in facts:
        highlights = []
        if doc["kind"] == "pdf" and fact["page"] is not None:
            highlights = quote_highlights(store.file_path(doc_id, "pdf"), fact["page"], fact["quote"])
        fact["highlights"] = highlights
    result = {
        "documentId": doc_id,
        "facts": facts,
        "suggestedQuestions": suggested_questions(facts, doc.get("language")),
    }
    FACTS_CACHE[doc_id] = result
    while len(FACTS_CACHE) > MAX_CACHED_FACTS:
        FACTS_CACHE.popitem(last=False)
    return result


@router.delete("/{doc_id}", status_code=204, response_class=Response)
def delete_document(doc_id: str, store: Store = Depends(get_store), session: Session = Depends(current_session)) -> Response:
    doc = store.get(doc_id, session.owner_id)
    if doc["is_demo"]:
        raise AppError(403, "DEMO_READ_ONLY", "Demo documents cannot be changed")
    store.delete(doc_id)
    return Response(status_code=204)
