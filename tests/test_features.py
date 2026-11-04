import pytest
from fastapi.testclient import TestClient

from app.comparison import Sentence, compare, summarize
from app.config import Settings
from app.deps import get_answerer, get_store
from app.extraction import ExtractionError, Segment, extract_docx
from app.highlights import quote_highlights
from app.main import create_app
from tests.conftest import make_pdf, upload


def sentences(*texts, page=1):
    return [Sentence(text, page, None, " ".join(texts)) for text in texts]


# Highlights


def test_highlights_locate_the_quote_on_the_page(tmp_path):
    path = tmp_path / "a.pdf"
    path.write_bytes(make_pdf(["Registration closes on 5 November 2026."]))
    boxes = quote_highlights(path, 1, "Registration closes on 5 November 2026.")
    assert boxes
    assert all(0 <= value <= 1 for box in boxes for value in box.values())
    assert boxes[0]["x"] == pytest.approx(72 / 595, abs=0.02)


def test_highlights_are_empty_when_the_quote_is_not_on_the_page(tmp_path):
    path = tmp_path / "a.pdf"
    path.write_bytes(make_pdf(["Something else entirely."]))
    assert quote_highlights(path, 1, "Registration closes") == []


def test_highlights_survive_a_bad_page_number(tmp_path):
    path = tmp_path / "a.pdf"
    path.write_bytes(make_pdf(["Hello there."]))
    assert quote_highlights(path, 9, "Hello") == []


# DOCX tables


def test_docx_tables_are_read(tmp_path):
    from docx import Document

    document = Document()
    document.add_heading("Schedule", level=1)
    table = document.add_table(rows=2, cols=2)
    table.cell(0, 0).text = "Stage"
    table.cell(0, 1).text = "Date"
    table.cell(1, 0).text = "Final"
    table.cell(1, 1).text = "14 November"
    path = tmp_path / "t.docx"
    document.save(path)

    segments = extract_docx(path)
    assert segments == [Segment(None, "Schedule", "Schedule Stage | Date Final | 14 November")]


# Comparison logic


def test_compare_finds_changed_added_and_removed():
    a = sentences("Registration closes on 5 November.", "Teams have three members.", "Old rule applies.")
    b = sentences("Registration closes on 7 November.", "Teams have three members.", "A brand new clause appears here.")
    result = compare(a, b)
    assert {d["type"] for d in result} == {"changed", "removed", "added"}
    changed = next(d for d in result if d["type"] == "changed")
    assert changed["explanation"] == "Numbers differ: 5 vs 7"
    assert changed["a"]["quote"] == "Registration closes on 5 November."
    assert changed["b"]["quote"] == "Registration closes on 7 November."
    assert next(d for d in result if d["type"] == "removed")["b"] is None
    assert next(d for d in result if d["type"] == "added")["a"] is None


def test_compare_identical_documents_has_no_differences():
    a = sentences("Same text here.", "And more of it.")
    assert compare(a, a) == []
    assert summarize([]) == "No differences found."


# Comparison API


def uploaded(client, pages) -> str:
    return upload(client, "doc.pdf", make_pdf(pages)).json()["id"]


def test_comparison_end_to_end(client):
    first = uploaded(client, ["Registration closes on 5 November."])
    second = uploaded(client, ["Registration closes on 7 November."])

    response = client.post("/api/v1/comparisons", json={"documentAId": first, "documentBId": second})
    assert response.status_code == 202
    assert response.json()["status"] == "processing"

    body = client.get(f"/api/v1/comparisons/{response.json()['id']}").json()
    assert body["status"] == "ready"
    assert body["progress"] == 1.0
    assert body["summary"] == "1 differences: 1 changed, 0 only in the second document, 0 only in the first."
    difference = body["differences"][0]
    assert difference["type"] == "changed"
    assert difference["a"] == {"page": 1, "quote": "Registration closes on 5 November."}


