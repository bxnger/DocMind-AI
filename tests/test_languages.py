from app.language import detect_language
from app.retrieval import rank
from tests.conftest import needs_cyrillic_font
from tests.test_chat import conversation_for, parse_sse
from tests.conftest import make_pdf, upload

RU_PAGES = [
    "Регистрация команд заканчивается 5 ноября 2026 года.",
    "В команде может быть не более трёх участников.",
]
KK_PAGES = [
    "Командаларды тіркеу 2026 жылғы 5 қарашада аяқталады.",
    "Әр командада үштен артық қатысушы болмауы керек.",
]


def test_detect_language():
    assert detect_language("Registration closes on the fifth of November.") == "en"
    assert detect_language("Регистрация команд заканчивается пятого ноября.") == "ru"
    assert detect_language("Командаларды тіркеу бесінші қарашада аяқталады.") == "kk"
    assert detect_language("Регистрация closes on the fifth, регистрация ends.") == "mixed"
    assert detect_language("Short") is None


def test_endings_do_not_stop_a_match():
    texts = ["Регистрация команд заканчивается 5 ноября.", "Библиотека открывается в девять."]
    assert rank("Когда заканчивается регистрация команды?", texts, top_k=5)[0][0] == 0


def test_kazakh_endings_do_not_stop_a_match():
    texts = ["Командаларды тіркеу қарашада аяқталады.", "Кітапхана тоғызда ашылады."]
    assert rank("Тіркеу қашан аяқталады?", texts, top_k=5)[0][0] == 0


@needs_cyrillic_font
def test_russian_pdf_is_detected_and_answers_from_the_right_page(client, answerer):
    created = upload(client, "polozhenie.pdf", make_pdf(RU_PAGES)).json()
    document = client.get(f"/api/v1/documents/{created['id']}").json()
    assert document["status"] == "ready"
    assert document["language"] == "ru"

    conversation_id = conversation_for(client, created["id"])
    answerer.reply = "Не более трёх участников [1]."
    response = client.post(
        f"/api/v1/conversations/{conversation_id}/messages",
        json={"content": "Сколько участников может быть в команде?"},
    )
    events = parse_sse(response.text)
    source = next(data["sources"] for name, data in events if name == "sources")[0]
    assert source["page"] == 2
    assert source["quote"] == RU_PAGES[1]


@needs_cyrillic_font
def test_kazakh_pdf_is_detected_and_searchable(client, answerer):
    created = upload(client, "erezhe.pdf", make_pdf(KK_PAGES)).json()
    document = client.get(f"/api/v1/documents/{created['id']}").json()
    assert document["status"] == "ready"
    assert document["language"] == "kk"

    conversation_id = conversation_for(client, created["id"])
    answerer.reply = "5 қарашада [1]."
    response = client.post(
        f"/api/v1/conversations/{conversation_id}/messages",
        json={"content": "Тіркеу қашан аяқталады?"},
    )
    source = next(data["sources"] for name, data in parse_sse(response.text) if name == "sources")[0]
    assert source["page"] == 1
