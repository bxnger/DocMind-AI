from app.config import MAX_FILE_SIZE_BYTES
from tests.conftest import fake_docx_bytes, make_docx, make_pdf, upload


def test_health(client):
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_capabilities_reports_only_what_is_implemented(client):
    body = client.get("/api/v1/capabilities").json()
    assert body["ocr"] is False
    assert body["comparison"] is False
    assert body["highlights"] is False
    assert body["docxPreview"] == "none"
    assert body["limits"]["maxFileSizeBytes"] == MAX_FILE_SIZE_BYTES


def test_upload_pdf_returns_202_processing(client):
    response = upload(client, "rules.pdf", make_pdf(["Hello"]))
    assert response.status_code == 202
    body = response.json()
    assert body["name"] == "rules.pdf"
    assert body["kind"] == "pdf"
    assert body["status"] == "processing"
    assert body["stage"] == "queued"
    assert body["hasPreview"] is True


def test_upload_unsupported_extension_is_415(client):
    response = upload(client, "notes.txt", b"hi")
    assert response.status_code == 415
    assert response.json()["error"]["code"] == "UNSUPPORTED_TYPE"


def test_upload_wrong_content_is_415_and_leaves_no_file(client, store):
    response = upload(client, "fake.pdf", b"not a pdf")
    assert response.status_code == 415
    assert list(store.files_dir.iterdir()) == []


def test_upload_empty_file_is_422(client):
    response = upload(client, "empty.pdf", b"")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_upload_without_file_field_is_422_in_contract_shape(client):
    response = client.post("/api/v1/documents")
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert error["retryable"] is False
    assert error["requestId"]


def test_upload_too_large_is_413(client, monkeypatch):
    monkeypatch.setattr("app.routers.documents.MAX_FILE_SIZE_BYTES", 100)
    response = upload(client, "big.pdf", make_pdf(["x"]) * 10)
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "FILE_TOO_LARGE"


def test_pdf_becomes_ready_after_processing(client):
    created = upload(client, "a.pdf", make_pdf(["First page text.", "Second page text."])).json()
    fetched = client.get(f"/api/v1/documents/{created['id']}").json()
    assert fetched["status"] == "ready"
    assert fetched["stage"] is None
    assert fetched["pageCount"] == 2
    assert fetched["ocrUsed"] is False
    assert fetched["error"] is None


def test_docx_becomes_ready_with_no_page_count(client):
    data = make_docx([(None, ["Intro paragraph."]), ("Rules", ["Teams have at most three members."])])
    created = upload(client, "rules.docx", data).json()
    fetched = client.get(f"/api/v1/documents/{created['id']}").json()
    assert fetched["status"] == "ready"
    assert fetched["pageCount"] is None


def test_blank_pdf_fails_with_no_text_found(client):
    created = upload(client, "scan.pdf", make_pdf([""])).json()
    fetched = client.get(f"/api/v1/documents/{created['id']}").json()
    assert fetched["status"] == "failed"
    assert fetched["error"]["code"] == "NO_TEXT_FOUND"


def test_broken_pdf_fails_with_parse_failed(client):
    created = upload(client, "broken.pdf", b"%PDF-1.4\ngarbage").json()
    fetched = client.get(f"/api/v1/documents/{created['id']}").json()
    assert fetched["status"] == "failed"
    assert fetched["error"]["code"] == "PARSE_FAILED"


def test_broken_docx_fails_with_parse_failed(client):
    created = upload(client, "broken.docx", fake_docx_bytes()).json()
    fetched = client.get(f"/api/v1/documents/{created['id']}").json()
    assert fetched["status"] == "failed"
    assert fetched["error"]["code"] == "PARSE_FAILED"


def test_list_and_get_document(client):
    created = upload(client, "a.pdf", make_pdf(["Hello"])).json()
    listed = client.get("/api/v1/documents").json()
    assert [item["id"] for item in listed["items"]] == [created["id"]]
    assert client.get(f"/api/v1/documents/{created['id']}").json()["id"] == created["id"]


def test_get_unknown_document_is_404(client):
    response = client.get("/api/v1/documents/nope")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "DOCUMENT_NOT_FOUND"


def test_file_is_not_available_for_failed_document(client):
    created = upload(client, "scan.pdf", make_pdf([""])).json()
    response = client.get(f"/api/v1/documents/{created['id']}/file")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "DOCUMENT_NOT_READY"


def test_file_served_for_ready_pdf(client):
    data = make_pdf(["Hello"])
    created = upload(client, "a.pdf", data).json()
    response = client.get(f"/api/v1/documents/{created['id']}/file")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content == data


def test_file_for_ready_docx_is_preview_unavailable(client):
    created = upload(client, "a.docx", make_docx([(None, ["Text."])])).json()
    response = client.get(f"/api/v1/documents/{created['id']}/file")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "PREVIEW_UNAVAILABLE"


def test_delete_document_removes_file_and_text(client, store):
    created = upload(client, "a.pdf", make_pdf(["Hello"])).json()
    assert client.delete(f"/api/v1/documents/{created['id']}").status_code == 204
    assert list(store.files_dir.iterdir()) == []
    assert client.get(f"/api/v1/documents/{created['id']}").status_code == 404


def test_every_response_has_request_id_header(client):
    assert client.get("/api/v1/health").headers["X-Request-Id"]
