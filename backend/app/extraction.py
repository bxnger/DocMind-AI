import json
import re
import zipfile
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


SOFT_HYPHEN = "­"


def visible_hyphens(text: str) -> str:
    """A PDF holds only drawn glyphs, so a soft hyphen in its text is a hyphen on the page: some fonts map the hyphen
    glyph to U+00AD ("6205­2RS"). Quotes, codes and the model then see the ordinary "-"."""
    return text.replace(SOFT_HYPHEN, "-")


# Tesseract reads the Latin letters of a code like "QA-2027-041" as Cyrillic ones ("ОА-2027-041") when Kazakh or Russian
# is listed before English, and "Q" has no Cyrillic look-alike to translate back. So a page that holds such a code is read
# once more with English only, and the code is taken from that reading.
_CYRILLIC_CODE = re.compile(r"(?<![\w-])[А-ЯЁӘІҢҒҮҰҚӨҺ]{1,4}((?:-\d+){2,})(?![\w-])")
_LATIN_CODE = re.compile(r"(?<![\w-])[A-Z]{1,4}((?:-\d+){2,})(?![\w-])")


def needs_latin_codes(text: str) -> bool:
    return _CYRILLIC_CODE.search(text) is not None


def repair_codes(text: str, latin_text: str) -> str:
    """Replaces each Cyrillic-lettered code of `text` by the Latin-lettered code with the same numbers that
    `latin_text` (the same page read as English) holds. A code the English reading does not hold is kept."""
    latin = {match.group(1): match.group(0) for match in _LATIN_CODE.finditer(latin_text)}
    return _CYRILLIC_CODE.sub(lambda match: latin.get(match.group(1), match.group(0)), text)


# Where Tesseract language data usually lives. Found live: without TESSDATA_PREFIX the API reported "no OCR" on a
# Windows machine that had kaz/rus/eng data in the user's folder, because PyMuPDF's own search failed (it reads the
# Tesseract console output, which is not UTF-8 on a Russian Windows) and the default folder held English only.
TESSDATA_CANDIDATES = (
    Path(r"C:\Program Files\Tesseract-OCR\tessdata"),
    Path(r"C:\Program Files (x86)\Tesseract-OCR\tessdata"),
    Path("/usr/share/tesseract-ocr/5/tessdata"),
    Path("/usr/share/tesseract-ocr/4.00/tessdata"),
    Path("/usr/share/tessdata"),
    Path("/usr/local/share/tessdata"),
    Path("/opt/homebrew/share/tessdata"),
)


def _languages_in(folder: Path) -> list[str]:
    return [lang for lang in OCR_LANGUAGES if (folder / f"{lang}.traineddata").exists()]


def find_tessdata() -> Path | None:
    """The folder with the most of our OCR languages: TESSDATA_PREFIX when it has them, else a usual place.

    The folder found is put into TESSDATA_PREFIX, so OCR and the reading worker (which gets that variable) use it.
    """
    import os

    folders = [Path(os.environ["TESSDATA_PREFIX"])] if os.environ.get("TESSDATA_PREFIX") else []
    try:
        # The reading worker runs with a minimal environment, where Windows has no home folder: never fail on it.
        candidates = (Path.home() / "tessdata", *TESSDATA_CANDIDATES)
    except (RuntimeError, KeyError):
        candidates = TESSDATA_CANDIDATES
    folders += [folder for folder in candidates if folder not in folders]
    best = max(folders, key=lambda folder: len(_languages_in(folder)), default=None)
    if best is None or not _languages_in(best):
        try:
            found = fitz.get_tessdata()
        except Exception:
            return None
        best = Path(found) if found else None
        if best is None or not _languages_in(best):
            return None
    if os.environ.get("TESSDATA_PREFIX") != str(best):
        os.environ["TESSDATA_PREFIX"] = str(best)
    return best


def ocr_languages() -> str | None:
    """Tesseract languages usable for OCR, like "kaz+rus+eng", or None when OCR is not set up."""
    tessdata = find_tessdata()
    if tessdata is None:
        return None
    return "+".join(_languages_in(tessdata)) or None


def scanned_pages(path: Path) -> list[int]:
    """Numbers of the pages that have no text layer but hold an image: scans inside an otherwise digital PDF.
    A blank page (no image) is not one."""
    try:
        with fitz.open(path) as doc:
            return [
                number for number, page in enumerate(doc, start=1)
                if not page.get_text("text").strip() and page.get_images(full=False)
            ]
    except Exception:
        return []


