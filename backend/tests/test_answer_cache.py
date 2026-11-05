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


def test_a_self_contained_question_hits_the_cache_whatever_was_asked_before(client, answerer):
    """A warm-up in a fresh conversation must match the real conversation, which already has a history."""
    document = ready_document(client)
    answerer.reply = ANSWER_TEXT
    ask(client, conversation_for(client, document), QUESTION)  # the warm-up
    real = conversation_for(client, document)
    ask(client, real, "What is the fee?")  # gives the real conversation a history
    calls_before = len(answerer.calls)
    again = ask(client, real, QUESTION)
    assert len(answerer.calls) == calls_before  # answered from the cache
    assert dict(again)["done"]["answerStatus"] == "answered"


def test_a_short_follow_up_depends_on_the_history_so_it_is_not_shared(client, answerer):
    document = ready_document(client)
    answerer.reply = ANSWER_TEXT
    first, second = conversation_for(client, document), conversation_for(client, document)
    ask(client, first, QUESTION)
    ask(client, first, "And when?")  # 2 words: a follow-up of the first question
    ask(client, second, "What is the fee?")
    ask(client, second, "And when?")  # same words, another history: the model must decide again
    assert len(answerer.calls) == 4


def test_cache_evicts_the_least_recently_used():
    cache = AnswerCache(max_entries=2)
    a, b, c = (cache_key(["d"], q, None, []) for q in ("a", "b", "c"))
    cache.put(a, "A", [])
    cache.put(b, "B", [])
    assert cache.get(a).text == "A"  # a is now fresher than b
    cache.put(c, "C", [])
    assert cache.get(b) is None and cache.get(a) and cache.get(c)


def test_a_remembered_answer_skips_the_search_and_the_translation(client, answerer):
    """A cache hit must not spend a translation call: the translation used to run before the cache was looked at."""
    from app.deps import get_answerer

    class Counting(type(answerer)):
        translations = 0

        async def translate_query(self, question, target_languages):
            Counting.translations += 1
            return None

    model = Counting(ANSWER_TEXT)
    client.app.dependency_overrides[get_answerer] = lambda: model
    document = ready_document(client)
    ask(client, conversation_for(client, document), QUESTION)
    after_first = Counting.translations
    ask(client, conversation_for(client, document), QUESTION)
    assert len(model.calls) == 1 and Counting.translations == after_first
