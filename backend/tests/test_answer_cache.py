"""A verified answer is replayed for the same question on the same documents, without asking the model again."""

from app.answer_cache import AnswerCache, cache_key
from tests.test_chat import ANSWER_TEXT, ask, conversation_for, ready_document

QUESTION = "When does registration close?"


def text_of(events) -> str:
    return "".join(data["text"] for name, data in events if name == "token")


def test_repeated_question_is_answered_without_the_model(client, answerer):
    document = ready_document(client)
    answerer.reply = ANSWER_TEXT
    first = ask(client, conversation_for(client, document), QUESTION)
    second = ask(client, conversation_for(client, document), "  when does REGISTRATION close? ")

    assert len(answerer.calls) == 1
    assert text_of(second) == text_of(first) == ANSWER_TEXT
    assert [name for name, _ in second] == ["start", *["token"] * (len(second) - 3), "sources", "done"]
    assert dict(second)["sources"] == dict(first)["sources"] and dict(second)["done"]["answerStatus"] == "answered"


def test_replayed_answer_is_saved_in_the_conversation(client, answerer):
    document = ready_document(client)
    answerer.reply = ANSWER_TEXT
    ask(client, conversation_for(client, document), QUESTION)
    conversation = conversation_for(client, document)
    ask(client, conversation, QUESTION)
    messages = client.get(f"/api/v1/conversations/{conversation}/messages").json()["items"]
    assert [m["role"] for m in messages] == ["user", "assistant"]
    assert messages[1]["content"] == ANSWER_TEXT and messages[1]["answerStatus"] == "answered" and messages[1]["sources"]


def test_other_question_language_or_documents_ask_the_model(client, answerer):
    document, other = ready_document(client), ready_document(client)
    answerer.reply = ANSWER_TEXT
    ask(client, conversation_for(client, document), QUESTION)
    ask(client, conversation_for(client, document), "How many members may a team have?")
    ask(client, conversation_for(client, other), QUESTION)
    assert len(answerer.calls) == 3


def test_not_found_is_never_cached(client, answerer):
    document = ready_document(client)
    answerer.reply = "NOT_FOUND"
    ask(client, conversation_for(client, document), QUESTION)
    answerer.reply = ANSWER_TEXT
    again = ask(client, conversation_for(client, document), QUESTION)
    assert len(answerer.calls) == 2 and dict(again)["done"]["answerStatus"] == "answered"


def test_follow_up_context_is_part_of_the_key(client, answerer):
    document = ready_document(client)
    answerer.reply = ANSWER_TEXT
    conversation = conversation_for(client, document)
    ask(client, conversation, QUESTION)
    ask(client, conversation, QUESTION)  # same words, but now there is history: the model decides
    assert len(answerer.calls) == 2


def test_cache_evicts_the_least_recently_used():
    cache = AnswerCache(max_entries=2)
    a, b, c = (cache_key(["d"], q, None, []) for q in ("a", "b", "c"))
    cache.put(a, "A", [])
    cache.put(b, "B", [])
    assert cache.get(a).text == "A"  # a is now fresher than b
    cache.put(c, "C", [])
    assert cache.get(b) is None and cache.get(a) and cache.get(c)
