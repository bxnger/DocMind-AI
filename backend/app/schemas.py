from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.config import MAX_DOCUMENTS_PER_CONVERSATION, MAX_FILE_SIZE_BYTES, MAX_PAGES
from app.barcodes import barcode_reader_installed
from app.sitecheck import allowed_domains
from app.stores import enabled_stores

CAMEL = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class ApiError(BaseModel):
    model_config = CAMEL

    code: str
    message: str
    retryable: bool = False
    request_id: str | None = None


class Document(BaseModel):
    model_config = CAMEL

    id: str
    name: str
    kind: Literal["pdf", "docx"]
    size_bytes: int
    status: Literal["processing", "ready", "failed"]
    stage: Literal["queued", "extracting", "ocr", "indexing"] | None
    page_count: int | None
    language: Literal["kk", "ru", "en", "mixed"] | None
    ocr_used: bool | None
    has_preview: bool
    is_demo: bool = False
    created_at: datetime
    error: ApiError | None = None


class DocumentList(BaseModel):
    items: list[Document]


class CreateConversation(BaseModel):
    model_config = CAMEL

    document_ids: list[str] = Field(min_length=1, max_length=MAX_DOCUMENTS_PER_CONVERSATION)
    title: str | None = Field(default=None, max_length=200)


class SendMessage(BaseModel):
    model_config = CAMEL

    content: str = Field(max_length=10_000)
    language: Literal["kk", "ru", "en"] | None = None


class Limits(BaseModel):
    model_config = CAMEL

    max_file_size_bytes: int
    max_pages: int
    max_documents_per_conversation: int
    max_image_bytes: int


class Features(BaseModel):
    model_config = CAMEL

    claim_check: bool
    parts: bool
    photo_identify: bool
    price_lists: bool
    procurement: bool
    hr: bool
    price_check: bool = False  # POST /procurement/offers/check: on when PRICE_CHECK_DOMAINS lists at least one shop
    store_search: bool = False  # POST /procurement/search reads the shops (STORE_SEARCH); off: only the user's price lists
    barcodes: bool = False  # POST /procurement/barcodes can read a photo (zxing-cpp installed); text works always


class Capabilities(BaseModel):
    model_config = CAMEL

    version: str
    languages: list[Literal["kk", "ru", "en"]]
    ocr: bool  # OCR of scanned PDFs (Tesseract); a photo of a part is features.photoIdentify
    docx_preview: Literal["pdf", "none"]
    comparison: bool
    highlights: bool
    features: Features
    limits: Limits


MAX_IMAGE_BYTES = 8 * 1024 * 1024


def build_capabilities(version: str, ocr: bool, vision: bool = False) -> Capabilities:
    return Capabilities(
        version=version,
        languages=["kk", "ru", "en"] if ocr else [],
        ocr=ocr,
        docx_preview="none",
        comparison=True,
        highlights=True,
        features=Features(claim_check=True, parts=True, photo_identify=vision, price_lists=True, procurement=True, hr=False,
                          price_check=bool(allowed_domains()), store_search=bool(enabled_stores()),
                          barcodes=barcode_reader_installed()),
        limits=Limits(
            max_file_size_bytes=MAX_FILE_SIZE_BYTES,
            max_pages=MAX_PAGES,
            max_documents_per_conversation=MAX_DOCUMENTS_PER_CONVERSATION,
            max_image_bytes=MAX_IMAGE_BYTES,
        ),
    )
