import json

from app.deps import get_answerer
from tests.conftest import make_pdf, upload

ANSWER_TEXT = "Registration closes on 5 November 2026 [1]."
RULES_PAGE_1 = "Registration closes on 5 November 2026."
RULES_PAGE_2 = "Teams may have at most three members."


def ready_document(client, pages=(RULES_PAGE_1, RULES_PAGE_2)) -> str:
    created = upload(client, "rules.pdf", make_pdf(list(pages))).json()
    assert client.get(f"/api/v1/documents/{created['id']}").json()["status"] == "ready"
    return created["id"]


def conversation_for(client, document_id: str) -> str:
    response = client.post("/api/v1/conversations", json={"documentIds": [document_id]})
    assert response.status_code == 201
    return response.json()["id"]


def parse_sse(text: str) -> list[tuple[str, dict]]:
    events = []
    for block in text.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.split("\n"))
        events.append((lines["event"], json.loads(lines["data"])))
    return events


def ask(client, conversation_id: str, content: str):
    response = client.post(f"/api/v1/conversations/{conversation_id}/messages", json={"content": content})
    assert response.status_code == 200
    return parse_sse(response.text)


def test_create_conversation_needs_ready_documents(client):
    created = upload(client, "scan.pdf", make_pdf([""])).json()
    response = client.post("/api/v1/conversations", json={"documentIds": [created["id"]]})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "DOCUMENT_NOT_READY"


def test_create_conversation_rejects_more_than_five_documents(client):
    response = client.post("/api/v1/conversations", json={"documentIds": [str(i) for i in range(6)]})
    assert response.status_code == 422


def test_create_and_get_conversation(client):
    document_id = ready_document(client)
    response = client.post("/api/v1/conversations", json={"documentIds": [document_id], "title": "Rules"})
    assert response.status_code == 201
    body = response.json()
    assert body["title"] == "Rules"
    assert body["documentIds"] == [document_id]
    assert client.get(f"/api/v1/conversations/{body['id']}").json()["id"] == body["id"]


def test_unknown_conversation_is_404(client):
    response = client.get("/api/v1/conversations/nope/messages")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "CONVERSATION_NOT_FOUND"


def test_answer_streams_text_and_verified_source(client, answerer):
    document_id = ready_document(client)
    conversation_id = conversation_for(client, document_id)
    answerer.reply = ANSWER_TEXT

    events = ask(client, conversation_id, "When does registration close?")
    names = [name for name, _ in events]
    assert names[0] == "start"
    assert names[-1] == "done"
    assert "token" in names

    streamed = "".join(data["text"] for name, data in events if name == "token")
    assert streamed == ANSWER_TEXT

    sources = next(data["sources"] for name, data in events if name == "sources")
    assert sources == [
        {
            "index": 1,
            "documentId": document_id,
            "documentName": "rules.pdf",
            "page": 1,
            "location": None,
            "quote": RULES_PAGE_1,
        }
    ]
    done = events[-1][1]
    assert done["answerStatus"] == "answered"


def test_not_found_reply_streams_no_text_and_no_sources(client, answerer):
    document_id = ready_document(client)
    conversation_id = conversation_for(client, document_id)
    answerer.reply = "NOT_FOUND"

    events = ask(client, conversation_id, "What is the capital of France?")
    assert [name for name, _ in events] == ["start", "done"]
    assert events[-1][1]["answerStatus"] == "not_found"


def test_answer_without_valid_citation_is_not_found(client, answerer):
    document_id = ready_document(client)
    conversation_id = conversation_for(client, document_id)
    answerer.reply = "Probably the fifth of November."

    events = ask(client, conversation_id, "When?")
    assert all(name != "sources" for name, _ in events)
    assert events[-1][1]["answerStatus"] == "not_found"


def test_citation_outside_excerpt_range_is_ignored(client, answerer):
    document_id = ready_document(client)
    conversation_id = conversation_for(client, document_id)
    answerer.reply = "Closes on the fifth [9]."

    events = ask(client, conversation_id, "When?")
    assert all(name != "sources" for name, _ in events)
    assert events[-1][1]["answerStatus"] == "not_found"


def test_retrieval_sends_the_relevant_page_to_the_model(client, answerer):
    document_id = ready_document(client)
    conversation_id = conversation_for(client, document_id)
    answerer.reply = "Teams may have at most three members [1]."

    ask(client, conversation_id, "How many members can a team have?")
    _question, excerpts, _language = answerer.calls[0]
    assert excerpts[0].page == 2
    assert excerpts[0].text == RULES_PAGE_2


def test_no_matching_text_skips_the_model(client, answerer):
    document_id = ready_document(client)
    conversation_id = conversation_for(client, document_id)

    events = ask(client, conversation_id, "quantum chromodynamics")
    assert answerer.calls == []
    assert events[-1][1]["answerStatus"] == "not_found"


def test_without_api_key_chat_returns_503(client):
    client.app.dependency_overrides[get_answerer] = lambda: None
    document_id = ready_document(client)
    conversation_id = conversation_for(client, document_id)

    response = client.post(f"/api/v1/conversations/{conversation_id}/messages", json={"content": "Hi"})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "LLM_UNAVAILABLE"


def test_empty_and_long_messages_are_rejected(client):
    document_id = ready_document(client)
    conversation_id = conversation_for(client, document_id)

    empty = client.post(f"/api/v1/conversations/{conversation_id}/messages", json={"content": "   "})
    assert empty.status_code == 422
    assert empty.json()["error"]["code"] == "EMPTY_MESSAGE"

    long = client.post(f"/api/v1/conversations/{conversation_id}/messages", json={"content": "x" * 2001})
    assert long.status_code == 422
    assert long.json()["error"]["code"] == "MESSAGE_TOO_LONG"


def test_messages_are_saved_in_order(client, answerer):
    document_id = ready_document(client)
    conversation_id = conversation_for(client, document_id)
    answerer.reply = ANSWER_TEXT

    ask(client, conversation_id, "When does registration close?")
    items = client.get(f"/api/v1/conversations/{conversation_id}/messages").json()["items"]
    assert [item["role"] for item in items] == ["user", "assistant"]
    assert items[1]["answerStatus"] == "answered"
    assert items[1]["sources"][0]["index"] == 1


def test_delete_conversation(client):
    document_id = ready_document(client)
    conversation_id = conversation_for(client, document_id)
    assert client.delete(f"/api/v1/conversations/{conversation_id}").status_code == 204
    assert client.get(f"/api/v1/conversations/{conversation_id}").status_code == 404


def test_short_follow_up_borrows_the_previous_question_for_retrieval(client, answerer):
    document_id = ready_document(client)
    conversation_id = conversation_for(client, document_id)
    answerer.reply = ANSWER_TEXT
    ask(client, conversation_id, "When does registration close?")

    ask(client, conversation_id, "Where?")
    _question, excerpts, _language = answerer.calls[1]
    assert excerpts[0].page == 1
    assert answerer.histories[1] == [("When does registration close?", ANSWER_TEXT)]


def test_not_found_turns_are_left_out_of_the_history(client, answerer):
    document_id = ready_document(client)
    conversation_id = conversation_for(client, document_id)
    answerer.reply = "NOT_FOUND"
    ask(client, conversation_id, "When does registration close?")

    answerer.reply = ANSWER_TEXT
    ask(client, conversation_id, "When does registration close?")
    assert answerer.histories[1] == []
