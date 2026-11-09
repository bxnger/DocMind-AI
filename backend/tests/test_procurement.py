"""Parts of a technical document, photo of a marking, price lists, offers and the purchase sheet (docs/API-PROCUREMENT.md)."""

import io
import json

import pytest

from app.codes import code_match, find_bearings, normalize_code, standard_bearing_specs
from app.deps import get_answerer
from app.pricing import parse_price, parse_stock
from tests.conftest import FakeAnswerer, make_pdf, upload

# make_pdf writes one line per page and the page edge cuts a long line, so each page holds a short line.
MANUAL = (
    "Lathe TS-16. Operating manual. Manufacturer: Example Works.",
    "Spindle front bearing 6205-2RS - 2 pcs. Rear bearing NU 210 ECP - 1 pcs.",
    "Drive belt A-1250 - 3 pcs. Length 1250 mm.",
    "Bearing service: budget 12 450 000 tenge, approved in 2026.",
)
JPEG = b"\xff\xd8\xff\xe0" + b"0" * 100


class JsonAnswerer(FakeAnswerer):
    """A model that also answers structured requests (and reads photos, like Gemini)."""

    vision = True

    def __init__(self, json_reply: object = None) -> None:
        super().__init__()
        self.json_reply = json_reply
        self.json_calls: list[tuple[str, bytes | None]] = []

    async def complete_json(self, prompt, image=None, mime_type=None, timeout=45.0):
        self.json_calls.append((prompt, image))
        reply = self.json_reply(prompt, image) if callable(self.json_reply) else self.json_reply
        return reply if isinstance(reply, str) else json.dumps(reply)


def ready(client, pages=MANUAL, name="manual.pdf") -> str:
    created = upload(client, name, make_pdf(list(pages))).json()
    assert client.get(f"/api/v1/documents/{created['id']}").json()["status"] == "ready"
    return created["id"]


def parts_of(client, document_id, **body) -> dict:
    assert client.post(f"/api/v1/documents/{document_id}/parts", json=body or None).status_code == 202
    result = client.get(f"/api/v1/documents/{document_id}/parts").json()
    assert result["status"] == "ready", result
    return result


def use(client, answerer):
    client.app.dependency_overrides[get_answerer] = lambda: answerer


def price_list(client, csv_text: str, **form) -> dict:
    files = {"file": ("prices.csv", csv_text.encode("utf-8"), "text/csv")}
    response = client.post("/api/v1/price-lists", files=files, data={k: str(v) for k, v in form.items()})
    assert response.status_code == 201, response.text
    return response.json()


PRICES = (
    "Артикул;Наименование;Цена;Наличие;Ссылка\n"
    "6205-2RS;Подшипник 6205-2RS;4 850,00;40;https://shop.example/6205\n"
    "6205-2RSH;Подшипник 6205-2RSH;5 100;;\n"
    "6205 2RS;Подшипник 6205-2RS другой склад;4 990.5;нет;\n"
    "NU210ECP;Подшипник NU 210 ECP;;5;\n"
)


# Codes and bearings: plain code, no model ---------------------------------------------------------------------------

def test_part_numbers_match_across_spelling_and_lookalike_letters():
    assert normalize_code("6205-2RS") == normalize_code("6205 2RS") == "62052RS"
    assert normalize_code("NU 210 ЕСР") == "NU210ECP"  # Cyrillic Е, С, Р read for Latin E, C, P
    assert code_match("6205-2RS", "6205 2RS") == "exact"
    assert code_match("6205-2RS", "6205-2RSH") == "close"
    assert code_match("NU 210 ECP", "NU210ECP") == "exact"
    assert code_match("6205-2RS", "6305-2RS") is None


def test_standard_bearing_dimensions_are_computed_not_guessed():
    dims = {spec["name"]: spec["value"] for spec in standard_bearing_specs("6205-2RS")}
    assert dims == {"Внутренний диаметр d": "25", "Наружный диаметр D": "52", "Ширина B": "15"}
    assert {s["value"] for s in standard_bearing_specs("6003")} == {"17", "35", "10"}
    assert [s["value"] for s in standard_bearing_specs("NU 210 ECP")] == ["50"]  # only the bore follows from the rule
    assert all(spec["origin"] == "standard" for spec in standard_bearing_specs("6205"))


