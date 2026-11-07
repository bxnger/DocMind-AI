"""Check a statement against the documents: POST /conversations/{id}/verify."""

import pytest

from app.routers.claims import parse_verdict
from tests.test_chat import conversation_for, ready_document


def verify(client, conversation_id: str, claim: str, **extra):
    return client.post(f"/api/v1/conversations/{conversation_id}/verify", json={"claim": claim, **extra})


@pytest.fixture
def conversation(client):
    return conversation_for(client, ready_document(client))


def test_a_statement_the_document_confirms_is_supported_with_its_quote(client, answerer, conversation):
    answerer.reply = "SUPPORTED\nRegistration closes on 5 November 2026 [1]."
    body = verify(client, conversation, "Registration closes on 5 November 2026").json()
    assert body["verdict"] == "supported"
    assert body["explanation"] == "Registration closes on 5 November 2026 [1]."
    assert [(s["index"], s["page"], s["quote"]) for s in body["sources"]] == [(1, 1, "Registration closes on 5 November 2026.")]
    # the model is told what to decide, and the statement is the last thing it reads
    question, excerpts, _language = answerer.calls[-1]
    assert question.endswith("Statement: Registration closes on 5 November 2026") and excerpts


def test_a_different_value_is_contradicted(client, answerer, conversation):
    # The explanation names the value of the document, not the wrong one from the statement: a number the sources do
    # not contain would make the sentence fail the check (that is the point of the check).
    answerer.reply = "CONTRADICTED\nThe document says registration closes on 5 November 2026 [1]."
    body = verify(client, conversation, "Registration closes on 3 February 2026").json()
    assert body["verdict"] == "contradicted" and body["sources"][0]["page"] == 1

    answerer.reply = "CONTRADICTED\nRegistration closes on 5 November 2026, not on 3 February [1]."
    assert verify(client, conversation, "Registration closes on 3 February 2026").json()["verdict"] == "not_found"


def test_a_part_that_is_right_and_a_part_that_is_not_is_partly(client, answerer, conversation):
    answerer.reply = "PARTLY\nRegistration closes on 5 November 2026 [1]."
    assert verify(client, conversation, "Registration closes on 5 November and teams have 10 members").json()["verdict"] == "partly"


def test_a_statement_the_document_does_not_cover_is_not_found(client, answerer, conversation):
    answerer.reply = "NOT_FOUND"
    body = verify(client, conversation, "Registration closes on 5 November 2026").json()
    assert body == {"verdict": "not_found", "explanation": "", "sources": [], "reason": "model_refused"}


def test_a_verdict_without_a_verifiable_quote_is_not_shown_as_proven(client, answerer, conversation):
    """The model says SUPPORTED but invents the number: the explanation does not survive the check, so no proof is shown."""
    answerer.reply = "SUPPORTED\nRegistration closes on 9 December 2031 [1]."
    body = verify(client, conversation, "Registration closes in December").json()
    assert body["verdict"] == "not_found" and body["sources"] == [] and body["reason"] == "citations_failed_verification"


def test_an_unclear_reply_is_not_found(client, answerer, conversation):
    answerer.reply = "I think it is probably true."
    assert verify(client, conversation, "Registration closes on 5 November 2026").json()["verdict"] == "not_found"


def test_a_large_document_with_nothing_about_it_makes_no_model_call(client, answerer):
    pages = [f"Section {n} describes the order of work of the team and the approval times." for n in range(1, 30)]
    conversation = conversation_for(client, ready_document(client, pages))
    body = verify(client, conversation, "Zebra quantum xylophone").json()
    assert body["verdict"] == "not_found" and body["reason"] == "no_matching_excerpt" and answerer.calls == []


def test_empty_and_too_long_statements_and_other_guests_are_refused(client, answerer, conversation):
    assert verify(client, conversation, "   ").status_code == 422
    assert verify(client, conversation, "x" * 1001).status_code == 422
    assert client.post("/api/v1/conversations/nope/verify", json={"claim": "x"}).status_code == 404
    other = client.__class__(client.app)
    other.headers["Authorization"] = "Bearer " + other.post("/api/v1/sessions").json()["token"]
    assert other.post(f"/api/v1/conversations/{conversation}/verify", json={"claim": "Registration closes"}).status_code == 404


def test_the_ai_budget_counts_a_check_and_a_stopped_ai_refuses(client, answerer, conversation):
    client.app.state.settings = client.app.state.settings.__class__(**{**client.app.state.settings.__dict__, "ai_emergency_stop": True})
    response = verify(client, conversation, "Registration closes on 5 November 2026")
    assert response.status_code == 429 and response.json()["error"]["code"] == "AI_BUDGET_EXCEEDED"


def test_parse_verdict():
    assert parse_verdict("supported\nok [1]") == ("supported", "ok [1]")
    assert parse_verdict("**CONTRADICTED**: it differs [2]") == ("contradicted", "it differs [2]")
    assert parse_verdict("NOT_FOUND") == ("not_found", "")
    assert parse_verdict("Maybe") == ("not_found", "")
