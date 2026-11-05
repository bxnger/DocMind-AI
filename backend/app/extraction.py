import re
from dataclasses import dataclass
from pathlib import Path

import pymupdf as fitz
from docx import Document as DocxDocument
from docx.table import Table
from docx.text.paragraph import Paragraph

WHITESPACE = re.compile(r"\s+")
OCR_LANGUAGES = ("kaz", "rus", "eng")
OCR_DPI = 300


class ExtractionError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Segment:
    """A piece of text with its location: a PDF page, or a DOCX section under a heading."""

    page: int | None
    location: str | None
    text: str


def normalize(text: str) -> str:
    return WHITESPACE.sub(" ", text).strip()


def ocr_languages() -> str | None:
    """Tesseract languages usable for OCR, like "kaz+rus+eng", or None when OCR is not set up."""
    try:
        tessdata = fitz.get_tessdata()
    except Exception:
        return None
    if not tessdata:
        return None
    present = [lang for lang in OCR_LANGUAGES if (Path(tessdata) / f"{lang}.traineddata").exists()]
    return "+".join(present) or None


def extract_pdf(path: Path, languages: str | None = None) -> list[Segment]:
    """Text per page. With `languages`, every page is read with OCR instead of its text layer."""
    failure = "OCR_FAILED" if languages else "PARSE_FAILED"
    try:
        doc = fitz.open(path)
    except Exception as exc:
        raise ExtractionError("PARSE_FAILED", "The PDF could not be opened") from exc
    try:
        if doc.needs_pass:
            raise ExtractionError("PASSWORD_PROTECTED", "The PDF is password protected")
        segments = []
        for number, page in enumerate(doc, start=1):
            if languages:
                textpage = page.get_textpage_ocr(language=languages, dpi=OCR_DPI, full=True)
                text = page.get_text("text", textpage=textpage)
            else:
                text = page.get_text("text")
            segments.append(Segment(page=number, location=None, text=normalize(text)))
        return segments
    except ExtractionError:
        raise
    except Exception as exc:
        raise ExtractionError(failure, "The PDF could not be read") from exc
    finally:
        doc.close()


def extract_docx(path: Path) -> list[Segment]:
    """Paragraphs and tables, grouped into sections by heading."""
    try:
        document = DocxDocument(path)
        blocks = list(document.iter_inner_content())
    except Exception as exc:
        raise ExtractionError("PARSE_FAILED", "The DOCX could not be read") from exc

    sections: list[tuple[str | None, list[str]]] = [(None, [])]
    for block in blocks:
        if isinstance(block, Paragraph):
            text = normalize(block.text)
            if not text:
                continue
            style = block.style.name.lower() if block.style is not None else ""
            if style.startswith(("heading", "title")):
                sections.append((text, [text]))
            else:
                sections[-1][1].append(text)
        elif isinstance(block, Table):
            sections[-1][1].extend(_table_lines(block))

    return [
        Segment(page=None, location=heading, text=" ".join(lines))
        for heading, lines in sections
        if lines
    ]


def docx_blocks(path: Path) -> list[dict]:
    """The DOCX as a flat list of blocks for a text reader: headings, paragraphs and table rows.

    Word has no stable page numbers, so each block gets its position (`index`) and the heading it sits under
    (`section`). Block text is normalized exactly like the indexed text, so a cited quote is a substring of the
    block that contains it.
    """
    try:
        document = DocxDocument(path)
        content = list(document.iter_inner_content())
    except Exception as exc:
        raise ExtractionError("PARSE_FAILED", "The DOCX could not be read") from exc

    blocks: list[dict] = []
    section: str | None = None

    def add(kind: str, text: str) -> None:
        blocks.append({"index": len(blocks), "kind": kind, "section": section, "text": text})

    for block in content:
        if isinstance(block, Paragraph):
            text = normalize(block.text)
            if not text:
                continue
            style = block.style.name.lower() if block.style is not None else ""
            if style.startswith(("heading", "title")):
                section = text
                add("heading", text)
            else:
                add("paragraph", text)
        elif isinstance(block, Table):
            for line in _table_lines(block):
                add("table_row", line)
    return blocks


def find_block(blocks: list[dict], quote: str) -> int | None:
    """Index of the block that contains `quote`, or None."""
    needle = normalize(quote)
    if not needle:
        return None
    return next((block["index"] for block in blocks if needle in block["text"]), None)


def _table_lines(table: Table) -> list[str]:
    lines = []
    for row in table.rows:
        cells: list[str] = []
        for cell in row.cells:
            text = normalize(cell.text)
            if text and (not cells or cells[-1] != text):  # merged cells repeat in row.cells
                cells.append(text)
        if cells:
            lines.append(" | ".join(cells))
    return lines