def test_a_soft_hyphen_from_the_pdf_is_the_same_part_number():
    """Found live: PyMuPDF read the hyphen of "6205-2RS" as U+00AD; the code then found "6205" without its suffix,
    the AI found "6205\xad2RS", the part was listed twice and a photo of 6205-2RS matched only as "close"."""
    assert [found[0] for found in find_bearings("подшипник 6205­2RS — 4 шт.")] == ["6205­2RS"]
    assert code_match("6205­2RS", "6205-2RS") == "exact"
    assert find_bearings("Электродвигатель 4 кВт, 1500 об/мин — 1 шт. Замена подшипников раз в 2 года.") == []


def test_the_pdf_text_and_its_quotes_show_an_ordinary_hyphen():
    """Found in the joint run: sources[].quote held "6205\xad2RS" and the model was given the same text. The demo
    manual is such a PDF (its font maps the hyphen glyph to U+00AD); the quote is still highlighted on the page."""
    from pathlib import Path

    from app.extraction import extract_pdf
    from app.highlights import quote_highlights

    manual = Path(__file__).resolve().parent.parent / "demo" / "procurement" / "tv320_manual.pdf"
    pages = extract_pdf(manual)
    assert all("­" not in page.text for page in pages)
    assert "подшипник 6205-2RS — 4 шт." in pages[1].text
    assert "токарно-винторезный ТВ-320" in pages[0].text
    assert len(quote_highlights(manual, 2, "подшипник 6205-2RS — 4 шт.")) == 1


def test_the_sheet_says_where_each_price_and_date_came_from(client):
    from openpyxl import load_workbook

    use(client, None)
    document_id = ready(client)
    parts = {p["partNumber"]: p for p in parts_of(client, document_id)["parts"]}
    plain = price_list(client, "Артикул;Наименование;Производитель;Цена\n6205-2RS;Подшипник 6205-2RS;SKF;4 850\n")
    dated = price_list(client, "Артикул;Наименование;Цена;Дата\n6205-2RSH;Подшипник 6205-2RSH;5 100;01.11.2026\n", demo="true")
    offers = client.post("/api/v1/procurement/offers", json={"documentId": document_id, "partIds": [parts["6205-2RS"]["id"]]}).json()
    exact, similar = offers["items"][0]["offers"][0], offers["items"][0]["similar"][0]
    assert (exact["manufacturer"], exact["priceListFile"], exact["checkedAtOrigin"]) == ("SKF", "prices.csv", "import_date")
    assert similar["manufacturer"] is None and similar["checkedAt"] == "2026-11-01"
    body = {"documentId": document_id, "items": [
        {"partId": parts["6205-2RS"]["id"], "offerId": exact["id"]},
        {"partId": parts["NU 210 ECP"]["id"], "offerId": similar["id"]},  # another part's offer: offer_missing
    ]}
    sheet = load_workbook(io.BytesIO(client.post("/api/v1/procurement/quote/export", json=body).content)).active
    header = [cell.value for cell in sheet[1]]
    assert header[:14] == ["№", "Позиция", "Артикул", "Кол-во", "Ед.", "Цена", "Валюта", "Сумма", "Поставщик", "Ссылка",
                           "Дата цены", "Страница документа", "Идентификация", "Статус"]  # old columns did not move
    row = dict(zip(header, [cell.value for cell in sheet[2]]))
    assert row["Дата цены"] is None  # the upload day is not the day the price was checked
    assert "дата загрузки прайса, не дата цены" in row["Откуда дата"]
    assert (row["Источник цены"], row["Производитель"], row["Совпадение артикула"], row["Файл прайса"], row["Строка прайса"],
            row["DEMO"]) == ("прайс-лист", "SKF", "точный", "prices.csv", 2, "нет")
    assert row["Наличие"] == "не указано" and row["Проверено (время Казахстана, UTC+5)"] is None  # no stock column, no check
    missing = dict(zip(header, [cell.value for cell in sheet[3]]))
    assert missing["Статус"] == "offer_missing" and missing["Цена"] is None and missing["DEMO"] is None
    assert plain["id"] != dated["id"]


def test_the_check_time_is_shown_in_kazakhstan_time_and_stock_in_words():
    from app.pricing import kazakhstan_time, stock_text

    assert kazakhstan_time("2026-11-07T19:41:39+00:00") == "08.11.2026 00:41"
    assert kazakhstan_time("2026-11-08") == "" and kazakhstan_time(None) == "" and kazakhstan_time("2026-11-08T10:00") == ""
    assert stock_text({"stockStatus": "available", "stockQuantity": 40}) == "есть у поставщика, 40 шт."
    assert stock_text({"stockStatus": "unknown", "stockQuantity": None}) == "не указано" and stock_text({}) == ""


