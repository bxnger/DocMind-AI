"""Groq as an independent backup: request shape, error mapping, the fallback chain and wiring.

All with a mock transport: these tests say how the backend behaves for given Groq responses, not how Groq performs.
"""

import asyncio
import json

import httpx
import pytest

from app.config import Settings
from app.deps import build_answerer
from app.llm import Excerpt, LlmAuthFailed, LlmMisconfigured, LlmRateLimited, LlmTimeout, LlmUnavailable
from app.llm_gemini import GeminiAnswerer
from app.llm_groq import GroqAnswerer
from app.main import describe_llm
from tests.test_gemini import FakeClient, FakeStream, api_error

EXCERPTS = [Excerpt(1, "d", "n.pdf", 2, None, "Rent is 450 000 KZT.", "Rent is 450 000 KZT.")]


def completion(text: str) -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": text}}]})


def groq(handler) -> GroqAnswerer:
    return GroqAnswerer("llama-test", "secret-key", transport=httpx.MockTransport(handler))


def collect(answerer, history=()) -> list[str]:
    async def run():
        return [piece async for piece in answerer.stream("What is the rent?", EXCERPTS, "en", list(history))]

    return asyncio.run(run())


# --- the request and the answer

def test_request_has_key_in_a_header_the_prompt_history_and_excerpts():
    seen = {}

    def handler(request):
        seen["url"], seen["auth"], seen["body"] = str(request.url), request.headers.get("authorization"), json.loads(request.content)
        return completion("The rent is 450 000 KZT [1].")

    assert collect(groq(handler), history=[("Earlier?", "Earlier answer [1].")]) == ["The rent is 450 000 KZT [1]."]
    assert "secret-key" not in seen["url"] and seen["auth"] == "Bearer secret-key"
    roles = [m["role"] for m in seen["body"]["messages"]]
    assert roles == ["system", "user", "assistant", "user"] and seen["body"]["model"] == "llama-test"
    assert "NOT_FOUND" in seen["body"]["messages"][0]["content"]
    assert "450 000 KZT" in seen["body"]["messages"][-1]["content"]


def test_reasoning_blocks_are_not_part_of_the_answer():
    text = "<think>The user asks about rent, 999 maybe.</think>\nThe rent is 450 000 KZT [1]."
    assert collect(groq(lambda request: completion(text))) == ["The rent is 450 000 KZT [1]."]


def test_an_empty_completion_yields_nothing():
    assert collect(groq(lambda request: completion(""))) == []


# --- errors become the same errors as the other providers

@pytest.mark.parametrize(
    ("status", "error"),
    [(429, LlmRateLimited), (401, LlmAuthFailed), (403, LlmAuthFailed), (404, LlmMisconfigured), (500, LlmUnavailable), (503, LlmUnavailable)],
)
def test_http_errors_map_to_provider_errors(status, error):
    with pytest.raises(error) as raised:
        collect(groq(lambda request: httpx.Response(status, text="secret detail")))
    assert type(raised.value) is error


def test_timeout_connection_and_garbage_become_provider_errors():
    def slow(request):
        raise httpx.ReadTimeout("slow", request=request)

    def down(request):
        raise httpx.ConnectError("down", request=request)

    with pytest.raises(LlmTimeout):
        collect(groq(slow))
    with pytest.raises(LlmUnavailable):
        collect(groq(down))
    with pytest.raises(LlmUnavailable):
        collect(groq(lambda request: httpx.Response(200, text="not json")))
    with pytest.raises(LlmUnavailable):
        collect(groq(lambda request: httpx.Response(200, json={"choices": []})))


def test_translation_never_raises():
    assert asyncio.run(groq(lambda r: completion("Сколько стоит аренда?")).translate_query("How much is rent?", ["Russian"])) == "Сколько стоит аренда?"
    assert asyncio.run(groq(lambda r: httpx.Response(429)).translate_query("How much is rent?", ["Russian"])) is None


# --- the chain: Gemini model, backup Gemini model, Groq

def gemini_with_groq(main, backup, groq_handler) -> GeminiAnswerer:
    return GeminiAnswerer(
        "main",
        "k",
        client=main,
        fallback=GeminiAnswerer("backup", "k", client=backup) if backup is not None else None,
        external=groq(groq_handler),
    )


def never(request):
    raise AssertionError("Groq must not be called")


def test_groq_answers_when_both_gemini_models_are_rate_limited():
    limited = FakeClient(error=api_error(429, "RESOURCE_EXHAUSTED"))
    chain = gemini_with_groq(limited, FakeClient(error=api_error(429, "RESOURCE_EXHAUSTED")), lambda r: completion("From Groq [1]."))
    assert collect(chain) == ["From Groq [1]."]


