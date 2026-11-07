"""Fictional test files for the procurement chain, the same for backend and frontend checks.

    python demo/procurement/make_files.py

Writes next to this script: tv320_manual.pdf (3 pages, a lathe manual with a bearing table), demo_prices.csv and
demo_prices.xlsx (a demo supplier price list), marking_6205.png / marking_6205h.png / marking_blurry.png (synthetic
images of a bearing marking: not camera photos). Every name, supplier and price here is invented.
"""

import pathlib
import sys

import pymupdf as fitz

OUT = pathlib.Path(__file__).resolve().parent
FONTS = (r"C:\Windows\Fonts\arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/System/Library/Fonts/Supplemental/Arial.ttf")
FONT = next((path for path in FONTS if pathlib.Path(path).exists()), None)

PAGES = [
    "УЧЕБНЫЙ ДОКУМЕНТ. Все данные вымышлены.\n\nСтанок токарно-винторезный ТВ-320\nРуководство по эксплуатации\n"
    "Изготовитель: ТОО «Учебный станкозавод», г. Караганда.\n\nСтанок предназначен для токарной обработки деталей "
    "в условиях мелкосерийного производства.",
    "Раздел 7. Перечень подшипников качения\n\n"
    "Таблица 7.1\n"
    "Поз. 1. Шпиндель, передняя опора: подшипник 3182120 — 1 шт.\n"
    "Поз. 2. Шпиндель, задняя опора: подшипник 6210-2RS — 2 шт.\n"
    "Поз. 3. Коробка скоростей, вал II: подшипник 6205-2RS — 4 шт.\n"
    "Поз. 4. Фартук: подшипник 6203 — 2 шт.\n"
    "Поз. 5. Задняя бабка: подшипник NU 207 ECP — 1 шт.\n",
    "Раздел 8. Прочие комплектующие\n\n"
    "Ремень приводной клиновой А-1250 — 3 шт.\n"
    "Манжета армированная 1.2-40x60-1 — 2 шт.\n"
    "Фильтр масляный ФМ-12 — 1 шт.\n"
    "Электродвигатель АИР100L4, 4 кВт, 1500 об/мин — 1 шт.\n\n"
    "Замену подшипников выполнять при плановом ремонте, не реже одного раза в 2 года.",
]

PRICES = [
    ("Артикул", "Наименование", "Цена", "Валюта", "Наличие"),
    ("6210-2RS", "Подшипник 6210-2RS", "9 450", "KZT", "12"),
    ("6205-2RS", "Подшипник 6205-2RS", "4 850", "KZT", "40"),
    ("6205-2RSH", "Подшипник 6205-2RSH", "5 100", "KZT", ""),
    ("6203", "Подшипник 6203", "2 300", "KZT", "нет"),
    ("NU207ECP", "Подшипник NU 207 ECP", "21 900", "KZT", "3"),
    ("А-1250", "Ремень клиновой А-1250", "3 200", "KZT", "да"),
]


def manual() -> None:
    if FONT is None:
        sys.exit("No TrueType font with Cyrillic letters found")
    doc = fitz.open()
    for text in PAGES:
        page = doc.new_page()
        page.insert_font(fontname="cyr", fontfile=FONT)
        page.insert_textbox(fitz.Rect(56, 56, 540, 800), text, fontname="cyr", fontsize=12)
    doc.save(OUT / "tv320_manual.pdf")


def price_lists() -> None:
    (OUT / "demo_prices.csv").write_text("\n".join(";".join(row) for row in PRICES) + "\n", encoding="utf-8")
    from openpyxl import Workbook

    book = Workbook()
    for row in PRICES:
        book.active.append([int(cell.replace(" ", "")) if cell.replace(" ", "").isdigit() and row is not PRICES[0] and cell == row[2] else cell for cell in row])
    book.save(OUT / "demo_prices.xlsx")


def marking(name: str, lines: list[str], blur: bool = False) -> None:
    img = fitz.open()
    page = img.new_page(width=420, height=220)
    page.draw_rect(page.rect, color=(0.55, 0.57, 0.6), fill=(0.72, 0.74, 0.77))
    page.draw_circle(fitz.Point(210, 110), 95, color=(0.4, 0.42, 0.45), fill=(0.6, 0.62, 0.65), width=3)
    y = 85
    for line in lines:
        page.insert_text((120, y), line, fontsize=26, color=(0.1, 0.1, 0.12))
        y += 36
    page.get_pixmap(dpi=40 if blur else 144).save(OUT / name)


if __name__ == "__main__":
    manual()
    price_lists()
    marking("marking_6205.png", ["SKF", "6205-2RS", "C3"])
    marking("marking_6205h.png", ["SKF", "6205-2RSH"])
    marking("marking_blurry.png", ["SKF", "6205-2RS"], blur=True)
    print("written to", OUT)