def test_a_price_row_without_a_code_column_is_matched_by_the_code_in_its_title():
    from app.pricing import row_match

    title = lambda text: {"partNumber": None, "title": text}  # noqa: E731
    assert row_match("6205-2RS", title("Подшипник 6205-2RS")) == "exact"
    assert row_match("NU 210 ECP", title("Подшипник NU 210 ECP, SKF")) == "exact"
    assert row_match("6205-2RS", title("Подшипник 6205-2RSH")) is None
    assert row_match("6205", title("Подшипник 6205-2RS")) is None


def test_bearings_are_found_but_amounts_and_years_are_not():
    assert [found[0] for found in find_bearings(MANUAL[1])] == ["6205-2RS", "NU 210 ECP"]
    assert find_bearings(MANUAL[3]) == []  # a bearing word nearby, but an amount and a year
    assert find_bearings("The budget is 12 450 000 tenge, year 2026, invoice 6205.") == []
    assert [found[0] for found in find_bearings("Rear bearing NU 210 ЕСР")] == ["NU 210 ЕСР"]  # original letters kept
    assert [found[0] for found in find_bearings("Подшипник 6205 — 2 шт.")] == ["6205"]


def test_a_number_with_one_letter_is_a_bearing_only_next_to_a_bearing_word():
    """Found live: a train ticket "Место 154А Терминал" was listed as bearing 154A (Cyrillic А read as the A suffix)."""
    for text in ("Вагон 05 Место 154А Терминал 2", "Перрон 7, место 203B", "Seat 222K, gate 12", "Заказ 7310 B от 08.11"):
        assert find_bearings(text) == [], text
    assert [f[0] for f in find_bearings("Подшипник 7310 B — 2 шт.")] == ["7310 B"]
    assert [f[0] for f in find_bearings("Angular contact bearing 306K")] == ["306K"]
    for strong in ("6205-2RS", "6305 ZZ", "6204 C3", "62032RS", "NU 210", "22210 E TN9"):  # bearing-only suffix or prefix
        assert find_bearings(f"Поз. 4: {strong}"), strong


def test_a_document_without_part_context_gives_no_parts(client):
    """A ticket has no part word, count or part number label: whatever the AI lists there is not a part."""
    reply = {"equipment": None, "parts": [{"excerpt": 1, "name": "Терминал", "category": "other", "partNumber": "154А"}]}
    use(client, JsonAnswerer(reply))
    result = parts_of(client, ready(client, ("Электронный билет. Поезд 081Ц Алматы — Астана. Вагон 05, место 154А.",
                                             "Посадка: Терминал 2. Пассажир: Иванов И. Стоимость 12 450 тенге."), "ticket.pdf"))
    assert result["parts"] == [] and result["summary"]["total"] == 0


def test_prices_and_stock_are_read_without_inventing():
    assert parse_price("4 850,00 ₸") == (__import__("decimal").Decimal("4850.00"), "KZT")
    assert parse_price("") == (None, None)
    assert parse_stock("") == ("unknown", None)
    assert parse_stock("нет") == ("unavailable", None)
    assert parse_stock("40") == ("available", 40)
    assert parse_stock("уточняйте") == ("unknown", None)


# Parts of a document -------------------------------------------------------------------------------------------------

def test_bearings_are_extracted_with_quantity_page_quote_and_standard_specs_without_ai(client):
    use(client, None)  # no AI configured: the code pass still works
    document_id = ready(client)
    result = parts_of(client, document_id)
    by_code = {part["partNumber"]: part for part in result["parts"]}
    bearing = by_code["6205-2RS"]
    assert bearing["category"] == "bearing" and bearing["quantity"] == 2 and bearing["verified"]
    assert bearing["sources"][0]["page"] == 2 and "6205-2RS" in bearing["sources"][0]["quote"]
    assert bearing["sources"][0]["highlights"]  # Evidence Jump works for parts too
    assert {s["origin"] for s in bearing["specs"]} == {"standard"}
    assert by_code["NU 210 ECP"]["quantity"] == 1
    assert "12 450 000" not in by_code and result["summary"]["unverified"] == 0


