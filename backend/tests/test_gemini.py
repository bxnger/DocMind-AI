"""GeminiAnswerer against a fake SDK client. No test here talks to the real Gemini API."""

import asyncio
from types import SimpleNamespace

import httpx
import pytest
from google.genai import errors

from app.config import Settings
from app.deps import build_answerer, get_answerer
from app.llm import SYSTEM_PROMPT, LlmMisconfigured, ClaudeAnswerer, Excerpt, LlmAuthFailed, LlmRateLimited, LlmTimeout, LlmUnavailable
from app.llm_gemini import GeminiAnswerer
from tests.conftest import make_pdf, needs_cyrillic_font, upload
from tests.test_chat import ask, conversation_for, ready_document


class FakeStream:
    def __init__(self, pieces, error=None, delay=0.0):
        self.pieces, self.error, self.delay = list(pieces), error, delay
        self.closed = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.pieces:
            return SimpleNamespace(text=self.pieces.pop(0))
        if self.error:
            raise self.error
        raise StopAsyncIteration

    async def aclose(self):
        self.closed = True


class FakeClient:
    def __init__(self, stream=None, error=None):
        self.stream, self.error, self.requests = stream, error, []
        self.aio = SimpleNamespace(models=SimpleNamespace(generate_content_stream=self._generate))

    async def _generate(self, **kwargs):
        self.requests.append(kwargs)
        if self.error:
            raise self.error
        return self.stream


def answerer_for(fake) -> GeminiAnswerer:
    return GeminiAnswerer(model="gemini-test", api_key="unused", client=fake)


EXCERPT = Excerpt(1, "d", "n.pdf", 2, None, "Excerpt text", "Excerpt text")


def collect(answerer, history=()):
    async def run():
        return [p async for p in answerer.stream("Question?", [EXCERPT], None, list(history))]

    return asyncio.run(run())


def api_error(code: int, status: str = "") -> errors.APIError:
    return errors.ClientError(code, {"error": {"code": code, "status": status, "message": "secret detail"}})


def test_streams_pieces_as_they_arrive_and_skips_empty_chunks():
    assert collect(answerer_for(FakeClient(FakeStream(["Hello ", None, "world [1]"])))) == ["Hello ", "world [1]"]


def test_yields_before_the_stream_ends():
    stream = FakeStream(["first", "second"])

    async def run():
        pieces = answerer_for(FakeClient(stream)).stream("Q", [EXCERPT], None, [])
        first = await anext(pieces)
        left = len(stream.pieces)
        await pieces.aclose()
        return first, left

    assert asyncio.run(run()) == ("first", 1)
    assert stream.closed  # closing the answer, as on a client disconnect, closes the provider stream


def test_request_carries_system_prompt_excerpts_and_history():
    fake = FakeClient(FakeStream(["x"]))
    collect(answerer_for(fake), history=[("Earlier?", "Before [1].")])
    request = fake.requests[0]
    assert request["model"] == "gemini-test"
    assert request["config"].system_instruction == SYSTEM_PROMPT
    assert [c["role"] for c in request["contents"]] == ["user", "model", "user"]
    assert "Excerpt text" in request["contents"][-1]["parts"][0]["text"]


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (api_error(429, "RESOURCE_EXHAUSTED"), LlmRateLimited),
        (api_error(401), LlmAuthFailed),
        (api_error(403), LlmAuthFailed),
        (api_error(400, "INVALID_ARGUMENT API_KEY_INVALID"), LlmAuthFailed),
        (api_error(400, "INVALID_ARGUMENT"), LlmUnavailable),
        (errors.ClientError(404, {"error": {"code": 404, "status": "NOT_FOUND", "message": "models/x is not found"}}), LlmMisconfigured),
        (errors.ClientError(404, {"error": {"code": 404, "status": "NOT_FOUND", "message": "Requested entity was not found."}}), LlmUnavailable),
        (errors.ServerError(503, {"error": {"message": "x"}}), LlmUnavailable),
        (errors.ServerError(504, {"error": {"message": "x"}}), LlmTimeout),
        (httpx.ReadTimeout("slow"), LlmTimeout),
        (httpx.ConnectError("down"), LlmUnavailable),
    ],
)
def test_provider_errors_are_translated(error, expected):
    with pytest.raises(expected) as caught:
        collect(answerer_for(FakeClient(error=error)))
    assert type(caught.value) is expected
    assert "secret" not in str(caught.value)


def test_error_during_the_stream_is_translated_and_stream_closed():
    stream = FakeStream(["partial"], error=api_error(429))
    with pytest.raises(LlmRateLimited):
        collect(answerer_for(FakeClient(stream)))
    assert stream.closed


def test_stalled_stream_times_out(monkeypatch):
    monkeypatch.setattr("app.llm_gemini.REQUEST_TIMEOUT_SECONDS", 0.05)
    with pytest.raises(LlmTimeout):
        collect(answerer_for(FakeClient(FakeStream(["x"], delay=1))))


# Provider selection


def settings(provider: str) -> Settings:
    return Settings(llm_provider=provider)


def test_anthropic_is_built_with_its_key():
    assert isinstance(build_answerer(settings("anthropic"), {"ANTHROPIC_API_KEY": "k"}), ClaudeAnswerer)


