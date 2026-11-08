"""Two real guests against the real app, real database and real worker process. Only the AI model is scripted."""

import io
import logging
import sys
import zipfile

import pytest
from fastapi.testclient import TestClient

from app.config import MAX_DOCX_UNPACKED_BYTES, MAX_FILE_SIZE_BYTES, Settings
from app.deps import get_answerer, get_store
from app.main import create_app
from bot.backend_client import BackendClient
from bot.handlers import Bot
from tests.conftest import FakeAnswerer, make_docx, make_pdf, relaxed_settings, upload
from tests.test_bot import FakeTelegram, text_update

API = "/api/v1"
TEXT = "Registration closes on 5 November 2026. The fee is 500 US dollars."


def build(store, answerer=None, **changes):
    app = create_app(relaxed_settings(store, **changes))
    app.dependency_overrides[get_store] = lambda: store
    app.dependency_overrides[get_answerer] = lambda: answerer or FakeAnswerer("Registration closes on 5 November 2026 [1].")
    return app


def guest(app) -> TestClient:
    client = TestClient(app)
    response = client.post(f"{API}/sessions")
    assert response.status_code == 201
    client.headers["Authorization"] = f"Bearer {response.json()['token']}"
    return client


@pytest.fixture
def app(store):
    return build(store)


@pytest.fixture
def world(app):
    """A owns a PDF, a second PDF, a DOCX, a conversation with history and a comparison."""
    a, b = guest(app), guest(app)
    pdf = upload(a, "a.pdf", make_pdf([TEXT])).json()["id"]
    other = upload(a, "a2.pdf", make_pdf([TEXT + " Changed."])).json()["id"]
    docx = upload(a, "a.docx", make_docx([("Terms", [TEXT])])).json()["id"]
    conversation = a.post(f"{API}/conversations", json={"documentIds": [pdf]}).json()["id"]
    assert "Registration" in a.post(f"{API}/conversations/{conversation}/messages", json={"content": "When does registration close?"}).text
    comparison = a.post(f"{API}/comparisons", json={"documentAId": pdf, "documentBId": other}).json()["id"]
    return dict(a=a, b=b, pdf=pdf, other=other, docx=docx, conversation=conversation, comparison=comparison)


def foreign_requests(w):
    d, x, c, k = w["pdf"], w["docx"], w["conversation"], w["comparison"]
    return [
        ("GET", f"/documents/{d}", None), ("GET", f"/documents/{d}/file", None), ("GET", f"/documents/{d}/pages/1", None),
        ("GET", f"/documents/{d}/text", None), ("GET", f"/documents/{x}/text", None), ("GET", f"/documents/{d}/facts", None),
        ("GET", f"/documents/{x}/facts", None), ("DELETE", f"/documents/{d}", None), ("GET", f"/conversations/{c}", None),
        ("GET", f"/conversations/{c}/messages", None), ("DELETE", f"/conversations/{c}", None),
        ("POST", f"/conversations/{c}/messages", {"content": "When does registration close?"}),
        ("POST", "/conversations", {"documentIds": [d]}), ("GET", f"/comparisons/{k}", None),
    ]


def test_every_route_hides_a_foreign_object_behind_404(world):
    for method, path, body in foreign_requests(world):
        response = world["b"].request(method, API + path, json=body)
        assert response.status_code == 404, (method, path)
        assert "Registration" not in response.text


def test_compare_cannot_reach_a_foreign_document(world):
    mine = upload(world["b"], "b.pdf", make_pdf(["Mine."])).json()["id"]
    for pair in ({"documentAId": world["pdf"], "documentBId": mine}, {"documentAId": mine, "documentBId": world["pdf"]}):
        assert world["b"].post(f"{API}/comparisons", json=pair).status_code == 404


def test_lists_show_only_your_own(world):
    a, b = world["a"], world["b"]
    assert b.get(f"{API}/documents").json()["items"] == []
    assert b.get(f"{API}/conversations").json()["items"] == []
    assert {item["id"] for item in a.get(f"{API}/documents").json()["items"]} == {world["pdf"], world["other"], world["docx"]}


def test_a_keeps_access_after_b_tried_everything(world):
    for method, path, body in foreign_requests(world):
        world["b"].request(method, API + path, json=body)
    a = world["a"]
    assert a.get(f"{API}/documents/{world['pdf']}/file").status_code == 200
    assert a.get(f"{API}/documents/{world['pdf']}/facts").status_code == 200
    assert len(a.get(f"{API}/conversations/{world['conversation']}/messages").json()["items"]) == 2