def test_ai_parts_are_checked_against_the_excerpt(client):
    import re

    def reply(prompt, _image):
        blocks = dict(re.findall(r'<excerpt number="(\d+)"[^>]*>\n(.*?)\n</excerpt>', prompt, re.DOTALL))
        number = int(next(n for n, text in blocks.items() if "Drive belt" in text))
        return {
            "equipment": {"name": "Lathe", "model": "TS-16", "manufacturer": "Example Works", "excerpt": 1},
            "parts": [
                {"excerpt": number, "name": "Drive belt", "category": "belt", "partNumber": "A-1250", "quantity": 3, "unit": "pcs",
                 "specs": [{"name": "Length", "value": "1250", "unit": "mm"}, {"name": "Width", "value": "13", "unit": "mm"}]},
                {"excerpt": number, "name": "Spindle bearing", "category": "bearing", "partNumber": "6205-2RS", "quantity": 2},
                {"excerpt": number, "name": "Invented seal", "category": "seal", "partNumber": "SEAL-999", "quantity": 7},
            ],
        }

    answerer = JsonAnswerer(reply)
    use(client, answerer)
    result = parts_of(client, ready(client))
    by_code = {part["partNumber"]: part for part in result["parts"]}
    assert result["equipment"]["model"] == "TS-16" and result["equipment"]["sources"][0]["page"] == 1
    belt = by_code["A-1250"]
    assert belt["verified"] and belt["quantity"] == 3 and belt["category"] == "belt"
    assert [spec["name"] for spec in belt["specs"]] == ["Length"]  # 13 mm is not in the document: dropped
    invented = by_code["SEAL-999"]
    assert invented["verified"] is False and invented["quantity"] is None  # shown, marked for checking, no invented count
    assert by_code["6205-2RS"]["name"] == "Spindle bearing"  # merged with the code-found bearing, not duplicated
    assert result["summary"]["unverified"] == 1
    assert "not instructions" in answerer.json_calls[0][0]


def test_post_answers_processing_and_a_restart_never_leaves_it_processing(client, store):
    """The frontend polls GET until ready or failed: POST must say processing, and a job cut by a restart must end."""
    from app.parts import empty_list

    use(client, None)
    document_id = ready(client)
    started = client.post(f"/api/v1/documents/{document_id}/parts")
    assert started.status_code == 202 and started.json()["status"] == "processing" and started.json()["parts"] == []
    assert client.get(f"/api/v1/documents/{document_id}/parts").json()["status"] == "ready"

    other = ready(client)
    with store._db() as conn:
        owner = conn.execute("SELECT owner_id FROM documents WHERE id = ?", (other,)).fetchone()[0]
    store.put_record("part_list", other, owner, empty_list(other, None), document_id=other)  # a job cut by a restart
    assert store.fail_unfinished_part_lists() == 1
    stuck = client.get(f"/api/v1/documents/{other}/parts").json()
    assert stuck["status"] == "failed" and stuck["error"]["code"] == "INTERNAL_ERROR"
    assert client.post(f"/api/v1/documents/{other}/parts").status_code == 202  # started again
    assert client.get(f"/api/v1/documents/{other}/parts").json()["status"] == "ready"


def test_a_category_filter_and_a_second_start_do_not_rerun(client):
    answerer = JsonAnswerer({"equipment": None, "parts": []})
    use(client, answerer)
    document_id = ready(client)
    result = parts_of(client, document_id, category="bearing")
    assert {part["category"] for part in result["parts"]} == {"bearing"}
    calls = len(answerer.json_calls)
    assert client.post(f"/api/v1/documents/{document_id}/parts").status_code == 202
    assert len(answerer.json_calls) == calls


def test_parts_belong_to_the_session(client):
    use(client, None)
    document_id = ready(client)
    parts_of(client, document_id)
    other = client.__class__(client.app)
    other.headers["Authorization"] = "Bearer " + other.post("/api/v1/sessions").json()["token"]
    assert other.get(f"/api/v1/documents/{document_id}/parts").status_code == 404
    assert client.get("/api/v1/documents/nope/parts").status_code == 404


# Photo of a marking --------------------------------------------------------------------------------------------------

def photo(client, document_id, data=JPEG):
    return client.post(f"/api/v1/documents/{document_id}/parts/identify", files={"image": ("p.jpg", data, "image/jpeg")})