def extract_pdf(path: Path, languages: str | None = None, only_pages: set[int] | None = None) -> list[Segment]:
    """Text per page. With `languages`, every page is read with OCR instead of its text layer, or, with
    `only_pages`, just those pages (the others keep their text layer)."""
    failure = "OCR_FAILED" if languages else "PARSE_FAILED"
    try:
        doc = fitz.open(path)
    except Exception as exc:
        raise ExtractionError("PARSE_FAILED", "The PDF could not be opened") from exc
    try:
        if doc.needs_pass:
            raise ExtractionError("PASSWORD_PROTECTED", "The PDF is password protected")
        if doc.page_count == 0:  # a damaged file that PyMuPDF "repairs" into an empty document
            raise ExtractionError("PARSE_FAILED", "The PDF is damaged: no pages could be read")
        segments = []
        for number, page in enumerate(doc, start=1):
            if languages and (only_pages is None or number in only_pages):
                textpage = page.get_textpage_ocr(language=languages, dpi=OCR_DPI, full=True)
                text = page.get_text("text", textpage=textpage)
                if needs_latin_codes(text) and languages != "eng":
                    english = page.get_textpage_ocr(language="eng", dpi=OCR_DPI, full=True)
                    text = repair_codes(text, page.get_text("text", textpage=english))
            else:
                text = page.get_text("text")
            segments.append(Segment(page=number, location=None, text=normalize(visible_hyphens(text))))
        return segments
    except ExtractionError:
        raise
    except Exception as exc:
        raise ExtractionError(failure, "The PDF could not be read") from exc
    finally:
        doc.close()


W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
MC_FALLBACK = "{http://schemas.openxmlformats.org/markup-compatibility/2006}Fallback"
NOTE_PARTS = (("word/footnotes.xml", "footnote"), ("word/endnotes.xml", "endnote"))
NOTES_HEADING = "Footnotes"


def _text_of(element, text_boxes: list) -> str:
    """The text a reader sees in a paragraph element: inserted text is kept, deleted text is not.

    Text boxes are collected apart (they are blocks of their own), and the duplicate copy Word keeps in
    mc:Fallback is skipped.
    """
    parts: list[str] = []

    def walk(node) -> None:
        for child in node:
            tag = child.tag
            if tag in (W + "del", MC_FALLBACK):
                continue
            if tag == W + "txbxContent":
                text_boxes.append(child)
            elif tag == W + "t":
                parts.append(child.text or "")
            elif tag in (W + "tab", W + "br", W + "cr"):
                parts.append(" ")
            else:
                walk(child)

    walk(element)
    return normalize("".join(parts))


def _container_items(container, document) -> list[tuple[str, str, bool]]:
    """(kind, text, is_heading) for the paragraphs, text boxes and table rows inside a body, in order."""
    items: list[tuple[str, str, bool]] = []
    for child in container:
        if child.tag == W + "p":
            boxes: list = []
            text = _text_of(child, boxes)
            if text:
                style = Paragraph(child, document).style
                name = style.name.lower() if style is not None and style.name else ""
                heading = name.startswith(("heading", "title"))
                items.append(("heading" if heading else "paragraph", text, heading))
            for box in boxes:
                items.extend(("text_box", item[1], False) for item in _container_items(box, document) if item[1])
        elif child.tag == W + "tbl":
            items.extend(("table_row", line, False) for line in _table_rows(child))
        elif child.tag == W + "sdt":  # content controls wrap ordinary paragraphs
            content = child.find(W + "sdtContent")
            if content is not None:
                items.extend(_container_items(content, document))
    return items


def _table_rows(table) -> list[str]:
    """One line per row, cells joined by " | ". A nested table is flattened into its cell."""
    rows = []
    for row in table.findall(W + "tr"):
        cells: list[str] = []
        for cell in row.findall(W + "tc"):
            pieces = []
            for child in cell:
                if child.tag == W + "p":
                    pieces.append(_text_of(child, []))
                elif child.tag == W + "tbl":
                    pieces.append(" ; ".join(_table_rows(child)))
            text = normalize(" ".join(piece for piece in pieces if piece))
            if text and (not cells or cells[-1] != text):  # merged cells repeat
                cells.append(text)
        if cells:
            rows.append(" | ".join(cells))
    return rows


def _notes(path: Path) -> list[str]:
    """Footnote and endnote texts, "[n] text". Not part of the body, so python-docx does not return them."""
    from lxml import etree

    notes: list[str] = []
    parser = etree.XMLParser(resolve_entities=False, no_network=True)  # an uploaded file is untrusted
    try:
        with zipfile.ZipFile(path) as archive:
            for part, tag in NOTE_PARTS:
                if part not in archive.namelist():
                    continue
                root = etree.fromstring(archive.read(part), parser)
                for note in root.findall(W + tag):
                    if note.get(W + "type") in ("separator", "continuationSeparator", "continuationNotice"):
                        continue
                    text = normalize(" ".join(_text_of(paragraph, []) for paragraph in note.findall(W + "p")))
                    if text:
                        notes.append(f"[{note.get(W + 'id')}] {text}")
    except (zipfile.BadZipFile, etree.XMLSyntaxError, KeyError):
        return notes
    return notes


def _docx_items(path: Path) -> list[tuple[str, str, bool]]:
    try:
        document = DocxDocument(path)
        items = _container_items(document.element.body, document)
    except Exception as exc:
        raise ExtractionError("PARSE_FAILED", "The DOCX could not be read") from exc
    notes = _notes(path)
    if notes:
        items.append(("heading", NOTES_HEADING, True))
        items.extend(("footnote", note, False) for note in notes)
    return items


