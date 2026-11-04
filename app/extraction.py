import re
from dataclasses import dataclass
from pathlib import Path

import pymupdf as fitz
from docx import Document as DocxDocument

WHITESPACE = re.compile(r"\s+")


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


def extract_pdf(path: Path) -> list[Segment]:
    try:
        doc = fitz.open(path)
    except Exception as exc:
        raise ExtractionError("PARSE_FAILED", "The PDF could not be opened") from exc
    try:
        if doc.needs_pass:
            raise ExtractionError("PASSWORD_PROTECTED", "The PDF is password protected")
        return [
            Segment(page=number, location=None, text=normalize(page.get_text("text")))
            for number, page in enumerate(doc, start=1)
        ]
    except ExtractionError:
        raise
    except Exception as exc:
        raise ExtractionError("PARSE_FAILED", "The PDF could not be read") from exc
    finally:
        doc.close()


def extract_docx(path: Path) -> list[Segment]:
    """Paragraphs only. Tables are not read yet."""
    try:
        document = DocxDocument(path)
    except Exception as exc:
        raise ExtractionError("PARSE_FAILED", "The DOCX could not be read") from exc

    sections: list[tuple[str | None, list[str]]] = [(None, [])]
    for paragraph in document.paragraphs:
        text = normalize(paragraph.text)
        if not text:
            continue
        style = paragraph.style.name.lower() if paragraph.style is not None else ""
        if style.startswith(("heading", "title")):
            sections.append((text, [text]))
        else:
            sections[-1][1].append(text)

    return [
        Segment(page=None, location=heading, text=" ".join(lines))
        for heading, lines in sections
        if lines
    ]