def test_cached_facts_are_not_a_way_around_ownership(world):
    assert world["a"].get(f"{API}/documents/{world['pdf']}/facts").status_code == 200
    assert world["b"].get(f"{API}/documents/{world['pdf']}/facts").status_code == 404


@pytest.mark.parametrize("header", [None, "Bearer wrong", "Basic abc", "Bearer ", "token"])
def test_no_valid_token_no_access(app, world, header):
    client = TestClient(app)
    headers = {"Authorization": header} if header else {}
    for path in ("/documents", f"/documents/{world['pdf']}/file", "/conversations", f"/comparisons/{world['comparison']}"):
        response = client.get(API + path, headers=headers)
        assert response.status_code == 401
        assert response.json()["error"]["code"] in ("UNAUTHORIZED", "SESSION_EXPIRED")


def test_a_client_cannot_name_an_owner(world, store):
    body = world["b"].post(f"{API}/conversations", json={"documentIds": [world["pdf"]], "ownerId": "x", "owner_id": "x"})
    assert body.status_code == 404


def test_tokens_are_random_and_stored_only_hashed(app, store):
    client = TestClient(app)
    tokens = {client.post(f"{API}/sessions").json()["token"] for _ in range(5)}
    assert len(tokens) == 5 and all(len(token) >= 40 for token in tokens)
    database = store.db_path.read_bytes() + (store.db_path.with_name("app.db-wal").read_bytes() if store.db_path.with_name("app.db-wal").exists() else b"")
    assert not any(token.encode() in database for token in tokens)


def test_expired_session_loses_access_and_its_data(store, app):
    a = guest(app)
    doc = upload(a, "a.pdf", make_pdf([TEXT])).json()["id"]
    path = store.file_path(doc, "pdf")
    assert path.exists()
    with store._db() as conn:
        conn.execute("UPDATE sessions SET expires_at = '2000-01-01T00:00:00+00:00'")
    assert a.get(f"{API}/documents").json()["error"]["code"] == "SESSION_EXPIRED"
    assert store.purge_expired_sessions() == 1
    assert not path.exists() and store.list() == []


def test_ending_a_session_deletes_what_it_owns(store, app):
    a = guest(app)
    doc = upload(a, "a.pdf", make_pdf([TEXT])).json()["id"]
    assert a.delete(f"{API}/sessions/current").status_code == 204
    assert a.get(f"{API}/documents").status_code == 401
    assert not store.file_path(doc, "pdf").exists()


def demo_document(store, tmp_path) -> str:
    from app.pipeline import process_document

    doc_id = store.new_id()
    store.file_path(doc_id, "pdf").write_bytes(make_pdf([TEXT]))
    store.insert(doc_id, "demo.pdf", "pdf", 100)
    store.mark_demo(doc_id)
    process_document(store, doc_id)
    return doc_id


def test_demo_documents_are_public_and_read_only(store, app, tmp_path):
    demo = demo_document(store, tmp_path)
    a, b = guest(app), guest(app)
    assert demo in [item["id"] for item in b.get(f"{API}/documents").json()["items"]]
    assert b.get(f"{API}/documents/{demo}").json()["isDemo"] is True
    assert b.get(f"{API}/documents/{demo}/file").status_code == 200
    response = b.delete(f"{API}/documents/{demo}")
    assert response.status_code == 403 and response.json()["error"]["code"] == "DEMO_READ_ONLY"
    # Each guest's conversation about it stays private.
    conversation = a.post(f"{API}/conversations", json={"documentIds": [demo]}).json()["id"]
    assert b.get(f"{API}/conversations/{conversation}").status_code == 404
    assert b.get(f"{API}/sessions/current").json()["usage"]["documents"] == 0  # demo files use nobody's quota


def test_documents_without_an_owner_stay_hidden(store, app):
    doc_id = store.new_id()
    store.insert(doc_id, "old.pdf", "pdf", 10)
    assert guest(app).get(f"{API}/documents/{doc_id}").status_code == 404


# ---------- uploads


def bomb(unpacked_mb: int = 240) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("word/document.xml", b"<w:p>" + b"a" * (unpacked_mb * 1024 * 1024))
    return buffer.getvalue()


def leftovers(store) -> list[str]:
    return sorted(path.name for path in store.files_dir.iterdir())


