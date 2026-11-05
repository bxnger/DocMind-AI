"""OCR check on scans made from the demo documents. No model, no network.

    python eval/ocr_eval.py

Needs Tesseract data for kaz, rus and eng: set TESSDATA_PREFIX to a folder with kaz.traineddata, rus.traineddata and
eng.traineddata (https://github.com/tesseract-ocr/tessdata). PyMuPDF does the recognition with its own library.

One page of each demo document becomes an image-only PDF (no text layer), clean (200 dpi) and degraded (150 dpi,
slightly crooked, blurred, speckled, strong JPEG compression). The recognized words are compared with the words of the
original page. These are synthetic scans of clean typeset text: real photographed pages will do worse.
"""
import difflib
import io
import random
import re
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pymupdf  # noqa: E402
from PIL import Image, ImageFilter  # noqa: E402

from app.extraction import extract_pdf, ocr_languages  # noqa: E402

DEMO = Path(__file__).resolve().parent.parent / "demo"
CASES = [("Russian lease, page 2", "lease_v1.pdf", 1), ("Kazakh rules, page 3", "rules_kk.pdf", 2), ("English handbook, page 4", "handbook_en.pdf", 3)]


def words(text: str) -> list[str]:
    return re.findall(r"\w+", text.lower())


def make_scan(source: Path, index: int, target: Path, degraded: bool) -> str:
    """Writes an image-only PDF of one page and returns the page's real text."""
    src = pymupdf.open(source)
    truth = src[index].get_text("text")
    image = Image.open(io.BytesIO(src[index].get_pixmap(dpi=150 if degraded else 200).tobytes("png"))).convert("L")
    if degraded:
        rng = random.Random(5)
        image = image.rotate(1.2, fillcolor=255).filter(ImageFilter.GaussianBlur(0.8))
        pixels = image.load()
        for _ in range(int(image.width * image.height * 0.02)):
            pixels[rng.randrange(image.width), rng.randrange(image.height)] = rng.choice((0, 255))
        jpeg = io.BytesIO()
        image.save(jpeg, "JPEG", quality=55)
        image = Image.open(io.BytesIO(jpeg.getvalue()))
    png = io.BytesIO()
    image.convert("RGB").save(png, "PNG")
    out = pymupdf.open()
    page = out.new_page(width=src[index].rect.width, height=src[index].rect.height)
    page.insert_image(page.rect, stream=png.getvalue())
    out.save(target)
    return truth


def main() -> int:
    languages = ocr_languages()
    if not languages:
        print("OCR is not set up: set TESSDATA_PREFIX to a folder with kaz, rus and eng .traineddata files.")
        return 1
    print(f"languages: {languages}\n")
    print(f"{'scan':<26}{'quality':<10}{'words right':>14}{'time':>8}")
    with tempfile.TemporaryDirectory() as tmp:
        for label, name, index in CASES:
            for degraded in (False, True):
                target = Path(tmp) / f"{name}.{degraded}.pdf"
                truth = make_scan(DEMO / name, index, target, degraded)
                started = time.perf_counter()
                try:
                    text = extract_pdf(target, languages)[0].text
                except Exception as exc:  # an unreadable scan is a result, not a crash
                    text = ""
                    print(f"  ({type(exc).__name__} on {label})")
                seconds = time.perf_counter() - started
                real = words(truth)
                matcher = difflib.SequenceMatcher(None, real, words(text), autojunk=False)
                right = sum(block.size for block in matcher.get_matching_blocks())
                print(f"{label:<26}{'degraded' if degraded else 'clean':<10}{right:>8}/{len(real):<5}{right / len(real):>4.0%}{seconds:>6.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
