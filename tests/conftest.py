import io
import zipfile
from pathlib import Path

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
        self.histories: list[list[tuple[str, str]]] = []

    async def stream(self, question, excerpts, language, history):
        self.calls.append((question, excerpts, language))
        self.histories.append(history)
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


CYRILLIC_FONT = next(
    (
        path
        for path in (
            r"C:\Windows\Fonts\arial.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/System/Library/Fonts/Supplemental/Arial.ttf",
        )
        if Path(path).exists()
    ),
    None,
)
needs_cyrillic_font = pytest.mark.skipif(CYRILLIC_FONT is None, reason="no TrueType font with Cyrillic found")


def make_pdf(pages: list[str]) -> bytes:
    """A real PDF with one line of text per page. An empty string gives a blank page.

    Non-ASCII text needs a TrueType font on the machine (see needs_cyrillic_font).
    """
    doc = fitz.open()
    for text in pages:
        page = doc.new_page()
        if not text:
            continue
        if text.isascii():
            page.insert_text((72, 72), text)
        else:
            page.insert_text((72, 72), text, fontname="cyr", fontfile=CYRILLIC_FONT)
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
