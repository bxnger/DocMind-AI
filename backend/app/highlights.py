from pathlib import Path

import pymupdf

WORDS_PER_WINDOW = 6


def quote_highlights(path: Path, page_number: int, quote: str) -> list[dict]:
    """Rectangles of `quote` on a PDF page as fractions (0..1) of the page size.

    Searches for the whole quote first; if the PDF's line breaks defeat that, searches it in
    short word windows. Returns [] when the text cannot be located. Assumes an unrotated page.
    """
    try:
        doc = pymupdf.open(path)
    except Exception:
        return []
    try:
        page = doc[page_number - 1]
        width, height = page.rect.width, page.rect.height
        rects = page.search_for(quote)
        if not rects:
            words = quote.split()
            for start in range(0, len(words), WORDS_PER_WINDOW):
                rects.extend(page.search_for(" ".join(words[start : start + WORDS_PER_WINDOW])))
        return [
            {
                "x": _fraction(rect.x0, width),
                "y": _fraction(rect.y0, height),
                "w": _fraction(rect.x1 - rect.x0, width),
                "h": _fraction(rect.y1 - rect.y0, height),
            }
            for rect in rects
        ]
    except Exception:
        return []
    finally:
        doc.close()


def _fraction(value: float, size: float) -> float:
    return round(min(max(value / size, 0.0), 1.0), 4)
