"""Builds the demo documents as real PDFs from the synthetic texts in eval/sets. Nothing here is real or private.

    python demo/make_demo_pdfs.py

Writes, next to this script:
  lease_v1.pdf, lease_v2.pdf  Russian lease, and a revised version with known changes (for the comparison demo)
  lease_v1.docx               the same lease as a Word file (for the DOCX demo)
  lease_long.pdf              the lease plus 14 pages of ordinary clauses (20 pages), where search matters
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


def write_docx(pages: list[str], target: Path) -> None:
    """The lease as a Word file: one heading per clause group, each sentence its own paragraph."""
    from docx import Document

    document = Document()
    for number, text in enumerate(pages, 1):
        document.add_heading(f"Раздел {number}", level=1)
        for sentence in text.replace("? ", "?\n").replace(". ", ".\n").split("\n"):
            if sentence.strip():
                document.add_paragraph(sentence.strip())
    document.save(target)
    print(f"wrote {target.relative_to(HERE.parent)} ({len(pages)} sections)")


SUBJECTS = ["Арендодатель", "Арендатор", "Подрядчик", "Управляющая компания", "Собственник здания"]
VERBS = ["обязан уведомить", "вправе проверить", "несёт ответственность за", "обязуется предоставить", "согласовывает"]
OBJECTS = ["состояние инженерных систем", "график уборки помещений", "порядок допуска сотрудников", "перечень оборудования", "правила пожарной безопасности", "правила доступа к складским помещениям"]
CONDITIONS = ["в письменной форме", "в течение разумного срока", "за свой счёт", "по предварительному согласованию", "в рабочие дни"]


def long_lease(lease: list[str], extra_pages: int = 14) -> list[str]:
    """The six lease pages followed by pages of ordinary clauses that share words with the questions.

    More than 12 chunks, so the whole document is not sent to the model: finding the right page needs the search.
    Deterministic, so the expected pages of the six real pages stay 1 to 6.
    """
    import random

    rng = random.Random(11)
    pages = list(lease)
    for number in range(extra_pages):
        clauses = [
            f"{rng.choice(SUBJECTS)} {rng.choice(VERBS)} {rng.choice(OBJECTS)} {rng.choice(CONDITIONS)}."
            for _ in range(7)
        ]
        pages.append(f"Приложение {number + 1}. " + " ".join(clauses))
    return pages


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
    write_pdf(long_lease(lease), HERE / "lease_long.pdf", font)
    write_docx(lease, HERE / "lease_v1.docx")
    write_pdf(revised, HERE / "lease_v2.pdf", font)
    write_pdf(load_pages("en_handbook"), HERE / "handbook_en.pdf", font)
    write_pdf(load_pages("kk_rules"), HERE / "rules_kk.pdf", font)


if __name__ == "__main__":
    sys.exit(main())
