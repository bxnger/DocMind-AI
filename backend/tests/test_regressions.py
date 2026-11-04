"""Regressions from real Gemini use: unjustified not_found, [1, 2] citations, and flaky provider errors."""

import asyncio
import logging

import httpx
import pytest
from google.genai import errors

from app.config import Settings
from app.deps import get_answerer
from app.llm import Excerpt, LlmUnavailable, build_user_message
from app.llm_gemini import GeminiAnswerer
from app.main import describe_llm
from app.retrieval import content_words, is_overview_question, overview_chunks, rank
from app.routers.conversations import cited_numbers, normalize_markers, verified_sources
from tests.conftest import make_pdf, upload
from tests.test_chat import ask, conversation_for, ready_document
from tests.test_gemini import FakeClient, FakeStream, answerer_for, api_error, collect


# --- retrieval: overview questions


@pytest.mark.parametrize(
    "question",
    [
        "О чём этот документ?",
        "О чем этот документ",
        "What is this document about?",
        "Summarize the document",
        "Бұл құжат не туралы?",
        "Расскажи кратко про файл",
    ],
)
def test_generic_questions_are_overview_questions(question):
    assert is_overview_question(question)


@pytest.mark.parametrize("question", ["Как называется урок 15?", "When does registration close?", "Срок оплаты счёта", "15", "Үш адам"])
def test_topical_questions_are_not_overview(question):
    assert not is_overview_question(question)


def test_empty_or_punctuation_question_is_not_overview():
    assert not is_overview_question("???")


def test_lesson_question_still_finds_the_lesson():
    chunks = ["Урок 15. Основы алгебры. В этом уроке изучаются уравнения.", "Урок 14. Геометрия.", "Содержание курса."]
    hits = rank("Как называется урок 15?", chunks, 5)
    assert hits and hits[0][0] == 0
    assert content_words("Как называется урок 15?") == ["называется", "урок", "15"]


def chunk(doc: str, n: int) -> dict:
    return {"documentId": doc, "text": f"{doc}-{n}"}


def test_overview_sample_starts_at_the_beginning_and_spreads():
    chunks = [chunk("a", n) for n in range(20)]
    picked = overview_chunks(chunks, 5)
    assert picked[0] == chunks[0] and picked[-1] == chunks[-1] and len(picked) == 5
    assert [c["text"] for c in picked] == sorted({c["text"] for c in picked}, key=lambda t: int(t.split("-")[1]))


def test_overview_sample_covers_every_document():
    chunks = [chunk("a", n) for n in range(10)] + [chunk("b", n) for n in range(10)] + [chunk("c", n) for n in range(3)]
    assert {c["documentId"] for c in overview_chunks(chunks, 5)} == {"a", "b", "c"}


def test_small_documents_are_sent_whole():
    chunks = [chunk("a", n) for n in range(3)]
    assert overview_chunks(chunks, 5) == chunks


# --- citations


@pytest.mark.parametrize(
    ("text", "expected"),
    [("A [1].", {1}), ("A [1, 2].", {1, 2}), ("A [1,3] B [2].", {1, 2, 3}), ("A [1; 2]", {1, 2}), ("no marker", set()), ("[abc] [ ] [1-3]", set())],
)
def test_cited_numbers(text, expected):
    assert cited_numbers(text) == expected


def test_saved_markers_are_single_and_linkable():
    assert normalize_markers("A [1, 2]. B [3].") == "A [1][2]. B [3]."


def test_grouped_citation_still_verifies_each_source(client, store):
    document = upload(client, "d.pdf", make_pdf(["Registration closes on 5 November 2026.", "Teams may have at most three members."])).json()["id"]
    excerpts = [
        Excerpt(1, document, "d.pdf", 1, None, "Registration closes on 5 November 2026.", "Registration closes on 5 November 2026."),
        Excerpt(2, document, "d.pdf", 2, None, "Teams may have at most three members.", "Teams may have at most three members."),
    ]
    sources = verified_sources("Both facts apply [1, 2].", excerpts, store, "registration teams")
    assert [s["index"] for s in sources] == [1, 2] and all(s["highlights"] for s in sources)


def test_prompt_asks_for_one_bracket_per_excerpt():
    from app.llm import SYSTEM_PROMPT

    assert "never [1, 3]" in SYSTEM_PROMPT


def test_sampled_excerpts_get_an_honest_note():
    sampled = Excerpt(1, "d", "n", 1, None, "t", "t", sampled=True)
    assert "sample" in build_user_message("What is this?", [sampled], None)
    plain = Excerpt(1, "d", "n", 1, None, "t", "t")
    assert "sample" not in build_user_message("What is this?", [plain], None)


# --- the chat endpoint


def chat_with(client, reply):
    client.app.dependency_overrides[get_answerer] = lambda: answerer_for(FakeClient(FakeStream(reply)))
    return conversation_for(client, ready_document(client))


def test_overview_question_reaches_the_model_with_sampled_excerpts(client, answerer):
    answerer.reply = "The document is about registration [1] and teams [2]."
    conversation = conversation_for(client, ready_document(client))
    events = ask(client, conversation, "О чём этот документ?")
    assert len(answerer.calls) == 1 and all(e.sampled for e in answerer.calls[0][1])
    assert events[-1][1]["answerStatus"] == "answered"
    sources = next(data for name, data in events if name == "sources")["sources"]
    assert {s["page"] for s in sources} == {1, 2} and all(s["quote"] for s in sources)