@pytest.mark.parametrize("read, status, match", [
    ({"text": "SKF 6205-2RS C3", "partNumber": "6205 2RS", "manufacturer": "SKF", "readability": "high"}, "matched", "exact"),
    ({"text": "SKF 6205-2RSH", "partNumber": "6205-2RSH", "readability": "high"}, "needs_confirmation", "close"),
    ({"text": "6205-2RS", "partNumber": "6205-2RS", "readability": "low"}, "needs_confirmation", "exact"),
    ({"text": "6310", "partNumber": "6310", "readability": "high"}, "no_match", None),
    ({"text": "", "partNumber": None, "readability": "unreadable"}, "unreadable", None),
    # The part itself (experimental): without a number only the kind is matched, and never as a match.
    ({"partNumber": None, "readability": "unreadable", "partType": "bearing", "confidence": "high"}, "type_only", "type"),
    ({"partNumber": None, "readability": "unreadable", "partType": "bearing", "confidence": "low"}, "unreadable", None),
    ({"partNumber": None, "readability": "unreadable", "partType": "filter", "confidence": "high"}, "unreadable", None),
    ({"partNumber": None, "readability": "unreadable", "partType": "spaceship", "confidence": "high"}, "unreadable", None),
    # The same number, but the photo clearly shows another kind of part: a person has to look.
    ({"partNumber": "6205-2RS", "readability": "high", "partType": "motor", "confidence": "high"},
     "needs_confirmation", "exact"),
    ({"partNumber": "6205-2RS", "readability": "high", "partType": "motor", "confidence": "medium"}, "matched", "exact"),
    # Found by repeated runs: glare hid the "H" of 6205-2RSH, the model read 6205-2RS. Any doubt goes to a person.
    ({"partNumber": "6205-2RS", "readability": "medium"}, "needs_confirmation", "exact"),
    ({"partNumber": "6205-2RS", "readability": "high", "issues": ["glare"]}, "needs_confirmation", "exact"),
    ({"partNumber": "6205-2RS", "readability": "high", "issues": ["partial"]}, "needs_confirmation", "exact"),
])
def test_a_photo_is_read_by_the_model_and_matched_by_code(client, read, status, match):
    answerer = JsonAnswerer(lambda prompt, image: {"equipment": None, "parts": []} if image is None else read)
    use(client, answerer)
    document_id = ready(client)
    parts_of(client, document_id)
    body = photo(client, document_id).json()
    assert body["matchStatus"] == status
    assert (body["matches"][0]["match"] if body["matches"] else None) == match
    assert body["message"] and "{type}" not in body["message"]
    assert answerer.json_calls[-1][1] == JPEG
    if status in ("type_only", "unreadable"):
        assert body["recognized"]["partNumber"] is None  # never made up from the look of the part


def test_the_old_fields_stay_and_the_new_ones_hold_only_what_was_read():
    from app.vision import recognized_from

    old = recognized_from(json.dumps({"text": "SKF 6205-2RS C3", "partNumber": "6205-2RS", "manufacturer": "SKF",
                                      "markings": ["C3"], "readability": "high"}))
    assert {key: old[key] for key in ("text", "partNumber", "manufacturer", "markings", "readability")} == {
        "text": "SKF 6205-2RS C3", "partNumber": "6205-2RS", "manufacturer": "SKF", "markings": ["C3"], "readability": "high"}
    assert old["visibleMarkings"] == ["6205-2RS", "SKF", "C3"]  # built from what was read, nothing added
    assert (old["partType"], old["confidence"], old["issues"]) == ("unknown", "low", [])
    listed = recognized_from(json.dumps({"partNumber": None, "visibleMarkings": ["FAG", " ", "FAG"], "partType": "other",
                                         "confidence": "very"}))
    assert listed["visibleMarkings"] == ["FAG"] and listed["confidence"] == "low"
    # Found live: a clear marking of a bearing came back with "not_a_part"; the same answer contradicts it.
    clear = recognized_from(json.dumps({"text": "SKF 6205-2RSH", "partNumber": "6205-2RSH", "readability": "high",
                                        "partType": "bearing", "confidence": "high", "issues": ["not_a_part", "no_marking"]}))
    assert clear["issues"] == []
    empty = recognized_from(json.dumps({"partNumber": None, "readability": "unreadable", "issues": ["not_a_part"]}))
    assert empty["issues"] == ["not_a_part"]


