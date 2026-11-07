"""Regressions found by the release QA run against the real stack (QA set: DOCMIND_QA)."""

import pytest

from app.extraction import extract_pdf, needs_latin_codes, ocr_languages, repair_codes


def test_a_code_read_with_cyrillic_letters_is_taken_from_the_english_reading():
    # Real Tesseract output (kaz+rus+eng) for the printed code "QA-2027-041", and the English-only reading of the same page.
    cyrillic = "Номер заявки: ОА-2027-041. Старый ОА-2026-014 недействителен."
    english = "Application QA-2027-041, the old QA-2026-014 is void"
    assert needs_latin_codes(cyrillic) and not needs_latin_codes(english)
    assert repair_codes(cyrillic, english) == "Номер заявки: QA-2027-041. Старый QA-2026-014 недействителен."


def test_a_code_the_english_reading_does_not_hold_is_kept_and_ordinary_text_is_untouched():
    assert repair_codes("Заявка ОА-2027-041", "no codes here") == "Заявка ОА-2027-041"
    for text in (
        "Сметы на 2025-2026 годы и пункт ТК-5",  # one number group: not a code
        "ООО Альфа, ОА Север, договор № 5",
    ):
        assert not needs_latin_codes(text)
        assert repair_codes(text, "QA-2027-041") == text


def test_the_real_ocr_reads_the_latin_code_of_the_qa_scan():
    """Needs Tesseract with kaz, rus and eng data and the DOCMIND QA set (folder in DOCMIND_QA_DIR); skipped otherwise."""
    import glob
    import os

    scans = glob.glob(os.path.join(os.environ.get("DOCMIND_QA_DIR", "-"), "03_*.pdf"))
    if not scans or ocr_languages() != "kaz+rus+eng":
        pytest.skip("Tesseract data or the QA scan is not available")
    text = " ".join(segment.text for segment in extract_pdf(__import__("pathlib").Path(scans[0]), "kaz+rus+eng"))
    assert "QA-2027-041" in text and "QA-2026-014" in text and "780 500" in text


def test_a_damaged_pdf_that_opens_with_no_pages_is_reported_as_unreadable(tmp_path):
    """Found live: a truncated PDF with a valid header was reported as NO_TEXT_FOUND ("a scan, OCR needed"), because
    PyMuPDF repairs it into a document with no pages. It is a damaged file, PARSE_FAILED."""
    from app.extraction import ExtractionError

    path = tmp_path / "trunc.pdf"
    path.write_bytes(b"%PDF-1.4\n1 0 obj<<>>endobj garbage")
    with pytest.raises(ExtractionError) as error:
        extract_pdf(path)
    assert error.value.code == "PARSE_FAILED"


def test_what_changed_between_two_versions_shows_the_model_both_values(client, answerer):
    """Found live: "What exactly changed?" over two versions was answered with the documents' own summary sentence
    ("the budget and the deadline change") without the values, because search found that sentence and not the
    clauses. Now the clauses that differ reach the model in pairs, and the answer is verified against them."""
    from tests.test_chat import ask, ready_document

    first = ready_document(client, ("The budget is 12 450 000 KZT. The lead is Arman Sadykov.", "Reserve is 850 000 KZT."))
    second = ready_document(client, ("The budget is 18 750 000 KZT. The lead is Elena Kim.", "Reserve is 850 000 KZT."))
    conversation = client.post("/api/v1/conversations", json={"documentIds": [first, second]}).json()["id"]
    answerer.reply = "The budget grew from 12 450 000 KZT [1] to 18 750 000 KZT [2]."
    events = ask(client, conversation, "What exactly changed?")

    excerpts = answerer.calls[-1][1]
    versions = [(excerpt.version, excerpt.text) for excerpt in excerpts if excerpt.version]
    assert ("first", "The budget is 12 450 000 KZT.") in versions and ("second", "The budget is 18 750 000 KZT.") in versions
    assert ("first", "The lead is Arman Sadykov.") in versions and ("second", "The lead is Elena Kim.") in versions
    assert all("850 000" not in text for _version, text in versions)  # unchanged: not a change
    sources = next(data for event, data in events if event == "sources")["sources"]
    assert [(source["documentId"], source["page"]) for source in sources] == [(first, 1), (second, 1)]

    ask(client, conversation, "What did not change?")
    unchanged = [excerpt.text for excerpt in answerer.calls[-1][1] if excerpt.version == "both"]
    assert unchanged == ["Reserve is 850 000 KZT."]


def test_one_document_or_an_ordinary_question_gets_no_comparison(client, answerer):
    from tests.test_chat import ask, ready_document

    first = ready_document(client, ("The budget is 12 450 000 KZT.", "x"))
    second = ready_document(client, ("The budget is 18 750 000 KZT.", "x"))
    answerer.reply = "NOT_FOUND"
    both = client.post("/api/v1/conversations", json={"documentIds": [first, second]}).json()["id"]
    ask(client, both, "What is the budget?")
    one = client.post("/api/v1/conversations", json={"documentIds": [first]}).json()["id"]
    ask(client, one, "What changed in the budget?")
    assert all(excerpt.version is None for call in answerer.calls for excerpt in call[1])


def test_which_amounts_are_mentioned_reaches_the_figures():
    """Found live: "Какие суммы указаны в документе?" (suggested by the interface) was refused by both models: the word
    "суммы" is not next to the figures, so search did not find them. Excerpts with money are now added."""
    from app.routers.conversations import select_chunks

    def chunk(number, text):
        return {"documentId": "d", "documentName": "a.pdf", "page": number, "location": None, "text": text, "segmentText": text}

    chunks = [chunk(1, "Утверждённый бюджет пилота составляет 12 450 000 ₸.")] + [
        chunk(n, f"Раздел {n} описывает порядок работы команды и сроки согласования.") for n in range(2, 20)
    ] + [chunk(20, "Резерв на риски 850 000 тенге.")]
    picked, overview = select_chunks("Какие суммы указаны в документе?", [], chunks)
    texts = [item["text"] for item in picked]
    assert not overview and chunks[0]["text"] in texts and chunks[-1]["text"] in texts
    plain, _ = select_chunks("Кто руководитель?", [], chunks)
    assert chunks[-1] not in plain


def test_the_prompt_answers_a_wrong_premise_instead_of_refusing():
    """Found live: "How many calendar days does the supplier have?" was refused, though the document says 5 working days."""
    from app.llm import SYSTEM_PROMPT

    assert "calendar days" in SYSTEM_PROMPT and "point out the difference" in SYSTEM_PROMPT
    assert "say nothing that answers the question, reply with exactly NOT_FOUND" in SYSTEM_PROMPT


def test_a_session_may_process_as_many_files_at_once_as_it_may_upload_per_minute():
    """Found live: dropping five files at once gave 'Too many requests' for the fourth and fifth, because only three
    could be processing at once while the upload limit allows six a minute. The frontend promises that several files
    at once are fine."""
    import os

    from app.config import Settings

    if "SESSION_MAX_PROCESSING" in os.environ or "UPLOAD_LIMIT_PER_MINUTE" in os.environ:
        return  # a deployment tuned these on purpose
    settings = Settings()
    assert settings.session_max_processing >= settings.upload_limit_per_minute
