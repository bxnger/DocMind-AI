import io
import zipfile

import pymupdf as fitz
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.deps import get_answerer, get_store
from app.llm import Excerpt
from app.main import create_app
from app.store import Store


class FakeAnswerer:
    """Stands in for the Claude API. Streams `reply` in small pieces and records the calls."""

    def __init__(self, reply: str = "") -> None:
        self.reply = reply
        self.calls: list[tuple[str, list[Excerpt], str | None]] = []

    async def stream(self, question, excerpts, language):
        self.calls.append((question, excerpts, language))
        for start in range(0, len(self.reply), 7):
            yield self.reply[start : start + 7]


@pytest.fixture
def store(tmp_path) -> Store:
    return Store(tmp_path)


@pytest.fixture
def answerer() -> FakeAnswerer:
    return FakeAnswerer()


@pytest.fixture
def client(store, answerer) -> TestClient:
    app = create_app(Settings(data_dir=store.files_dir.parent, cors_origins=("http://localhost:5173",)))
    app.dependency_overrides[get_store] = lambda: store
    app.dependency_overrides[get_answerer] = lambda: answerer
    return TestClient(app)


def make_pdf(pages: list[str]) -> bytes:
    """A real PDF with one line of ASCII text per page. An empty string gives a blank page."""
    doc = fitz.open()
    for text in pages:
        page = doc.new_page()
        if text:
            page.insert_text((72, 72), text)
    data = doc.tobytes()
    doc.close()
    return data


def make_docx(sections: list[tuple[str, list[str]]]) -> bytes:
    from docx import Document

    document = Document()
    for heading, paragraphs in sections:
        if heading:
            document.add_heading(heading, level=1)
        for paragraph in paragraphs:
            document.add_paragraph(paragraph)
    buf = io.BytesIO()
    document.save(buf)
    return buf.getvalue()


def fake_docx_bytes() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("word/document.xml", "<w:document/>")
    return buf.getvalue()


def upload(client, name: str, data: bytes):
    return client.post("/api/v1/documents", files={"file": (name, data, "application/octet-stream")})