def test_missing_key_gives_no_answerer():
    assert build_answerer(settings("gemini"), {"ANTHROPIC_API_KEY": "k"}) is None
    assert build_answerer(settings("anthropic"), {"GEMINI_API_KEY": "k"}) is None


def test_gemini_is_built_with_its_key():
    built = build_answerer(settings("gemini"), {"GEMINI_API_KEY": "k"})
    assert isinstance(built, GeminiAnswerer)
    assert built.model == Settings(llm_provider="gemini").gemini_model


def test_unknown_provider_gives_no_answerer():
    assert build_answerer(settings("openai"), {"GEMINI_API_KEY": "k"}) is None


# Through the real chat endpoint, with verification of citations


def use(client, fake):
    client.app.dependency_overrides[get_answerer] = lambda: answerer_for(fake)


def chat(client):
    return conversation_for(client, ready_document(client))


QUESTION = "When does registration close?"


def test_cited_answer_keeps_the_contract(client):
    use(client, FakeClient(FakeStream(["The rule ", "is stated here [1]."])))
    events = ask(client, chat(client), QUESTION)
    names = [name for name, _ in events]
    assert names[0] == "start" and names[-2:] == ["sources", "done"] and set(names[1:-2]) == {"token"}
    assert events[-1][1]["answerStatus"] == "answered"
    source = next(data for name, data in events if name == "sources")["sources"][0]
    assert source["index"] == 1 and source["page"] == 1 and source["quote"]
    assert source["highlights"]


def test_invalid_citation_is_not_found(client):
    use(client, FakeClient(FakeStream(["Made up claim [99]."])))
    events = ask(client, chat(client), QUESTION)
    assert not any(name == "sources" for name, _ in events)
    assert events[-1][1]["answerStatus"] == "not_found"


def test_not_found_reply_sends_no_text(client):
    use(client, FakeClient(FakeStream(["NOT_", "FOUND"])))
    events = ask(client, chat(client), QUESTION)
    assert not any(name == "token" for name, _ in events)
    assert events[-1][1]["answerStatus"] == "not_found"


def test_blocked_answer_with_no_text_is_not_found(client):
    use(client, FakeClient(FakeStream([None])))
    assert ask(client, chat(client), QUESTION)[-1][1]["answerStatus"] == "not_found"


@pytest.mark.parametrize(
    ("error", "code", "retryable"),
    [
        (api_error(429), "RATE_LIMITED", True),
        (api_error(403), "LLM_UNAVAILABLE", False),
        (errors.ServerError(503, {"error": {"message": "x"}}), "LLM_UNAVAILABLE", True),
        (httpx.ReadTimeout("slow"), "LLM_TIMEOUT", True),
    ],
)
def test_errors_end_the_stream_with_an_error_event(client, error, code, retryable):
    use(client, FakeClient(error=error))
    name, data = ask(client, chat(client), QUESTION)[-1]
    assert name == "error"
    assert (data["code"], data["retryable"]) == (code, retryable)
    assert "secret" not in str(data)


@needs_cyrillic_font
@pytest.mark.parametrize(
    ("page", "question", "reply"),
    [
        ("Қызметкерлерге жыл сайын жиырма төрт күн демалыс беріледі.", "Қызметкерлерге қанша күн демалыс беріледі?", "Жиырма төрт күн [1]."),
        ("Сотрудникам ежегодно предоставляется двадцать четыре дня отпуска.", "Сколько дней отпуска предоставляется сотрудникам?", "Двадцать четыре дня [1]."),
    ],
)
def test_russian_and_kazakh_answers_survive_intact(client, page, question, reply):
    use(client, FakeClient(FakeStream([reply[:5], reply[5:]])))
    document = upload(client, "doc.pdf", make_pdf([page])).json()["id"]
    events = ask(client, conversation_for(client, document), question)
    assert "".join(data["text"] for name, data in events if name == "token") == reply
    source = next(data for name, data in events if name == "sources")["sources"][0]
    assert source["quote"] == page




def test_404_log_names_the_model_but_never_the_message_or_key(caplog):
    error = errors.ClientError(404, {"error": {"code": 404, "status": "NOT_FOUND", "message": "models/gemini-test is not found, secret-key-123"}})
    with caplog.at_level("ERROR"), pytest.raises(LlmMisconfigured):
        collect(answerer_for(FakeClient(error=error)))
    assert "model=gemini-test" in caplog.text and "model not found" in caplog.text
    assert "secret" not in caplog.text


def test_missing_model_ends_the_stream_as_non_retryable_error(client):
    error = errors.ClientError(404, {"error": {"code": 404, "status": "NOT_FOUND", "message": "models/x is not found"}})
    use(client, FakeClient(error=error))
    name, data = ask(client, chat(client), QUESTION)[-1]
    assert (name, data["code"], data["retryable"]) == ("error", "LLM_UNAVAILABLE", False)
    assert "models/" not in str(data)


@pytest.mark.parametrize("raw", ["models/gemini-2.5-flash", ' "gemini-2.5-flash" ', "gemini-2.5-flash"])
def test_model_name_copy_paste_leftovers_are_cleaned(monkeypatch, raw):
    monkeypatch.setenv("GEMINI_MODEL", raw)
    import importlib, app.config
    assert importlib.reload(app.config).Settings().gemini_model == "gemini-2.5-flash"
    monkeypatch.delenv("GEMINI_MODEL")
    importlib.reload(app.config)