def test_overview_answer_without_valid_citation_is_still_not_found(client, answerer):
    answerer.reply = "It is about many things."
    events = ask(client, conversation_for(client, ready_document(client)), "What is this document about?")
    assert events[-1][1]["answerStatus"] == "not_found" and not any(n == "sources" for n, _ in events)


def test_specific_question_with_no_match_still_skips_the_model(client, answerer):
    events = ask(client, conversation_for(client, ready_document(client)), "quantum chromodynamics lagrangian")
    assert answerer.calls == [] and events[-1][1]["answerStatus"] == "not_found"


def test_grouped_citations_from_gemini_are_answered_and_saved_linkable(client):
    conversation = chat_with(client, ["Both apply [1, 2]."])
    events = ask(client, conversation, "О чём этот документ?")
    assert events[-1][1]["answerStatus"] == "answered"
    saved = client.get(f"/api/v1/conversations/{conversation}/messages").json()["items"][-1]
    assert saved["content"] == "Both apply [1][2]."


# --- diagnostics never contain content


def test_logs_explain_not_found_without_content(client, answerer, caplog):
    answerer.reply = "Secret reply text with no citation."
    with caplog.at_level(logging.INFO, logger="app"):
        conversation = conversation_for(client, ready_document(client))
        ask(client, conversation, "О чём этот документ?")
        ask(client, conversation, "SECRETQUESTION zzz")
    assert "reason=no_citation" in caplog.text and "mode=overview" in caplog.text
    assert "reason=no_matching_excerpt" in caplog.text
    for secret in ("Secret reply", "SECRETQUESTION", "Registration closes"):
        assert secret not in caplog.text


def test_startup_line_names_model_and_key_state_only():
    line = describe_llm(Settings(llm_provider="gemini", gemini_model="gemini-3.5-flash-lite"), {"GEMINI_API_KEY": "sk-secret"})
    assert line == "provider=gemini model=gemini-3.5-flash-lite thinking=default key=set"
    assert "MISSING" in describe_llm(Settings(llm_provider="gemini"), {})
    assert "sk-secret" not in line


def test_gemini_log_reports_serving_model_and_token_counts(caplog):
    from types import SimpleNamespace as NS

    chunk = NS(text="ok [1]", model_version="gemini-3.5-flash-lite", candidates=[NS(finish_reason="STOP")],
               prompt_feedback=None, usage_metadata=NS(prompt_token_count=10, candidates_token_count=3, thoughts_token_count=7))
    stream = FakeStream([])
    stream.pieces = [chunk.text]
    class Rich(FakeStream):
        async def __anext__(self):
            if self.pieces:
                self.pieces.pop(0)
                return chunk
            raise StopAsyncIteration
    with caplog.at_level(logging.INFO, logger="app.gemini"):
        collect(answerer_for(FakeClient(Rich(["x"]))))
    assert "served_by=gemini-3.5-flash-lite" in caplog.text and "thought_tokens=7" in caplog.text and "finish=STOP" in caplog.text
    assert "ok [1]" not in caplog.text


# --- provider errors


class Flaky:
    """Fails with `errors_first` before it produces a stream."""

    def __init__(self, failures, stream):
        self.failures, self.stream, self.calls = list(failures), stream, 0
        from types import SimpleNamespace

        self.aio = SimpleNamespace(models=SimpleNamespace(generate_content_stream=self._generate))

    async def _generate(self, **_):
        self.calls += 1
        if self.failures:
            raise self.failures.pop(0)
        return self.stream


def server_error(code=503):
    return errors.ServerError(code, {"error": {"code": code, "status": "UNAVAILABLE", "message": "high demand"}})


def test_brief_503_before_the_first_token_is_retried():
    flaky = Flaky([server_error(), server_error()], FakeStream(["Hi [1]."]))
    assert collect(answerer_for(flaky)) == ["Hi [1]."] and flaky.calls == 3


def test_connection_errors_before_the_first_token_are_retried():
    flaky = Flaky([httpx.ConnectError("down")], FakeStream(["Hi [1]."]))
    assert collect(answerer_for(flaky)) == ["Hi [1]."] and flaky.calls == 2


def test_persistent_503_ends_as_unavailable_after_three_attempts():
    flaky = Flaky([server_error()] * 5, FakeStream([]))
    with pytest.raises(LlmUnavailable):
        collect(answerer_for(flaky))
    assert flaky.calls == 3


@pytest.mark.parametrize("error", [api_error(429, "RESOURCE_EXHAUSTED"), api_error(403), api_error(400, "INVALID_ARGUMENT")])
def test_quota_auth_and_bad_request_errors_are_not_retried(error):
    flaky = Flaky([error], FakeStream(["x"]))
    with pytest.raises(LlmUnavailable):
        collect(answerer_for(flaky))
    assert flaky.calls == 1


def test_failure_after_text_was_sent_is_not_retried():
    stream = FakeStream(["Partial "], error=server_error())
    flaky = Flaky([], stream)
    seen = []

    async def run():
        async for piece in answerer_for(flaky).stream("Q", [Excerpt(1, "d", "n", 1, None, "t", "t")], None, []):
            seen.append(piece)

    with pytest.raises(LlmUnavailable):
        asyncio.run(run())
    assert seen == ["Partial "] and flaky.calls == 1


def test_unexpected_exception_type_is_unavailable_and_logged_by_type_only(caplog):
    class Weird(FakeStream):
        async def __anext__(self):
            raise KeyError("document text must not be logged")

    with caplog.at_level(logging.ERROR, logger="app.gemini"), pytest.raises(LlmUnavailable):
        collect(answerer_for(FakeClient(Weird([]))))
    assert "KeyError" in caplog.text and "document text" not in caplog.text
