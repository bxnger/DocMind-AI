"""Price lists (CSV / XLSX from suppliers), offers for the parts of a document, and the purchase calculation.

All money is Decimal and leaves the API as a string with two decimals. A price that is not in the file is None, never 0.
Currencies are never added together or converted. Nothing here calls a model.
"""

import csv
import io
import re
from datetime import date, datetime, timezone
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from app.codes import code_match, normalize_code
from app.errors import AppError

MAX_PRICE_LIST_BYTES = 5 * 1024 * 1024
MAX_ROWS = 20_000
MAX_PRICE_LISTS = 20
MAX_QUANTITY = 100_000
CENT = Decimal("0.01")
CURRENCIES = {"KZT", "USD", "EUR", "RUB", "CNY"}
CURRENCY_WORDS = {"₸": "KZT", "тг": "KZT", "тенге": "KZT", "теңге": "KZT", "kzt": "KZT", "$": "USD", "usd": "USD",
                  "€": "EUR", "eur": "EUR", "евро": "EUR", "руб": "RUB", "rub": "RUB", "₽": "RUB", "cny": "CNY", "юань": "CNY"}

# Header words in Russian, Kazakh and English -> our column.
HEADERS = {
    "partNumber": ("артикул", "арт", "код", "каталожный", "обозначение", "part number", "partnumber", "part no", "p/n", "sku", "article", "мақала", "код товара"),
    "title": ("наименование", "название", "товар", "описание", "name", "title", "description", "product", "атауы", "тауар"),
    "price": ("цена", "стоимость", "price", "баға", "бағасы", "cost"),
    "currency": ("валюта", "currency", "валютасы"),
    "stock": ("наличие", "остаток", "в наличии", "кол-во на складе", "stock", "availability", "qty", "қоймада", "бар"),
    "url": ("ссылка", "url", "link", "сайт", "сілтеме"),
    "supplier": ("поставщик", "продавец", "supplier", "vendor", "жеткізуші"),
    "checkedAt": ("дата", "дата цены", "date", "updated", "күні"),
}
YES = {"да", "есть", "в наличии", "yes", "true", "available", "in stock", "бар", "+"}
NO = {"нет", "нет в наличии", "no", "false", "out of stock", "unavailable", "жоқ", "-", "0"}


def _header_key(cell: object) -> str | None:
    text = str(cell or "").strip().lower().replace("ё", "е")
    if not text:
        return None
    for key, words in HEADERS.items():
        if text in words:
            return key
    for key, words in HEADERS.items():
        if any(text.startswith(word) for word in words if len(word) >= 4):
            return key
    return None


def parse_price(value: object) -> tuple[Decimal | None, str | None]:
    """"4 850,00 ₸" -> (Decimal("4850.00"), "KZT"). (None, None) when there is no price."""
    if value is None:
        return None, None
    if isinstance(value, (int, float, Decimal)) and not isinstance(value, bool):
        number = Decimal(str(value))
        return (number if number >= 0 else None), None
    text = str(value).strip().lower()
    currency = next((code for word, code in CURRENCY_WORDS.items() if word in text), None)
    digits = re.sub(r"[^\d,.\-]", "", text.replace(" ", "").replace(" ", ""))
    if not digits or not re.search(r"\d", digits):
        return None, currency
    if "," in digits and "." in digits:
        digits = digits.replace(",", "") if digits.rfind(".") > digits.rfind(",") else digits.replace(".", "").replace(",", ".")
    elif "," in digits:
        head, _, tail = digits.rpartition(",")
        digits = f"{head.replace(',', '')}.{tail}" if len(tail) in (1, 2) else digits.replace(",", "")
    try:
        number = Decimal(digits)
    except InvalidOperation:
        return None, currency
    return (number if number >= 0 else None), currency