def test_groq_answers_when_gemini_is_unavailable_503():
    down = FakeClient(error=api_error(503, "UNAVAILABLE"))
    assert collect(gemini_with_groq(down, None, lambda r: completion("From Groq [1]."))) == ["From Groq [1]."]


def test_a_healthy_gemini_never_touches_groq():
    chain = gemini_with_groq(FakeClient(FakeStream(["Gemini [1]."])), None, never)
    assert collect(chain) == ["Gemini [1]."]


def test_groq_is_not_asked_after_text_was_sent():
    broken = FakeClient(FakeStream(["Half "], error=api_error(429, "RESOURCE_EXHAUSTED")))
    chain = gemini_with_groq(broken, None, never)
    got: list[str] = []

    async def run():
        async for piece in chain.stream("Q?", EXCERPTS, None, []):
            got.append(piece)

    with pytest.raises(LlmRateLimited):
        asyncio.run(run())
    assert got == ["Half "]


def test_a_wrong_gemini_key_skips_the_other_gemini_model_but_still_tries_groq():
    bad = FakeClient(error=api_error(403, "PERMISSION_DENIED"))
    backup = FakeClient(FakeStream(["never used"]))
    chain = gemini_with_groq(bad, backup, lambda r: completion("From Groq [1]."))
    assert collect(chain) == ["From Groq [1]."]
    assert backup.requests == []


def test_when_every_link_fails_the_first_error_is_raised():
    """A rate limit stays a retryable rate limit even though the backup then refused our key."""
    chain = gemini_with_groq(
        FakeClient(error=api_error(429, "RESOURCE_EXHAUSTED")), None, lambda r: httpx.Response(401, text="bad key")
    )
    with pytest.raises(LlmRateLimited):
        collect(chain)


def test_translation_falls_through_to_groq():
    from types import SimpleNamespace

    class Limited:
        """A Gemini client whose non-streaming call is rate limited."""

        async def _generate(self, **_):
            raise api_error(429, "RESOURCE_EXHAUSTED")

        def __init__(self):
            self.aio = SimpleNamespace(models=SimpleNamespace(generate_content=self._generate))

    chain = gemini_with_groq(Limited(), None, lambda r: completion("Сколько стоит аренда?"))
    assert asyncio.run(chain.translate_query("How much is rent?", ["Russian"])) == "Сколько стоит аренда?"


# --- wiring

def test_gemini_gets_groq_as_a_backup_only_when_its_key_is_set():
    settings = Settings(llm_provider="gemini")
    with_groq = build_answerer(settings, {"GEMINI_API_KEY": "g", "GROQ_API_KEY": "q"})
    assert isinstance(with_groq.external, GroqAnswerer) and with_groq.external.model == settings.groq_model
    assert build_answerer(settings, {"GEMINI_API_KEY": "g"}).external is None


def test_groq_can_be_the_only_provider():
    settings = Settings(llm_provider="groq")
    assert isinstance(build_answerer(settings, {"GROQ_API_KEY": "q"}), GroqAnswerer)
    assert build_answerer(settings, {}) is None


def test_startup_line_names_the_backup_without_the_key():
    line = describe_llm(Settings(llm_provider="gemini", gemini_model="gemini-3.5-flash-lite", groq_model="llama-x"), {"GEMINI_API_KEY": "g", "GROQ_API_KEY": "sk-secret"})
    assert line.endswith("backup=groq:llama-x") and "sk-secret" not in line
    assert "backup" not in describe_llm(Settings(llm_provider="gemini"), {"GEMINI_API_KEY": "g"})
    assert describe_llm(Settings(llm_provider="groq", groq_model="llama-x"), {}) == "provider=groq model=llama-x key=MISSING"


def test_a_chat_answers_through_groq_when_gemini_is_rate_limited(client):
    """End to end through the API with mocks: Gemini 429 on both models, Groq answers, citations are verified."""
    from app.deps import get_answerer
    from tests.test_chat import ask, conversation_for, ready_document

    limited = FakeClient(error=api_error(429, "RESOURCE_EXHAUSTED"))
    chain = gemini_with_groq(
        limited, FakeClient(error=api_error(429, "RESOURCE_EXHAUSTED")), lambda r: completion("Registration closes on 5 November 2026 [1].")
    )
    client.app.dependency_overrides[get_answerer] = lambda: chain
    document = ready_document(client)
    events = dict(ask(client, conversation_for(client, document), "When does registration close?"))
    assert events["done"]["answerStatus"] == "answered" and events["sources"]["sources"][0]["page"] == 1
