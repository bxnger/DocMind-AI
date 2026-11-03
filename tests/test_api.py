from app.config import MAX_FILE_SIZE_BYTES
from tests.conftest import docx_bytes, pdf_bytes


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
    response = client.post("/api/v1/documents", files={"file": ("rules.pdf", pdf_bytes(), "application/pdf")})
    assert response.status_code == 202
    body = response.json()
    assert body["name"] == "rules.pdf"
    assert body["kind"] == "pdf"
    assert body["status"] == "processing"
    assert body["stage"] == "queued"
    assert body["hasPreview"] is True
    assert body["error"] is None


def test_upload_docx_has_no_preview(client):
    response = client.post(
        "/api/v1/documents",
        files={"file": ("rules.docx", docx_bytes(), "application/octet-stream")},
    )
    assert response.status_code == 202
    assert response.json()["hasPreview"] is False


def test_upload_unsupported_extension_is_415(client):
    response = client.post("/api/v1/documents", files={"file": ("notes.txt", b"hi", "text/plain")})
    assert response.status_code == 415
    assert response.json()["error"]["code"] == "UNSUPPORTED_TYPE"


def test_upload_wrong_content_is_415_and_leaves_no_file(client, store):
    response = client.post("/api/v1/documents", files={"file": ("fake.pdf", b"not a pdf", "application/pdf")})
    assert response.status_code == 415
    assert list(store.files_dir.iterdir()) == []


def test_upload_empty_file_is_422(client):
    response = client.post("/api/v1/documents", files={"file": ("empty.pdf", b"", "application/pdf")})
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
    response = client.post("/api/v1/documents", files={"file": ("big.pdf", pdf_bytes() * 10, "application/pdf")})
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "FILE_TOO_LARGE"


def test_list_and_get_document(client):
    created = client.post("/api/v1/documents", files={"file": ("a.pdf", pdf_bytes(), "application/pdf")}).json()

    listed = client.get("/api/v1/documents").json()
    assert [item["id"] for item in listed["items"]] == [created["id"]]

    fetched = client.get(f"/api/v1/documents/{created['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["id"] == created["id"]


def test_get_unknown_document_is_404(client):
    response = client.get("/api/v1/documents/nope")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "DOCUMENT_NOT_FOUND"


def test_file_is_not_ready_while_processing(client):
    created = client.post("/api/v1/documents", files={"file": ("a.pdf", pdf_bytes(), "application/pdf")}).json()
    response = client.get(f"/api/v1/documents/{created['id']}/file")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "DOCUMENT_NOT_READY"


def test_file_served_for_ready_pdf(client, store):
    created = client.post("/api/v1/documents", files={"file": ("a.pdf", pdf_bytes(), "application/pdf")}).json()
    # Parsing is not implemented yet, so mark the document ready by hand for this test only.
    with store._connect() as conn:
        conn.execute("UPDATE documents SET status = 'ready' WHERE id = ?", (created["id"],))

    response = client.get(f"/api/v1/documents/{created['id']}/file")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content == pdf_bytes()


def test_delete_document_removes_file(client, store):
    created = client.post("/api/v1/documents", files={"file": ("a.pdf", pdf_bytes(), "application/pdf")}).json()
    response = client.delete(f"/api/v1/documents/{created['id']}")
    assert response.status_code == 204
    assert list(store.files_dir.iterdir()) == []
    assert client.get(f"/api/v1/documents/{created['id']}").status_code == 404


def test_every_response_has_request_id_header(client):
    response = client.get("/api/v1/health")
    assert response.headers["X-Request-Id"]