def parse_stock(value: object) -> tuple[str, int | None]:
    """("available" | "unavailable" | "unknown", quantity or None). An empty cell is unknown, never unavailable."""
    if value is None or str(value).strip() == "":
        return "unknown", None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        count = int(value)
        return ("available" if count > 0 else "unavailable"), max(count, 0)
    text = str(value).strip().lower()
    match = re.fullmatch(r"(\d+)\s*(?:шт\.?|pcs)?", text)
    if match:
        count = int(match.group(1))
        return ("available" if count > 0 else "unavailable"), count
    if text in YES:
        return "available", None
    if text in NO:
        return "unavailable", None
    return "unknown", None


def parse_date(value: object) -> str | None:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = str(value or "").strip()
    for pattern in ("%Y-%m-%d", "%d.%m.%Y", "%d.%m.%y", "%d/%m/%Y"):
        try:
            return datetime.strptime(text, pattern).date().isoformat()
        except ValueError:
            continue
    return None


def _rows_from_file(name: str, data: bytes) -> list[list[object]]:
    if name.lower().endswith((".xlsx", ".xlsm")) or data[:4] == b"PK\x03\x04":
        from openpyxl import load_workbook

        try:
            book = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        except Exception as exc:
            raise AppError(422, "PRICE_LIST_INVALID", "The XLSX file cannot be read") from exc
        sheet = book.worksheets[0]
        rows = [list(row) for row in sheet.iter_rows(values_only=True, max_row=MAX_ROWS + 50)]
        book.close()
        return rows
    for encoding in ("utf-8-sig", "cp1251"):
        try:
            text = data.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise AppError(422, "PRICE_LIST_INVALID", "The CSV file is not UTF-8 or Windows-1251 text")
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=";,\t")
    except csv.Error:
        dialect = csv.excel
    return [row for row in csv.reader(io.StringIO(text), dialect)][: MAX_ROWS + 50]


def parse_price_list(name: str, data: bytes, default_currency: str) -> tuple[list[dict], list[dict]]:
    """(rows, skipped). Each row: row (number in the file), partNumber, title, price, currency, stock, url, supplier, checkedAt."""
    if len(data) > MAX_PRICE_LIST_BYTES:
        raise AppError(413, "PRICE_LIST_TOO_LARGE", "The price list is larger than 5 MB")
    table = _rows_from_file(name, data)
    header_at, columns = None, {}
    for index, row in enumerate(table[:20]):
        found = {}
        for position, cell in enumerate(row):
            key = _header_key(cell)
            if key and key not in found:
                found[key] = position
        if "price" in found and ("partNumber" in found or "title" in found):
            header_at, columns = index, found
            break
    if header_at is None:
        raise AppError(422, "PRICE_LIST_INVALID", "No header row with a price column and a part number or name column")
    rows, skipped = [], []
    for index, row in enumerate(table[header_at + 1:], start=header_at + 2):
        def cell(key: str) -> object:
            position = columns.get(key)
            return row[position] if position is not None and position < len(row) else None

        if not any(str(value or "").strip() for value in row):
            continue
        code = str(cell("partNumber") or "").strip()[:80]
        title = str(cell("title") or "").strip()[:200]
        price, written_currency = parse_price(cell("price"))
        if not code and not title:
            skipped.append({"row": index, "reason": "Нет артикула и наименования"})
            continue
        if price is None:
            skipped.append({"row": index, "reason": "Нет цены"})
            continue
        currency = str(cell("currency") or "").strip().upper() or written_currency or default_currency
        currency = CURRENCY_WORDS.get(currency.lower(), currency)
        if currency not in CURRENCIES:
            skipped.append({"row": index, "reason": f"Неизвестная валюта {currency[:10]}"})
            continue
        stock, count = parse_stock(cell("stock"))
        url = str(cell("url") or "").strip()
        rows.append({
            "row": index, "partNumber": code or None, "title": title or code, "price": str(price.quantize(CENT, ROUND_HALF_UP)),
            "currency": currency, "stockStatus": stock, "stockQuantity": count,
            "url": url if url.startswith(("https://", "http://")) else None,
            "supplier": str(cell("supplier") or "").strip()[:120] or None, "checkedAt": parse_date(cell("checkedAt")),
        })
        if len(rows) >= MAX_ROWS:
            break
    if not rows:
        raise AppError(422, "PRICE_LIST_INVALID", "No rows with a price were found")
    return rows, skipped[:200]


