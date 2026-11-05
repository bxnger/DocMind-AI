"""Three problems found by the frontend (PR #13): retried questions in the history, DOCX fact quotes that ran across
blocks, and not_found reasons lost after a reload."""

import io
import sqlite3

from docx import Document

from app.llm import LlmRateLimited
from app.store import Store
from tests.conftest import upload
from tests.test_chat import ANSWER_TEXT, BIG_DOCUMENT, ask, conversation_for, ready_document

QUESTION = "When does registration close?"


def messages(client, conversation):
    return client.get(f"/api/v1/conversations/{conversation}/messages").json()["items"]


# --- 1. a retry does not repeat the question

def test_a_failed_attempt_leaves_nothing_in_the_history(client, answerer):
    document = ready_document(client)
    conversation = conversation_for(client, document)
    original = answerer.stream

    async def limited(question, excerpts, language, history):
        raise LlmRateLimited()
        yield  # pragma: no cover

    answerer.stream = limited
    events = ask(client, conversation, QUESTION)
    assert dict(events)["error"]["code"] == "RATE_LIMITED"
    assert messages(client, conversation) == []  # the question was not saved without an answer

    answerer.stream = original
    answerer.reply = ANSWER_TEXT
    ask(client, conversation, QUESTION)  # the retry
    saved = messages(client, conversation)
    assert [m["role"] for m in saved] == ["user", "assistant"] and saved[0]["content"] == QUESTION
    assert answerer.histories[-1] == []  # the model did not see the failed attempt


def test_question_and_answer_are_saved_in_order(client, answerer):
    document = ready_document(client)
    conversation = conversation_for(client, document)
    answerer.reply = ANSWER_TEXT
    ask(client, conversation, QUESTION)
    ask(client, conversation, "How many members may a team have?")
    assert [m["role"] for m in messages(client, conversation)] == ["user", "assistant", "user", "assistant"]


# --- 3. the reason of a not_found survives a reload

def test_not_found_reasons_are_saved(client, answerer):
    document = ready_document(client)
    conversation = conversation_for(client, document)
    answerer.reply = "NOT_FOUND"
    ask(client, conversation, "quantum chromodynamics")
    answerer.reply = ANSWER_TEXT
    ask(client, conversation, QUESTION)
    large = conversation_for(client, ready_document(client, pages=BIG_DOCUMENT))
    ask(client, large, "quantum chromodynamics")

    first = [m for m in messages(client, conversation) if m["role"] == "assistant"]
    assert first[0]["answerStatus"] == "not_found" and first[0]["reason"] == "model_refused"
    assert first[1]["answerStatus"] == "answered" and first[1]["reason"] is None
    assert messages(client, large)[-1]["reason"] == "no_matching_excerpt"


def test_an_old_database_gets_the_reason_column(tmp_path):
    with sqlite3.connect(tmp_path / "app.db") as conn:
        conn.execute(
            "CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL,"
            " content TEXT NOT NULL, answer_status TEXT, sources_json TEXT, created_at TEXT NOT NULL)"
        )
        conn.execute("INSERT INTO messages VALUES ('m1', 'c1', 'assistant', '', 'not_found', NULL, 'now')")
    Store(tmp_path)  # opening it migrates
    with sqlite3.connect(tmp_path / "app.db") as conn:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(messages)")}
        old = conn.execute("SELECT reason FROM messages WHERE id = 'm1'").fetchone()
    assert "reason" in columns and old == (None,)


# --- 2. a DOCX fact quote stays inside one block

def docx_with_heading_and_table() -> bytes:
    doc = Document()
    doc.add_heading("Сроки оплаты", level=1)  # no full stop: it used to run into the next paragraph
    doc.add_paragraph("Оплата вносится не позднее 5 ноября 2026 года.")
    table = doc.add_table(rows=2, cols=2)
    table.cell(0, 0).text, table.cell(0, 1).text = "Аванс", "30%"
    table.cell(1, 0).text, table.cell(1, 1).text = "Остаток", "70%"
    buffer = io.BytesIO()
    doc.save(buffer)
    return buffer.getvalue()


def test_docx_fact_quotes_are_one_block_and_point_to_it(client):
    created = upload(client, "terms.docx", docx_with_heading_and_table()).json()
    facts = client.get(f"/api/v1/documents/{created['id']}/facts").json()["facts"]
    blocks = client.get(f"/api/v1/documents/{created['id']}/text").json()["blocks"]

    deadline = next(f for f in facts if f["kind"] == "deadline")
    assert deadline["quote"] == "Оплата вносится не позднее 5 ноября 2026 года."  # no heading in front
    percents = sorted(f["quote"] for f in facts if f["kind"] == "percent")
    assert percents == ["Аванс | 30%", "Остаток | 70%"]  # one table row each, not both rows together
    for fact in facts:
        block = blocks[fact["paragraph"]]
        assert fact["quote"] in block["text"] and fact["location"] == "Сроки оплаты" and fact["page"] is None


def test_pdf_facts_have_no_paragraph_field(client):
    document = ready_document(client, pages=("The fee is 500 USD.",))
    facts = client.get(f"/api/v1/documents/{document}/facts").json()["facts"]
    assert facts and all("paragraph" not in fact for fact in facts)
