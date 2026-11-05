"""Cross-language search: the question is translated for the SEARCH only; excerpts and quotes stay original."""

import pytest

from app.translate import TranslationCache, clean_translation, query_language, translation_targets
from tests.conftest import FakeAnswerer, needs_cyrillic_font
from tests.test_chat import ask, conversation_for, ready_document

# --- language of a question

def test_query_language_from_script():
    assert query_language("How much is the rent?") == "en"
    assert query_language("Сколько стоит аренда?") == "ru"
    assert query_language("Жалдау ақысы қанша?") == "kk"
    assert query_language("12345 ???") is None


def test_targets_are_the_other_document_languages():
    assert translation_targets("en", ["ru"]) == ["ru"]
    assert translation_targets("ru", ["ru"]) == []
    assert translation_targets("kk", ["ru", "en"]) == ["en", "ru"]
    assert translation_targets("ru", ["mixed"]) == ["en", "kk"]
    assert translation_targets("en", [None]) == []
    assert translation_targets(None, ["ru"]) == []


def test_translation_cache_is_lru_and_holds_questions_only():
    cache = TranslationCache(max_entries=2)
    a, b, c = (cache.key(q, ["ru"]) for q in ("one", "two", "three"))
    cache.put(a, "1")
    cache.put(b, "2")
    cache.get(a)
    cache.put(c, "3")
    assert cache.get(b) is None and cache.get(a) == "1" and cache.get(c) == "3"
    assert cache.key("  Rent  PAID? ", ["ru"]) == cache.key("rent paid?", ["ru"])


# --- through the chat

RUSSIAN_PAGES = ["Арендная плата составляет 450 000 тенге в месяц."] + [
    f"Страница {i} содержит описание садовых работ номер {i}." for i in range(2, 16)
]


class Translating(FakeAnswerer):
    """A scripted model that can also translate the search query."""

    def __init__(self, reply="", translation="Сколько составляет арендная плата?", fail=False):
        super().__init__(reply)
        self.translation, self.fail, self.translate_calls = translation, fail, []

    async def translate_query(self, question, target_languages):
        self.translate_calls.append((question, target_languages))
        if self.fail:
            raise RuntimeError("provider down")
        return self.translation


@pytest.fixture
def translating(client):
    from app.deps import get_answerer

    model = Translating()
    client.app.dependency_overrides[get_answerer] = lambda: model
    return model


@needs_cyrillic_font
def test_english_question_finds_a_russian_page_through_the_translation(client, translating):
    document = ready_document(client, pages=RUSSIAN_PAGES)
    translating.reply = "Арендная плата составляет 450 000 тенге в месяц [1]."

    events = ask(client, conversation_for(client, document), "How much is the monthly rent?")

    assert translating.translate_calls == [("How much is the monthly rent?", ["Russian"])]
    sent = translating.calls[0][1]
    assert sent and "450 000" in sent[0].text  # the ORIGINAL Russian text reached the model, not a translation
    done = dict(events)
    assert done["done"]["answerStatus"] == "answered" and done["sources"]["sources"][0]["page"] == 1
    assert "450 000" in done["sources"]["sources"][0]["quote"]


@needs_cyrillic_font
def test_without_translation_a_large_foreign_document_finds_nothing(client, answerer):
    """The behaviour the translation fixes: no shared words, so a large document is refused without a model call."""
    document = ready_document(client, pages=RUSSIAN_PAGES)
    events = ask(client, conversation_for(client, document), "How much is the monthly rent?")
    assert answerer.calls == [] and dict(events)["done"]["reason"] == "no_matching_excerpt"


@needs_cyrillic_font
def test_a_failed_translation_falls_back_to_the_original_question(client, translating):
    document = ready_document(client, pages=RUSSIAN_PAGES)
    translating.fail = True
    events = ask(client, conversation_for(client, document), "How much is the monthly rent?")
    assert dict(events)["done"]["answerStatus"] == "not_found"  # honest: nothing was found, and the chat did not crash
    assert translating.translate_calls


@needs_cyrillic_font
def test_same_language_question_does_not_call_the_translator(client, translating):
    document = ready_document(client, pages=RUSSIAN_PAGES)
    translating.reply = "Арендная плата составляет 450 000 тенге в месяц [1]."
    ask(client, conversation_for(client, document), "Сколько составляет арендная плата?")
    assert translating.translate_calls == []


@needs_cyrillic_font
def test_overview_questions_do_not_call_the_translator(client, translating):
    document = ready_document(client, pages=RUSSIAN_PAGES)
    translating.reply = "Арендная плата составляет 450 000 тенге в месяц [1]."
    ask(client, conversation_for(client, document), "What is this document about?")
    assert translating.translate_calls == []


# --- not_found says why

def test_model_refusal_and_missing_excerpts_have_different_reasons(client, answerer):
    document = ready_document(client)
    answerer.reply = "NOT_FOUND"
    refused = ask(client, conversation_for(client, document), "quantum chromodynamics")
    assert dict(refused)["done"]["reason"] == "model_refused"

    from tests.test_chat import BIG_DOCUMENT

    large = ready_document(client, pages=BIG_DOCUMENT)
    nothing = ask(client, conversation_for(client, large), "quantum chromodynamics")
    assert dict(nothing)["done"]["reason"] == "no_matching_excerpt"

    answerer.reply = "Registration closes on 5 November 2026."
    uncited = ask(client, conversation_for(client, document), "When does registration close?")
    assert dict(uncited)["done"]["reason"] == "no_citation"


def test_translation_lines_in_the_wrong_script_are_dropped():
    assert clean_translation("Сколько стоит аренда?\nHow much is the rent?", ["ru"]) == "Сколько стоит аренда?"
    assert clean_translation("Stipend qashan tölenedi?\nЖatakhana oryn", ["kk"]) == ""  # Latin and mixed lines are noise
    assert clean_translation("How much is the rent?\n\n12345", ["en"]) == "How much is the rent?"
    assert clean_translation("Сколько?\nHow much?", ["ru", "en"]) == "Сколько?\nHow much?"


def test_a_garbled_translation_leaves_the_search_on_the_original_question():
    import asyncio

    from app.translate import search_translation

    class Garbled:
        async def translate_query(self, question, target_languages):
            return "Stipend qashan tölenedi?"

    translated, targets, _ = asyncio.run(search_translation(Garbled(), "Когда выплачивается стипендия?", ["kk"]))
    assert translated == "" and targets == ["kk"]


# --- the answer follows the question's language, not the document's

def test_the_answer_language_is_named_in_the_prompt():
    from app.llm import Excerpt, build_user_message

    message = build_user_message("Q?", [Excerpt(1, "d", "a.pdf", 1, None, "t", "t")], "en")
    assert "Answer language: English" in message and "even when the excerpts are in another language" in message
    assert "Answer language: Kazakh" in build_user_message("Q?", [], "kk")


def test_without_a_requested_language_the_question_script_decides(client, answerer):
    document = ready_document(client)
    seen = []

    async def stream(question, excerpts, language, history):
        seen.append(language)
        yield "Registration closes on 5 November 2026 [1]."

    answerer.stream = stream
    ask(client, conversation_for(client, document), "When does registration close?")
    ask(client, conversation_for(client, document), "Когда закрывается регистрация?")
    client.post  # a requested language still wins over the script of the question
    response = client.post(
        f"/api/v1/conversations/{conversation_for(client, document)}/messages",
        json={"content": "When does registration close now?", "language": "kk"},
    )
    assert response.status_code == 200
    assert seen == ["en", "ru", "kk"]