def new_price_list(record_id: str, name: str, data: bytes, supplier: str | None, currency: str | None,
                   checked_at: str | None, demo: bool) -> dict:
    currency = (currency or "KZT").strip().upper()
    if currency not in CURRENCIES:
        raise AppError(422, "VALIDATION_ERROR", f"currency must be one of {', '.join(sorted(CURRENCIES))}")
    form_date = parse_date(checked_at) if checked_at else None
    if checked_at and not form_date:
        raise AppError(422, "VALIDATION_ERROR", "checkedAt must be YYYY-MM-DD")
    rows, skipped = parse_price_list(name, data, currency)
    now = datetime.now(timezone.utc)
    return {
        "id": record_id, "supplier": (supplier or "").strip()[:120] or name.rsplit(".", 1)[0][:120], "fileName": name[:200],
        "rows": len(rows), "skipped": skipped, "checkedAt": form_date or now.date().isoformat(),
        "checkedAtOrigin": "upload_form" if form_date else "import_date", "demo": demo,
        "importedAt": now.isoformat(), "_rows": rows,
    }


def public_price_list(record: dict) -> dict:
    return {key: value for key, value in record.items() if not key.startswith("_")}


def offer_from(price_list: dict, row: dict, match: str) -> dict:
    """An offer. Its price is the file's (priceOrigin "file") unless the supplier's page was really read and gave a
    price (priceOrigin "site_checked"): a link alone, or a failed check, never changes it."""
    offer = {
        "id": f"{price_list['id']}:{row['row']}",
        "supplier": row["supplier"] or price_list["supplier"],
        "title": row["title"],
        "partNumber": row["partNumber"],
        "match": match,
        "price": row["price"],
        "currency": row["currency"],
        "stockStatus": row["stockStatus"],
        "stockQuantity": row["stockQuantity"],
        "url": None if price_list["demo"] else row["url"],
        "source": "price_list",
        "priceListId": price_list["id"],
        "sourceRow": row["row"],
        "checkedAt": row["checkedAt"] or price_list["checkedAt"],
        "checkedAtOrigin": "file" if row["checkedAt"] else price_list["checkedAtOrigin"],
        "demo": price_list["demo"],
        "priceOrigin": "file",
        "filePrice": row["price"],
        "siteCheck": row.get("siteCheck"),
    }
    check = row.get("siteCheck")
    if check and check["status"] == "checked" and not price_list["demo"]:
        offer.update(price=check["price"], currency=check["currency"], priceOrigin="site_checked",
                     checkedAt=check["checkedAt"], checkedAtOrigin="site", url=check["url"])
        if check["stockStatus"] != "unknown":
            offer.update(stockStatus=check["stockStatus"], stockQuantity=None)
    return offer


def row_match(part_number: str, row: dict) -> str | None:
    """How a price list row matches a part number: by its own code column, else by a code written in its title."""
    if row["partNumber"]:
        return code_match(part_number, row["partNumber"])
    key = normalize_code(part_number)
    words = re.findall(r"[\w\-./]+", row["title"] or "")
    # Every run of 1-3 words: "Подшипник 6205-2RS" holds "6205-2RS", and "NU 210 ECP" spans three words. (Found while
    # adding the price check: one greedy pass took "Подшипник 6205-2RS" as one token and never saw the code alone.)
    windows = (" ".join(words[start:start + size]) for size in (1, 2, 3) for start in range(len(words) - size + 1))
    if key and any(normalize_code(window) == key for window in windows):
        return "exact"
    return None