def test_a_part_recognized_only_by_its_look_offers_candidates_to_confirm(client):
    read = {"partNumber": None, "readability": "unreadable", "partType": "bearing", "confidence": "medium",
            "issues": ["glare", "partial", "bogus"]}
    use(client, JsonAnswerer(lambda prompt, image: {"equipment": None, "parts": []} if image is None else read))
    document_id = ready(client)
    parts_of(client, document_id)
    body = photo(client, document_id).json()
    assert body["matchStatus"] == "type_only"
    assert {m["partNumber"] for m in body["matches"]} == {"6205-2RS", "NU 210 ECP"}
    assert all(m["match"] == "type" and m["difference"] for m in body["matches"])
    assert "подшипник" in body["message"] and "подтвердите" in body["message"]
    assert body["recognized"]["issues"] == ["glare", "partial"]
    assert len(body["tips"]) == 2 and "Блик" in body["tips"][0]


def test_a_conflicting_look_is_named_and_an_unreadable_photo_gets_a_tip(client):
    reads = iter([
        {"partNumber": "6205-2RS", "readability": "high", "partType": "motor", "confidence": "high"},
        {"partNumber": None, "readability": "unreadable"},
        "not json at all",
        "still not json",
    ])
    use(client, JsonAnswerer(lambda prompt, image: {"equipment": None, "parts": []} if image is None else next(reads)))
    document_id = ready(client)
    parts_of(client, document_id)
    conflict = photo(client, document_id).json()
    assert "электродвигатель" in conflict["matches"][0]["difference"]
    plain = photo(client, document_id).json()
    assert plain["matchStatus"] == "unreadable" and plain["tips"] and plain["recognized"]["partType"] == "unknown"
    broken = photo(client, document_id).json()  # two answers that are not JSON: unreadable, nothing invented
    assert broken["matchStatus"] == "unreadable" and broken["matches"] == [] and broken["recognized"]["partNumber"] is None


def test_photo_errors(client):
    use(client, JsonAnswerer({"equipment": None, "parts": []}))
    document_id = ready(client)
    not_started = photo(client, document_id)
    assert not_started.status_code == 404 and not_started.json()["error"]["code"] == "PARTS_NOT_STARTED"
    parts_of(client, document_id)
    assert photo(client, document_id, b"GIF89a....").status_code == 415
    assert photo(client, document_id, b"\xff\xd8\xff" + b"0" * (8 * 1024 * 1024)).status_code == 413
    plain = FakeAnswerer()  # a provider that cannot see images (Groq)
    use(client, plain)
    response = photo(client, document_id)
    assert response.status_code == 503 and response.json()["error"]["code"] == "VISION_UNAVAILABLE"


def test_a_confirmation_is_explicit_and_reaches_the_quote(client):
    use(client, None)
    document_id = ready(client)
    part = next(p for p in parts_of(client, document_id)["parts"] if p["partNumber"] == "6205-2RS")
    url = f"/api/v1/documents/{document_id}/parts/{part['id']}/confirmations"
    confirmation = client.post(url, json={"recognizedText": "SKF 6205-2RS", "recognizedPartNumber": "6205-2RS", "decision": "confirmed"}).json()
    assert confirmation["confirmedBy"] == "user" and confirmation["documentPartNumber"] == "6205-2RS"
    assert client.get(url).json()["items"][0]["id"] == confirmation["id"]
    quote = client.post("/api/v1/procurement/quote", json={"documentId": document_id, "items": [{"partId": part["id"]}]}).json()
    assert quote["items"][0]["identification"] == {"status": "user_confirmed", "confirmationId": confirmation["id"]}
    assert client.post(f"/api/v1/documents/{document_id}/parts/p999/confirmations", json={"decision": "confirmed"}).status_code == 404


# Price lists, offers, the purchase sheet ----------------------------------------------------------------------------

