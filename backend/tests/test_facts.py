"""Key facts: dates, deadlines, amounts and percentages with exact quotes, no model involved."""

from app.facts import extract_facts, sentence_facts, suggested_questions
from tests.conftest import upload, make_pdf, make_docx
from tests.test_chat import ready_document


def kinds(sentence):
    return sorted(kind for kind, _ in sentence_facts(sentence))


def test_deadline_is_a_date_in_a_sentence_about_terms():
    assert sentence_facts("Registration closes on 5 November 2026.") == [("date", "5 November 2026")]
    assert sentence_facts("Регистрация не позднее 5 ноября 2026 года.") == [("deadline", "5 ноября 2026")]
    assert sentence_facts("Deadline: 05.11.2026.") == [("deadline", "05.11.2026")]
    assert sentence_facts("Өтінімді 5 қарашаға дейін жіберіңіз, мерзім 05.11.2026.")[0][0] == "deadline"


def test_amounts_and_percentages():
    assert kinds("Взнос 15 000 тенге, скидка 10%.") == ["amount", "percent"]
    assert kinds("The prize is $5,000 and 20 % goes to costs.") == ["amount", "percent"]
    assert kinds("Teams may have at most three members.") == []
    assert kinds("The room has 12 chairs.") == []


def test_every_fact_quote_is_verbatim_in_its_segment():
    segments = [{"page": 3, "location": None, "text": "Intro line. Fee is 500 KZT. Pay by 1 December 2026."}]
    facts = extract_facts(segments)
    assert {f["kind"] for f in facts} == {"amount", "deadline"}
    assert all(f["quote"] in segments[0]["text"] and f["page"] == 3 for f in facts)


def test_duplicates_are_dropped_and_count_is_capped():
    text = " ".join(f"Item {i} costs {i + 1} USD." for i in range(200))
    assert len(extract_facts([{"page": 1, "location": None, "text": text}])) == 60
    same = [{"page": 1, "location": None, "text": "Pay 5 USD. Pay 5 USD."}]
    assert len(extract_facts(same)) == 1


def test_suggestions_follow_what_was_found_and_the_language():
    facts = [{"kind": "deadline"}, {"kind": "amount"}]
    assert suggested_questions(facts, "ru")[0] == "О чём этот документ?"
    assert len(suggested_questions(facts, "ru")) == 3
    assert suggested_questions([], "kk") == ["Бұл құжат не туралы?"]
    assert suggested_questions([], None) == ["What is this document about?"]


def test_endpoint_returns_facts_with_highlights_for_a_pdf(client):
    doc = ready_document(client, pages=("Intro text.", "Registration closes on 5 November 2026. The fee is 500 USD."))
    body = client.get(f"/api/v1/documents/{doc}/facts").json()
    assert body["documentId"] == doc
    by_kind = {fact["kind"]: fact for fact in body["facts"]}
    assert by_kind["date"]["page"] == 2 and by_kind["date"]["value"] == "5 November 2026"
    assert by_kind["amount"]["value"] == "500 USD"
    assert by_kind["date"]["highlights"], "a simple PDF sentence can be located on the page"
    assert body["suggestedQuestions"]


def test_endpoint_works_for_docx_and_rejects_unready_or_unknown(client):
    created = upload(client, "terms.docx", make_docx([("Terms", ["Pay 20% by 1 December 2026."])])).json()
    body = client.get(f"/api/v1/documents/{created['id']}/facts").json()
    assert {f["kind"] for f in body["facts"]} == {"percent", "deadline"}
    assert all(f["page"] is None and f["highlights"] == [] and f["location"] for f in body["facts"])
    assert client.get("/api/v1/documents/nope/facts").status_code == 404


def test_durations_in_three_languages():
    assert ("duration", "в течение 10 рабочих дней") in sentence_facts("Ответ дают в течение 10 рабочих дней.")
    assert ("duration", "within 5 working days") in sentence_facts("We reply within 5 working days.")
    assert ("duration", "3 күн ішінде") in sentence_facts("Жауап 3 күн ішінде беріледі.")
    assert kinds("There are 5 days in the schedule.") == []


def test_realistic_russian_rules_page():
    text = (
        "Заявки принимаются до 5 ноября 2026 года. Организационный взнос составляет 15 000 тенге. "
        "Участникам из регионов предоставляется скидка 10%. Результаты объявляются в течение 3 рабочих дней. "
        "Финал пройдёт 14 ноября."
    )
    found = {(kind, value) for kind, value in extract_pairs(text)}
    assert ("deadline", "5 ноября 2026") in found
    assert ("amount", "15 000 тенге") in found
    assert ("percent", "10%") in found
    assert ("duration", "в течение 3 рабочих дней") in found
    assert ("date", "14 ноября") in found


def extract_pairs(text):
    return [(f["kind"], f["value"]) for f in extract_facts([{"page": 1, "location": None, "text": text}])]


def test_a_term_length_does_not_make_a_start_date_a_deadline():
    assert sentence_facts("Договор заключается на срок 11 месяцев с 1 января 2027 года.") == [("date", "1 января 2027")]
    assert sentence_facts("Крайний срок подачи заявки 5 ноября 2026 года.")[0][0] == "deadline"