def offers_for(part: dict, price_lists: list[dict]) -> tuple[list[dict], list[dict]]:
    """(offers: exact part number, cheapest first; similar: same designation with other suffixes, never chosen alone)."""
    exact, similar = [], []
    if not part.get("partNumber"):
        return exact, similar
    for price_list in price_lists:
        for row in price_list["_rows"]:
            kind = row_match(part["partNumber"], row)
            if kind == "exact":
                exact.append(offer_from(price_list, row, "exact"))
            elif kind == "close":
                similar.append(offer_from(price_list, row, "close"))
    key = lambda offer: (offer["currency"] != "KZT", Decimal(offer["price"]))
    return sorted(exact, key=key), sorted(similar, key=key)[:10]


def find_offer(offer_id: str, price_lists: list[dict]) -> tuple[dict, dict] | None:
    list_id, _, row_number = offer_id.partition(":")
    for price_list in price_lists:
        if price_list["id"] == list_id:
            row = next((row for row in price_list["_rows"] if str(row["row"]) == row_number), None)
            return (price_list, row) if row else None
    return None


def money(value: Decimal) -> str:
    return str(value.quantize(CENT, ROUND_HALF_UP))


def calculate(items: list[dict]) -> tuple[list[dict], list[dict], int]:
    """Line totals and totals per currency for priced lines. `items` already carry unitPrice/currency or None."""
    totals: dict[str, list] = {}
    unpriced = 0
    for item in items:
        if item["unitPrice"] is None:
            item["lineTotal"] = None
            unpriced += 1
            continue
        line = Decimal(item["unitPrice"]) * item["quantity"]
        item["lineTotal"] = money(line)
        total = totals.setdefault(item["currency"], [Decimal(0), 0])
        total[0] += line
        total[1] += 1
    return items, [{"currency": c, "amount": money(v[0]), "items": v[1]} for c, v in sorted(totals.items())], unpriced


EXPORT_COLUMNS = ("№", "Позиция", "Артикул", "Кол-во", "Ед.", "Цена", "Валюта", "Сумма", "Поставщик", "Ссылка",
                  "Дата цены", "Страница документа", "Идентификация", "Статус", "Источник цены")  # new columns go last
PRICE_ORIGIN_NAMES = {"file": "прайс-лист", "site_checked": "проверено на сайте"}


def export_rows(quote: dict) -> list[list]:
    rows = [list(EXPORT_COLUMNS)]
    for number, item in enumerate(quote["items"], start=1):
        offer = item["offer"] or {}
        pages = ", ".join(str(source["page"]) for source in item.get("sources", []) if source.get("page") is not None)
        rows.append([number, item["name"], item["partNumber"] or "", item["quantity"], item["unit"] or "",
                     item["unitPrice"] or "", item["currency"] or "", item["lineTotal"] or "", offer.get("supplier", ""),
                     offer.get("url") or "", offer.get("checkedAt", ""), pages, item["identification"]["status"], item["status"],
                     PRICE_ORIGIN_NAMES.get(offer.get("priceOrigin"), "")])
    rows.append([])
    for total in quote["totals"]:
        rows.append(["", "Итого", "", "", "", "", total["currency"], total["amount"], "", "", "", "", "", "", ""])
    if quote["unpriced"]:
        rows.append(["", f"Без цены: {quote['unpriced']} поз. (не входят в итог)"])
    return rows


def to_csv(rows: list[list]) -> bytes:
    buffer = io.StringIO()
    csv.writer(buffer, delimiter=";").writerows(rows)
    return buffer.getvalue().encode("utf-8-sig")


def to_xlsx(rows: list[list]) -> bytes:
    from openpyxl import Workbook

    book = Workbook()
    sheet = book.active
    sheet.title = "Закупка"
    for row in rows:
        sheet.append([Decimal(cell) if isinstance(cell, str) and re.fullmatch(r"\d+\.\d{2}", cell) else cell for cell in row])
    buffer = io.BytesIO()
    book.save(buffer)
    return buffer.getvalue()