def test_offers_are_exact_matches_and_similar_ones_are_apart(client):
    use(client, None)
    document_id = ready(client)
    parts = {p["partNumber"]: p for p in parts_of(client, document_id)["parts"]}
    imported = price_list(client, PRICES, supplier="ТОО Тест", checkedAt="2026-11-08")
    assert imported["rows"] == 3 and imported["skipped"] == [{"row": 5, "reason": "Нет цены"}]
    assert imported["checkedAtOrigin"] == "upload_form" and imported["demo"] is False
    body = client.post("/api/v1/procurement/offers", json={"documentId": document_id, "partIds": [parts["6205-2RS"]["id"], parts["NU 210 ECP"]["id"]]}).json()
    bearing, roller = body["items"]
    assert [(o["price"], o["stockStatus"], o["stockQuantity"]) for o in bearing["offers"]] == [("4850.00", "available", 40), ("4990.50", "unavailable", None)]
    assert bearing["offers"][0]["id"] == f"{imported['id']}:2" and bearing["offers"][0]["sourceRow"] == 2
    assert bearing["offers"][0]["url"] == "https://shop.example/6205" and bearing["offers"][0]["checkedAt"] == "2026-11-08"
    assert [(o["partNumber"], o["match"], o["stockStatus"]) for o in bearing["similar"]] == [("6205-2RSH", "close", "unknown")]
    assert roller["offers"] == [] and roller["similar"] == []


def test_the_quote_is_computed_by_code_and_unknown_prices_stay_null(client):
    use(client, None)
    document_id = ready(client)
    parts = {p["partNumber"]: p for p in parts_of(client, document_id)["parts"]}
    imported = price_list(client, PRICES + "A-1250;Ремень;10;да;\n")
    usd = price_list(client, "sku,title,price,currency\nNU210ECP,Roller bearing,99.99,USD\n")
    items = [
        {"partId": parts["6205-2RS"]["id"], "offerId": f"{imported['id']}:2"},               # 2 x 4850.00 from the document
        {"partId": parts["NU 210 ECP"]["id"], "quantity": 3, "offerId": f"{usd['id']}:2"},   # 3 x 99.99 USD
        {"partId": parts["6205-2RS"]["id"], "quantity": 1, "offerId": f"{imported['id']}:3"},  # a similar part number
    ]
    quote = client.post("/api/v1/procurement/quote", json={"documentId": document_id, "items": items}).json()
    first, second, third = quote["items"]
    assert (first["quantity"], first["unitPrice"], first["lineTotal"], first["status"]) == (2, "4850.00", "9700.00", "priced")
    assert (second["lineTotal"], second["currency"]) == ("299.97", "USD")
    assert third["matchWarning"] is True and third["lineTotal"] == "5100.00"
    assert quote["totals"] == [{"currency": "KZT", "amount": "14800.00", "items": 2}, {"currency": "USD", "amount": "299.97", "items": 1}]
    assert any("валют" in warning for warning in quote["warnings"])

    no_offer = client.post("/api/v1/procurement/quote", json={"documentId": document_id, "items": [{"partId": parts["6205-2RS"]["id"]}]}).json()
    assert no_offer["items"][0]["status"] == "no_price" and no_offer["items"][0]["lineTotal"] is None
    assert no_offer["totals"] == [] and no_offer["unpriced"] == 1

    assert client.delete(f"/api/v1/price-lists/{imported['id']}").status_code == 204
    gone = client.post("/api/v1/procurement/quote", json={"documentId": document_id, "items": items[:1]}).json()
    assert gone["items"][0]["status"] == "offer_missing" and gone["items"][0]["unitPrice"] is None and gone["warnings"]


def test_an_offer_of_another_part_or_session_is_missing_not_priced(client):
    use(client, None)
    document_id = ready(client)
    parts = {p["partNumber"]: p for p in parts_of(client, document_id)["parts"]}
    imported = price_list(client, PRICES)
    wrong = client.post("/api/v1/procurement/quote", json={"documentId": document_id, "items": [
        {"partId": parts["NU 210 ECP"]["id"], "offerId": f"{imported['id']}:2"}]}).json()
    assert wrong["items"][0]["status"] == "offer_missing"
    other = client.__class__(client.app)
    other.headers["Authorization"] = "Bearer " + other.post("/api/v1/sessions").json()["token"]
    assert other.get("/api/v1/price-lists").json()["items"] == []


def test_demo_price_lists_hide_links_and_bad_files_are_refused(client):
    use(client, None)
    document_id = ready(client)
    part = next(p for p in parts_of(client, document_id)["parts"] if p["partNumber"] == "6205-2RS")
    price_list(client, PRICES, demo="true")
    offer = client.post("/api/v1/procurement/offers", json={"documentId": document_id, "partIds": [part["id"]]}).json()["items"][0]["offers"][0]
    assert offer["demo"] is True and offer["url"] is None
    body = {"documentId": document_id, "items": [{"partId": part["id"], "offerId": offer["id"]}]}
    quote = client.post("/api/v1/procurement/quote", json=body).json()
    assert any("DEMO" in warning for warning in quote["warnings"])
    from openpyxl import load_workbook

    rows = list(load_workbook(io.BytesIO(client.post("/api/v1/procurement/quote/export?format=xlsx", json=body).content)).active.iter_rows(values_only=True))
    line = dict(zip(rows[0], rows[1]))
    assert line["Источник цены"].startswith("DEMO") and line["DEMO"] == "да"
    bad = client.post("/api/v1/price-lists", files={"file": ("x.csv", "a;b\n1;2\n".encode(), "text/csv")})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "PRICE_LIST_INVALID"


