"""Draws a PDF page with the cited passage highlighted, as a PNG, for the "Page N" button."""

import pymupdf

DPI = 130
HIGHLIGHT = (1.0, 0.85, 0.1)
HIGHLIGHT_OPACITY = 0.4  # translucent: the highlighted text stays readable


def render_page(pdf: bytes, page_number: int, highlights: list[dict] | None) -> tuple[bytes, bool]:
    """(png, highlighted). `highlights` are fractions 0..1 of the page, as the backend returns them.

    highlighted is False when there were no coordinates: the whole page is shown and nothing is drawn.
    """
    document = pymupdf.open(stream=pdf, filetype="pdf")
    try:
        page = document[page_number - 1]
        width, height = page.rect.width, page.rect.height
        for box in highlights or []:
            rect = pymupdf.Rect(
                box["x"] * width, box["y"] * height, (box["x"] + box["w"]) * width, (box["y"] + box["h"]) * height
            )
            page.draw_rect(rect, color=None, fill=HIGHLIGHT, fill_opacity=HIGHLIGHT_OPACITY)
        return page.get_pixmap(dpi=DPI).tobytes("png"), bool(highlights)
    finally:
        document.close()