def extract_docx(path: Path) -> list[Segment]:
    """Paragraphs, text boxes, tables (nested too), tracked insertions and footnotes, grouped into sections by heading.

    Not extracted: headers and footers, deleted text, text inside images.
    """
    sections: list[tuple[str | None, list[str]]] = [(None, [])]
    for _kind, text, heading in _docx_items(path):
        if heading:
            sections.append((text, [text]))
        else:
            sections[-1][1].append(text)
    return [Segment(page=None, location=heading, text=" ".join(lines)) for heading, lines in sections if lines]


def inspect_docx(path: Path, max_entries: int, max_unpacked: int, max_xml: int) -> None:
    """Checks the archive's directory, without unpacking anything. Python's reader never returns more than an
    entry declares, so a false size in the directory cannot get past these limits."""
    try:
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
    except (zipfile.BadZipFile, OSError) as exc:
        raise ExtractionError("UNSUPPORTED_TYPE", "The file is not a valid DOCX") from exc
    if "word/document.xml" not in {entry.filename for entry in entries}:
        raise ExtractionError("UNSUPPORTED_TYPE", "The file is not a valid DOCX")
    xml = sum(entry.file_size for entry in entries if entry.filename.endswith((".xml", ".rels")))
    if len(entries) > max_entries or sum(entry.file_size for entry in entries) > max_unpacked or xml > max_xml:
        raise ExtractionError("DOCX_TOO_LARGE", "The DOCX is too large once unpacked")


def pdf_page_count(path: Path) -> int | None:
    try:
        with fitz.open(path) as doc:
            return None if doc.needs_pass else doc.page_count
    except Exception:
        return None  # extract_pdf reports what is wrong


def read_document(path, kind, max_pages, max_ocr_pages, extract_pdf_fn=None, ocr_languages_fn=None, on_ocr=None):
    """(segments, ocr_used) for a file. Runs inside the worker process, so it must not import app.config."""
    read_pdf, languages_of = extract_pdf_fn or extract_pdf, ocr_languages_fn or ocr_languages
    if kind != "pdf":
        segments, ocr_used = extract_docx(path), False
    else:
        pages = pdf_page_count(path)
        if pages is not None and pages > max_pages:
            raise ExtractionError("PARSE_FAILED", f"The document has more than {max_pages} pages")
        segments, ocr_used = read_pdf(path), False
        if len(segments) > max_pages:
            raise ExtractionError("PARSE_FAILED", f"The document has more than {max_pages} pages")
        if not any(segment.text for segment in segments):
            languages = languages_of()
            if languages is None:
                raise ExtractionError("NO_TEXT_FOUND", "No text found. Scanned documents need OCR, which is not set up on this server")
            if len(segments) > max_ocr_pages:
                raise ExtractionError("OCR_FAILED", f"Scans of more than {max_ocr_pages} pages cannot be read")
            if on_ocr:
                on_ocr()
            segments, ocr_used = read_pdf(path, languages), True
        elif any(not segment.text for segment in segments):
            # A digital PDF with scanned pages in it (a signed page, an attachment): only those pages need OCR.
            # Without OCR, or with too many such pages, the text pages are still used, as before.
            scans = scanned_pages(path)
            languages = languages_of() if scans else None
            if languages and len(scans) <= max_ocr_pages:
                if on_ocr:
                    on_ocr()
                segments, ocr_used = read_pdf(path, languages, only_pages=set(scans)), True
    if not any(segment.text for segment in segments):
        raise ExtractionError("NO_TEXT_FOUND", "No text found in the document")
    return segments, ocr_used


def stored_blocks(path: Path) -> list[dict]:
    """The blocks the worker saved, so that reading a document never parses an uploaded file in the API process."""
    saved = path.with_suffix(".blocks.json")
    try:
        return json.loads(saved.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return docx_blocks(path)


def docx_blocks(path: Path) -> list[dict]:
    """The DOCX as a flat list of blocks for a text reader: headings, paragraphs, text boxes, table rows, footnotes.

    Word has no stable page numbers, so each block gets its position (`index`) and the heading it sits
    under (`section`). Block text is normalized exactly like the indexed text, so a cited quote is a
    substring of the block that contains it.
    """
    blocks: list[dict] = []
    section: str | None = None
    for kind, text, heading in _docx_items(path):
        if heading:
            section = text
        blocks.append({"index": len(blocks), "kind": kind, "section": section, "text": text})
    return blocks


def find_block(blocks: list[dict], quote: str) -> int | None:
    """Index of the block that contains `quote`, or None."""
    needle = normalize(quote)
    if not needle:
        return None
    inside = next((block["index"] for block in blocks if needle in block["text"]), None)
    if inside is not None:
        return inside
    # A quote often begins with its section heading ("Footnotes [2] Penalty is ..."), so it spans two blocks.
    # Then the block with the most text that the quote contains is the passage itself, not the heading.
    contained = [block for block in blocks if block["text"] and block["text"] in needle]
    return max(contained, key=lambda block: len(block["text"]))["index"] if contained else None