def test_comparison_errors(client):
    first = uploaded(client, ["Some text."])
    scan = uploaded(client, [""])

    same = client.post("/api/v1/comparisons", json={"documentAId": first, "documentBId": first})
    assert same.status_code == 422
    assert same.json()["error"]["code"] == "SAME_DOCUMENT"

    missing = client.post("/api/v1/comparisons", json={"documentAId": first, "documentBId": "nope"})
    assert missing.status_code == 404

    not_ready = client.post("/api/v1/comparisons", json={"documentAId": first, "documentBId": scan})
    assert not_ready.status_code == 409

    unknown = client.get("/api/v1/comparisons/nope")
    assert unknown.status_code == 404
    assert unknown.json()["error"]["code"] == "COMPARISON_NOT_FOUND"


def test_comparison_too_large_is_413(client, monkeypatch):
    monkeypatch.setattr("app.comparison.MAX_SENTENCES", 1)
    first = uploaded(client, ["One sentence. Another sentence."])
    second = uploaded(client, ["Other text."])
    response = client.post("/api/v1/comparisons", json={"documentAId": first, "documentBId": second})
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "DOCUMENT_TOO_LARGE_FOR_COMPARISON"


# OCR pipeline. Tesseract is not installed on the dev machine, so the OCR call itself is replaced.


def test_scan_goes_through_ocr_when_it_is_set_up(client, monkeypatch):
    def fake_extract(path, languages=None):
        return [Segment(1, None, "Text recognised from the scan.")] if languages else [Segment(1, None, "")]

    monkeypatch.setattr("app.pipeline.ocr_languages", lambda: "eng")
    monkeypatch.setattr("app.pipeline.extract_pdf", fake_extract)

    created = upload(client, "scan.pdf", make_pdf([""])).json()
    document = client.get(f"/api/v1/documents/{created['id']}").json()
    assert document["status"] == "ready"
    assert document["ocrUsed"] is True


def test_ocr_failure_is_reported(client, monkeypatch):
    def fake_extract(path, languages=None):
        if languages:
            raise ExtractionError("OCR_FAILED", "The PDF could not be read")
        return [Segment(1, None, "")]

    monkeypatch.setattr("app.pipeline.ocr_languages", lambda: "eng")
    monkeypatch.setattr("app.pipeline.extract_pdf", fake_extract)

    created = upload(client, "scan.pdf", make_pdf([""])).json()
    document = client.get(f"/api/v1/documents/{created['id']}").json()
    assert document["status"] == "failed"
    assert document["error"]["code"] == "OCR_FAILED"


# Rate limiting


def limited_client(store, upload_limit=2, chat_limit=2) -> TestClient:
    settings = Settings(
        data_dir=store.files_dir.parent,
        cors_origins=("http://localhost:5173",),
        upload_limit_per_minute=upload_limit,
        chat_limit_per_minute=chat_limit,
    )
    app = create_app(settings)
    app.dependency_overrides[get_store] = lambda: store
    app.dependency_overrides[get_answerer] = lambda: None
    return TestClient(app)


def test_uploads_are_rate_limited(store):
    client = limited_client(store)
    for _ in range(2):
        assert upload(client, "a.pdf", make_pdf(["Hi"])).status_code == 202
    response = upload(client, "a.pdf", make_pdf(["Hi"]))
    assert response.status_code == 429
    assert response.json()["error"]["code"] == "RATE_LIMITED"
    assert response.json()["error"]["retryable"] is True


def test_chat_is_rate_limited(store):
    client = limited_client(store, chat_limit=1)
    document_id = upload(client, "a.pdf", make_pdf(["Hi there"])).json()["id"]
    conversation_id = client.post("/api/v1/conversations", json={"documentIds": [document_id]}).json()["id"]
    url = f"/api/v1/conversations/{conversation_id}/messages"
    assert client.post(url, json={"content": "Hi"}).status_code == 503  # no model, but the call was counted
    assert client.post(url, json={"content": "Hi"}).status_code == 429
