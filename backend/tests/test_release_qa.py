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
