"""Builds the demo documents as real PDFs from the synthetic texts in eval/sets. Nothing here is real or private.

    python demo/make_demo_pdfs.py

Writes, next to this script:
  lease_v1.pdf, lease_v2.pdf  Russian lease, and a revised version with known changes (for the comparison demo)
  handbook_en.pdf             English employee handbook
  rules_kk.pdf                Kazakh university rules

Cyrillic needs a TrueType font on the machine (Arial on Windows/macOS, DejaVu Sans on Linux).
The known answers are in eval/sets/*.json, so `python eval/answer_eval.py demo/lease_v1.pdf eval/sets/ru_contract.json`
measures the real model on exactly these documents.
"""
import json
import sys
from pathlib import Path

import pymupdf

HERE = Path(__file__).resolve().parent
SETS = HERE.parent / "eval" / "sets"
FONTS = (
    r"C:\Windows\Fonts\arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
)

# What changes between lease v1 and v2. The comparison must report exactly these.
LEASE_V2_CHANGES = [
    ("450 000 тенге", "500 000 тенге"),
    ("на срок 11 месяцев", "на срок 12 месяцев"),
    ("за 30 календарных дней", "за 60 календарных дней"),
    (" Помещение используется только под офис.", ""),  # a sentence removed
    ("по показаниям счётчиков.", "по показаниям счётчиков. Арендатор обязан застраховать помещение."),  # a sentence added
]


def font_file() -> str:
    for path in FONTS:
        if Path(path).exists():
            return path
    raise SystemExit("No TrueType font with Cyrillic found. Install Arial or DejaVu Sans.")


def write_pdf(pages: list[str], target: Path, font: str) -> None:
    doc = pymupdf.open()
    for text in pages:
        page = doc.new_page()
        rect = pymupdf.Rect(72, 72, page.rect.width - 72, page.rect.height - 72)
        leftover = page.insert_textbox(rect, text, fontname="demo", fontfile=font, fontsize=12)
        if leftover < 0:
            raise SystemExit(f"A page of {target.name} does not fit")
    doc.save(target)
    doc.close()
    print(f"wrote {target.relative_to(HERE.parent)} ({len(pages)} pages)")


def load_pages(name: str) -> list[str]:
    return json.loads((SETS / f"{name}.json").read_text(encoding="utf-8"))["pages"]


def main() -> None:
    font = font_file()
    lease = load_pages("ru_contract")
    revised = []
    for text in lease:
        for before, after in LEASE_V2_CHANGES:
            text = text.replace(before, after)
        revised.append(text)
    if revised == lease:
        raise SystemExit("The lease changes did not apply")
    write_pdf(lease, HERE / "lease_v1.pdf", font)
    write_pdf(revised, HERE / "lease_v2.pdf", font)
    write_pdf(load_pages("en_handbook"), HERE / "handbook_en.pdf", font)
    write_pdf(load_pages("kk_rules"), HERE / "rules_kk.pdf", font)


if __name__ == "__main__":
    sys.exit(main())