def test_docx_bomb_is_refused_before_anything_unpacks(store, client):
    data = bomb()
    assert len(data) < 1024 * 1024
    response = upload(client, "bomb.docx", data)
    assert response.status_code == 413 and response.json()["error"]["code"] == "DOCX_TOO_LARGE"
    assert leftovers(store) == [] and store.list() == []


def test_docx_with_too_many_entries_is_refused(store, client):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", "<a/>")
        for number in range(2001):
            archive.writestr(f"x/{number}", "")
    assert upload(client, "many.docx", buffer.getvalue()).status_code == 413
    assert leftovers(store) == []


def test_large_images_in_a_docx_are_not_mistaken_for_a_bomb(client):
    buffer = io.BytesIO()
    source = make_docx([("Terms", [TEXT])])
    with zipfile.ZipFile(io.BytesIO(source)) as original, zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for item in original.infolist():
            archive.writestr(item, original.read(item.filename))
        archive.writestr("word/media/big.bin", b"\0" * (MAX_DOCX_UNPACKED_BYTES // 2))
    created = upload(client, "pictures.docx", buffer.getvalue())
    assert created.status_code == 202
    assert client.get(f"{API}/documents/{created.json()['id']}").json()["status"] == "ready"


@pytest.mark.parametrize("name,data", [("x.pdf", b"not a pdf"), ("x.docx", b"not a zip"), ("x.docx", b"PK\x03\x04broken"), ("x.exe", b"MZ")])
def test_content_decides_the_type(store, client, name, data):
    assert upload(client, name, data).status_code == 415
    assert leftovers(store) == []


def test_a_zip_that_is_not_a_docx_is_refused(store, client):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("readme.txt", "hello")
    assert upload(client, "x.docx", buffer.getvalue()).status_code == 415
    assert leftovers(store) == []


def test_size_limit_at_the_boundary(store, client):
    too_big = upload(client, "big.pdf", b"%PDF-" + b"0" * MAX_FILE_SIZE_BYTES)
    assert too_big.status_code == 413
    assert leftovers(store) == []
    at_limit = upload(client, "edge.pdf", b"%PDF-" + b"0" * (MAX_FILE_SIZE_BYTES - 5))
    assert at_limit.status_code == 202
    assert client.get(f"{API}/documents/{at_limit.json()['id']}").json()["error"]["code"] == "PARSE_FAILED"
    assert leftovers(store) == []  # a failed document keeps no file


def test_a_request_far_over_the_limit_is_refused(client):
    response = client.post(f"{API}/documents", files={"file": ("x.pdf", b"%PDF-" + b"0" * (MAX_FILE_SIZE_BYTES + 2 * 1024 * 1024))})
    assert response.status_code == 413


def test_oversized_json_is_refused(client):
    assert client.post(f"{API}/conversations", json={"documentIds": ["a"], "title": "x" * 300_000}).status_code == 413


def test_page_limit_is_checked_before_reading(store, client, monkeypatch):
    monkeypatch.setattr("app.pipeline.MAX_PAGES", 2)
    created = upload(client, "long.pdf", make_pdf(["a", "b", "c"])).json()
    state = client.get(f"{API}/documents/{created['id']}").json()
    assert state["status"] == "failed" and "more than 2 pages" in state["error"]["message"]
    assert leftovers(store) == []


POSIX_ONLY = pytest.mark.skipif(sys.platform == "win32", reason="memory limits and file modes are POSIX: the server runs Linux")


@pytest.mark.parametrize(
    "name,value",
    [("app.pipeline.WORKER_TIMEOUT_SECONDS", 0), pytest.param("app.pipeline.WORKER_MEMORY_MB", 1, marks=POSIX_ONLY)],
)
def test_worker_over_its_limit_is_killed_and_leaves_nothing(store, client, monkeypatch, name, value):
    monkeypatch.setattr(name, value)
    created = upload(client, "a.pdf", make_pdf([TEXT])).json()
    state = client.get(f"{API}/documents/{created['id']}").json()
    assert state["status"] == "failed" and state["error"]["code"] == "DOCUMENT_TOO_COMPLEX"
    assert leftovers(store) == [] and store.segments_for_document(created["id"]) == []


def test_worker_gets_no_secrets(store, monkeypatch):
    import app.pipeline as pipeline

    seen = {}
    real = pipeline.subprocess.Popen

    def spy(*args, **kwargs):
        seen.update(kwargs.get("env") or {})
        return real(*args, **kwargs)

    monkeypatch.setenv("GROQ_API_KEY", "secret-value")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "secret-value")
    monkeypatch.setattr(pipeline.subprocess, "Popen", spy)
    doc_id = store.new_id()
    store.file_path(doc_id, "pdf").write_bytes(make_pdf([TEXT]))
    store.insert(doc_id, "a.pdf", "pdf", 1)
    pipeline.process_document(store, doc_id)
    assert store.get(doc_id)["status"] == "ready"
    assert seen and "secret-value" not in seen.values()


def test_docx_reader_does_not_parse_in_the_api_process(client, monkeypatch):
    created = upload(client, "a.docx", make_docx([("Terms", [TEXT])])).json()
    monkeypatch.setattr("app.extraction.docx_blocks", lambda path: pytest.fail("parsed again"))
    assert client.get(f"{API}/documents/{created['id']}/text").json()["blocks"]


# ---------- limits


def test_one_guest_at_their_limit_does_not_block_another(store):
    app = build(store, chat_limit_per_minute=2, upload_limit_per_minute=2, facts_limit_per_minute=1, text_limit_per_minute=1, compare_limit_per_minute=1)
    a, b = guest(app), guest(app)
    doc_a = upload(a, "a.pdf", make_pdf([TEXT])).json()["id"]
    doc_b = upload(b, "b.pdf", make_pdf([TEXT])).json()["id"]
    conv_a = a.post(f"{API}/conversations", json={"documentIds": [doc_a]}).json()["id"]
    conv_b = b.post(f"{API}/conversations", json={"documentIds": [doc_b]}).json()["id"]
    url = f"{API}/conversations/{conv_a}/messages"
    statuses = [a.post(url, json={"content": f"registration {n}"}).status_code for n in range(3)]
    assert statuses == [200, 200, 429]
    limited = a.post(url, json={"content": "registration"})
    assert limited.json()["error"]["code"] == "RATE_LIMITED"
    assert limited.json()["error"]["retryable"] is True and int(limited.headers["Retry-After"]) >= 1
    assert b.post(f"{API}/conversations/{conv_b}/messages", json={"content": "registration"}).status_code == 200
    for path, _ in (("facts", 1), ("text", 1)):
        assert a.get(f"{API}/documents/{doc_a}/{path}").status_code == 200
        assert a.get(f"{API}/documents/{doc_a}/{path}").status_code == 429
        assert b.get(f"{API}/documents/{doc_b}/{path}").status_code == 200


def test_compare_is_limited_per_guest(store):
    app = build(store, compare_limit_per_minute=1)
    a = guest(app)
    first = upload(a, "a.pdf", make_pdf([TEXT])).json()["id"]
    second = upload(a, "b.pdf", make_pdf(["Other."])).json()["id"]
    pair = {"documentAId": first, "documentBId": second}
    assert a.post(f"{API}/comparisons", json=pair).status_code == 202
    assert a.post(f"{API}/comparisons", json=pair).status_code == 429


def test_document_count_and_size_quotas(store):
    app = build(store, session_max_documents=1)
    a, b = guest(app), guest(app)
    assert upload(a, "a.pdf", make_pdf([TEXT])).status_code == 202
    refused = upload(a, "b.pdf", make_pdf([TEXT]))
    assert refused.status_code == 429 and refused.json()["error"] == refused.json()["error"] | {"code": "QUOTA_EXCEEDED", "retryable": False}
    assert len(list(store.files_dir.iterdir())) == 1  # the refused file was not kept
    assert upload(b, "c.pdf", make_pdf([TEXT])).status_code == 202
    bytes_app = build(store, session_max_bytes=10)
    assert upload(guest(bytes_app), "d.pdf", make_pdf([TEXT])).json()["error"]["code"] == "QUOTA_EXCEEDED"


def test_server_wide_storage_limit(store):
    response = upload(guest(build(store, global_max_bytes=10)), "a.pdf", make_pdf([TEXT]))
    assert response.status_code == 503 and response.json()["error"]["code"] == "STORAGE_FULL"


def chat(client, document_id, question="When does registration close?"):
    conversation = client.post(f"{API}/conversations", json={"documentIds": [document_id]}).json()["id"]
    return client.post(f"{API}/conversations/{conversation}/messages", json={"content": question})


def test_ai_budget_per_guest_leaves_others_working_and_survives_a_restart(store):
    app = build(store, ai_session_daily_limit=1)
    a, b = guest(app), guest(app)
    doc_a = upload(a, "a.pdf", make_pdf([TEXT])).json()["id"]
    doc_b = upload(b, "b.pdf", make_pdf([TEXT + " More."])).json()["id"]
    assert chat(a, doc_a).status_code == 200
    over = chat(a, doc_a, "What is the fee for registration?")
    assert over.status_code == 429 and over.json()["error"]["code"] == "AI_SESSION_BUDGET_EXCEEDED"
    assert over.json()["error"]["retryable"] is False and int(over.headers["Retry-After"]) > 0
    assert chat(b, doc_b).status_code == 200
    restarted = build(store, ai_session_daily_limit=1)
    assert a.headers["Authorization"]
    again = TestClient(restarted, headers={"Authorization": a.headers["Authorization"]})
    assert chat(again, doc_a, "And the fee for registration?").status_code == 429


def test_a_remembered_answer_costs_no_budget(store):
    app = build(store, ai_session_daily_limit=1)
    a = guest(app)
    doc = upload(a, "a.pdf", make_pdf([TEXT])).json()["id"]
    assert chat(a, doc).status_code == 200
    assert chat(a, doc).status_code == 200


def test_many_sessions_from_one_address_share_a_limit(store):
    app = build(store, ai_client_daily_limit=1)
    a, b = guest(app), guest(app)
    doc_a = upload(a, "a.pdf", make_pdf([TEXT])).json()["id"]
    doc_b = upload(b, "b.pdf", make_pdf([TEXT + " Other."])).json()["id"]
    assert chat(a, doc_a).status_code == 200
    assert chat(b, doc_b).json()["error"]["code"] == "AI_BUDGET_EXCEEDED"


def test_global_budget_and_emergency_stop(store):
    answerer = FakeAnswerer("Registration closes on 5 November 2026 [1].")
    app = build(store, answerer, ai_global_daily_limit=0)
    a = guest(app)
    doc = upload(a, "a.pdf", make_pdf([TEXT])).json()["id"]
    assert chat(a, doc).json()["error"]["code"] == "AI_BUDGET_EXCEEDED"
    stopped = build(store, answerer, ai_emergency_stop=True)
    b = guest(stopped)
    doc = upload(b, "b.pdf", make_pdf([TEXT])).json()["id"]
    assert chat(b, doc).status_code == 429
    assert answerer.calls == []


def test_session_creation_is_limited_by_address(store):
    client = TestClient(build(store, session_limit_per_minute=2))
    assert [client.post(f"{API}/sessions").status_code for _ in range(3)] == [201, 201, 429]


def test_forged_forwarded_header_does_not_change_the_client(store):
    client = TestClient(build(store, session_limit_per_minute=1))
    assert client.post(f"{API}/sessions", headers={"X-Forwarded-For": "1.1.1.1"}).status_code == 201
    assert client.post(f"{API}/sessions", headers={"X-Forwarded-For": "2.2.2.2"}).status_code == 429


def test_trusted_proxy_header_is_read_from_its_end(store):
    client = TestClient(build(store, session_limit_per_minute=1, trusted_proxies=("testclient",)))
    assert client.post(f"{API}/sessions", headers={"X-Forwarded-For": "9.9.9.9, 1.1.1.1"}).status_code == 201
    assert client.post(f"{API}/sessions", headers={"X-Forwarded-For": "8.8.8.8, 1.1.1.1"}).status_code == 429
    assert client.post(f"{API}/sessions", headers={"X-Forwarded-For": "2.2.2.2"}).status_code == 201


# ---------- production configuration


@pytest.mark.parametrize("env,expected", [("", 404), ("production", 404), ("development", 200)])
def test_api_docs_exist_only_in_development(tmp_path, env, expected):
    client = TestClient(create_app(Settings(data_dir=tmp_path, app_env=env, cors_origins=("https://app.example",))))
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == expected


@pytest.mark.parametrize("origins", [
    ("*",), ("http://app.example",), ("https://a.example", "*"), ("https://*.vercel.app",), ("https://",),
    ("capacitor://evil.example",), ("capacitor://*",), ("ionic://localhost",), ("http://localhost",),
])
def test_production_refuses_loose_cors(tmp_path, origins):
    with pytest.raises(RuntimeError):
        create_app(Settings(data_dir=tmp_path, app_env="production", cors_origins=origins))


def test_production_accepts_the_mobile_app_origins(tmp_path):
    """Android (Capacitor) is https://localhost, iOS is capacitor://localhost: both exact, both allowed in production."""
    origins = ("https://app.example", "https://localhost", "capacitor://localhost")
    client = TestClient(create_app(Settings(data_dir=tmp_path, app_env="production", cors_origins=origins)))
    for origin in origins:
        answer = client.options(f"{API}/health", headers={"Origin": origin, "Access-Control-Request-Method": "GET"})
        assert answer.headers["access-control-allow-origin"] == origin
    other = client.options(f"{API}/health", headers={"Origin": "capacitor://evil", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in other.headers


def test_cors_allows_only_the_listed_origin(store):
    app = create_app(relaxed_settings(store, cors_origins=("https://app.example",)))
    client = TestClient(app)
    assert "access-control-allow-origin" not in client.get(f"{API}/health", headers={"Origin": "https://evil.example"}).headers
    good = client.options(f"{API}/documents", headers={"Origin": "https://app.example", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization"})
    assert good.headers["access-control-allow-origin"] == "https://app.example"


def test_security_headers_and_hsts(tmp_path):
    client = TestClient(create_app(Settings(data_dir=tmp_path, app_env="production", cors_origins=("https://app.example",))))
    headers = client.get(f"{API}/health").headers
    assert headers["x-content-type-options"] == "nosniff" and headers["cache-control"] == "no-store"
    assert "max-age" in headers["strict-transport-security"]


def test_an_internal_error_reveals_nothing(store, app, caplog):
    a = guest(app)

    def explode(*_args):
        raise ValueError("secret path /data/private")

    store.list = explode
    with caplog.at_level(logging.ERROR):
        response = a.get(f"{API}/documents")
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "INTERNAL_ERROR"
    assert "secret" not in response.text and "secret" not in caplog.text


def test_tokens_do_not_reach_the_logs(store, caplog):
    with caplog.at_level(logging.DEBUG):
        app = build(store)
        client = TestClient(app)
        token = client.post(f"{API}/sessions").json()["token"]
        client.get(f"{API}/documents", headers={"Authorization": f"Bearer {token}"})
    assert token not in caplog.text


# ---------- Telegram


def test_empty_allowlist_lets_nobody_in(client):
    telegram = FakeTelegram()
    Bot(telegram, BackendClient(client)).handle_update(text_update("/docs", chat=5))
    assert telegram.messages and "закрыт" in telegram.last


def test_bot_refuses_to_start_without_an_allowlist(monkeypatch, capsys):
    from bot import main as bot_main

    monkeypatch.setattr(bot_main, "load_env_file", lambda: None)
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123:secret-token")
    monkeypatch.setenv("TELEGRAM_ALLOWED_CHATS", " ")
    monkeypatch.setattr("sys.argv", ["bot"])
    assert bot_main.main() == 1
    assert "secret-token" not in capsys.readouterr().out


def test_chats_are_separate_guests(app):
    from tests.test_bot import file_update

    http = TestClient(app)
    telegram = FakeTelegram()
    bot = Bot(telegram, BackendClient(http), allowed_chats={1, 2}, per_minute=100)
    bot.handle_update(file_update(telegram, "first.pdf", make_pdf([TEXT]), chat=1))
    assert bot.chat(1)["docs"]
    bot.handle_update(text_update("/docs", chat=2))
    assert "first.pdf" not in telegram.last
    other = BackendClient(http).for_session(bot.backend.create_session())
    assert other.document(bot.chat(1)["docs"][0]["id"]) is None
    assert bot.chat(1)["token"] != bot.chat(2).get("token")


@POSIX_ONLY
def test_bot_state_file_is_private(app, tmp_path):
    from tests.test_bot import file_update

    path = tmp_path / "state.json"
    telegram = FakeTelegram()
    bot = Bot(telegram, BackendClient(TestClient(app)), state_path=path, allowed_chats={1}, per_minute=100)
    bot.handle_update(file_update(telegram, "a.pdf", make_pdf([TEXT]), chat=1))
    assert path.stat().st_mode & 0o077 == 0


def test_expired_session_tells_the_chat(app, store):
    from tests.test_bot import file_update

    telegram = FakeTelegram()
    bot = Bot(telegram, BackendClient(TestClient(app)), allowed_chats={1}, per_minute=100)
    bot.handle_update(file_update(telegram, "a.pdf", make_pdf([TEXT]), chat=1))
    with store._db() as conn:
        conn.execute("UPDATE sessions SET expires_at = '2000-01-01T00:00:00+00:00'")
    bot.handle_update(text_update("When?", chat=1))
    assert "истекла" in telegram.last
    assert not bot.chat(1)["docs"]