def test_xlsx_price_list_and_export(client):
    from openpyxl import Workbook, load_workbook

    use(client, None)
    document_id = ready(client)
    part = next(p for p in parts_of(client, document_id)["parts"] if p["partNumber"] == "6205-2RS")
    book = Workbook()
    book.active.append(["Part number", "Description", "Price", "Stock", "Date"])
    book.active.append(["6205-2RS", "Ball bearing", 4850, 12, "08.11.2026"])
    buffer = io.BytesIO()
    book.save(buffer)
    response = client.post("/api/v1/price-lists", files={"file": ("p.xlsx", buffer.getvalue(), "application/octet-stream")})
    assert response.status_code == 201, response.text
    offer = client.post("/api/v1/procurement/offers", json={"documentId": document_id, "partIds": [part["id"]]}).json()["items"][0]["offers"][0]
    assert (offer["price"], offer["checkedAt"], offer["checkedAtOrigin"]) == ("4850.00", "2026-11-08", "file")
    body = {"documentId": document_id, "items": [{"partId": part["id"], "offerId": offer["id"]}]}
    xlsx = client.post("/api/v1/procurement/quote/export?format=xlsx", json=body)
    assert xlsx.status_code == 200 and "attachment" in xlsx.headers["content-disposition"]
    rows = list(load_workbook(io.BytesIO(xlsx.content)).active.iter_rows(values_only=True))
    assert rows[1][2] == "6205-2RS" and float(rows[1][7]) == 9700.0 and rows[1][11] == "2"
    csv_file = client.post("/api/v1/procurement/quote/export?format=csv", json=body)
    assert "9700.00" in csv_file.content.decode("utf-8-sig")


def test_a_brief_gemini_503_on_a_photo_is_retried():
    """Found live: a marking photo got 503 ("high demand") from both Gemini models; the chat retries that, this did not."""
    import asyncio
    from types import SimpleNamespace

    from google.genai import errors

    from app.llm import LlmUnavailable
    from app.llm_gemini import GeminiAnswerer

    class Flaky:
        def __init__(self, failures):
            self.failures, self.calls = failures, 0
            self.aio = SimpleNamespace(models=SimpleNamespace(generate_content=self.generate))

        async def generate(self, **kwargs):
            self.calls += 1
            if self.calls <= self.failures:
                raise errors.ServerError(503, {"error": {"message": "high demand"}})
            return SimpleNamespace(text='{"readability": "high"}')

    flaky = Flaky(failures=1)
    answer = asyncio.run(GeminiAnswerer("m", "unused", client=flaky).complete_json("read", image=JPEG, mime_type="image/jpeg"))
    assert answer == '{"readability": "high"}' and flaky.calls == 2
    with pytest.raises(LlmUnavailable):
        asyncio.run(GeminiAnswerer("m", "unused", client=Flaky(failures=99)).complete_json("read"))


# Capabilities ---------------------------------------------------------------------------------------------------------

def test_capabilities_only_add_fields(client):
    use(client, JsonAnswerer())
    body = client.get("/api/v1/capabilities").json()
    assert {"version", "languages", "ocr", "docxPreview", "comparison", "highlights", "limits"} <= set(body)
    assert body["features"] == {"claimCheck": True, "parts": True, "photoIdentify": True, "priceLists": True, "procurement": True, "hr": False,
                                "priceCheck": False,  # added 8 Nov: on only when PRICE_CHECK_DOMAINS is set
                                "storeSearch": False,  # added 9 Nov: on only when STORE_SEARCH lists shops
                                "barcodes": True}  # added 9 Nov: zxing-cpp is installed
    assert body["limits"]["maxImageBytes"] == 8 * 1024 * 1024
    use(client, FakeAnswerer())
    assert client.get("/api/v1/capabilities").json()["features"]["photoIdentify"] is False
