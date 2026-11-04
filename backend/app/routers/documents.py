from fastapi import APIRouter, BackgroundTasks, Depends, File, UploadFile
from fastapi.responses import FileResponse, Response

from app.config import MAX_FILE_SIZE_BYTES, SUPPORTED_EXTENSIONS
from app.deps import get_store
from app.errors import AppError
from app.pipeline import process_document
from app.ratelimit import limit_uploads
from app.schemas import Document, DocumentList
from app.store import Store

router = APIRouter(prefix="/documents", tags=["documents"])

CHUNK_SIZE = 1024 * 1024
ZIP_MAGIC = b"PK\x03\x04"
PDF_MAGIC = b"%PDF-"


def _detect_kind(filename: str) -> str:
    name = filename.lower()
    for ext, kind in SUPPORTED_EXTENSIONS.items():
        if name.endswith(ext):
            return kind
    raise AppError(415, "UNSUPPORTED_TYPE", "Only PDF and DOCX files are supported")


@router.post("", status_code=202, response_model=Document, dependencies=[Depends(limit_uploads)])
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    store: Store = Depends(get_store),
) -> dict:
    filename = file.filename or ""
    kind = _detect_kind(filename)

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
    except Exception:
        path.unlink(missing_ok=True)
        raise

    document = store.insert(doc_id, filename, kind, size)
    background_tasks.add_task(process_document, store, doc_id)
    return document


@router.get("", response_model=DocumentList)
def list_documents(store: Store = Depends(get_store)) -> dict:
    return {"items": store.list()}


@router.get("/{doc_id}", response_model=Document)
def get_document(doc_id: str, store: Store = Depends(get_store)) -> dict:
    return store.get(doc_id)


@router.get("/{doc_id}/file")
def get_document_file(doc_id: str, store: Store = Depends(get_store)) -> FileResponse:
    doc = store.get(doc_id)
    if doc["status"] != "ready":
        raise AppError(409, "DOCUMENT_NOT_READY", "Document is still being processed")
    if doc["kind"] != "pdf":
        raise AppError(404, "PREVIEW_UNAVAILABLE", "No preview for this document")
    return FileResponse(store.file_path(doc_id, "pdf"), media_type="application/pdf")


@router.get("/{doc_id}/pages/{page}")
def get_document_page(doc_id: str, page: int, store: Store = Depends(get_store)) -> dict:
    doc = store.get(doc_id)
    if doc["status"] != "ready":
        raise AppError(409, "DOCUMENT_NOT_READY", "Document is still being processed")
    text = store.get_page_text(doc_id, page)
    if text is None:
        raise AppError(404, "PAGE_NOT_FOUND", "Page not found")
    return {"documentId": doc_id, "page": page, "text": text}


@router.delete("/{doc_id}", status_code=204, response_class=Response)
def delete_document(doc_id: str, store: Store = Depends(get_store)) -> Response:
    store.delete(doc_id)
    return Response(status_code=204)
