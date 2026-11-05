"""Switching to the second Gemini model when the first is rate limited or too slow, before any text."""

import pytest

from app.config import Settings
from app.deps import build_answerer, fallback_model
from app.llm import LlmRateLimited, LlmTimeout, LlmUnavailable
from app.llm_gemini import GeminiAnswerer
from tests.test_gemini import FakeClient, FakeStream, api_error, collect


def pair(primary_client, fallback_client) -> GeminiAnswerer:
    return GeminiAnswerer("main", "k", client=primary_client, fallback=GeminiAnswerer("backup", "k", client=fallback_client))


def test_rate_limited_main_model_falls_back():
    main, backup = FakeClient(error=api_error(429, "RESOURCE_EXHAUSTED")), FakeClient(FakeStream(["From backup [1]."]))
    assert collect(pair(main, backup)) == ["From backup [1]."]
    assert len(main.requests) == 1 and len(backup.requests) == 1


def test_slow_main_model_falls_back(monkeypatch):
    monkeypatch.setattr("app.llm_gemini.REQUEST_TIMEOUT_SECONDS", 0.1)
    slow = FakeClient(FakeStream(["never"], delay=5))
    assert collect(pair(slow, FakeClient(FakeStream(["Quick [1]."])))) == ["Quick [1]."]


def test_healthy_main_model_does_not_touch_the_backup():
    backup = FakeClient(FakeStream(["x"]))
    assert collect(pair(FakeClient(FakeStream(["Main [1]."])), backup)) == ["Main [1]."]
    assert backup.requests == []


def test_no_fallback_after_text_was_sent():
    main = FakeClient(FakeStream(["Half "], error=api_error(429, "RESOURCE_EXHAUSTED")))
    backup = FakeClient(FakeStream(["x"]))
    got = []
    with pytest.raises(LlmRateLimited):
        got = collect_partial(pair(main, backup), got)
    assert got == ["Half "] and backup.requests == []


def collect_partial(answerer, got):
    import asyncio

    async def run():
        async for piece in answerer.stream("Question?", [], None, []):
            got.append(piece)

    asyncio.run(run())


def test_both_models_failing_reports_the_last_error():
    both = pair(FakeClient(error=api_error(429, "RESOURCE_EXHAUSTED")), FakeClient(error=api_error(429, "RESOURCE_EXHAUSTED")))
    with pytest.raises(LlmRateLimited):
        collect(both)


def test_a_wrong_key_does_not_fall_back():
    backup = FakeClient(FakeStream(["x"]))
    with pytest.raises(LlmUnavailable):
        collect(pair(FakeClient(error=api_error(403, "PERMISSION_DENIED")), backup))
    assert backup.requests == []


def test_fallback_model_choice():
    assert fallback_model(Settings(gemini_model="gemini-3.5-flash-lite", gemini_fallback_model="")) == "gemini-3.5-flash"
    assert fallback_model(Settings(gemini_model="gemini-3.5-flash", gemini_fallback_model="")) == "gemini-3.5-flash-lite"
    assert fallback_model(Settings(gemini_model="a", gemini_fallback_model="off")) == ""
    assert fallback_model(Settings(gemini_model="a", gemini_fallback_model="a")) == ""
    assert fallback_model(Settings(gemini_model="a", gemini_fallback_model="b")) == "b"


def test_gemini_provider_builds_a_fallback_answerer_unless_off():
    env = {"GEMINI_API_KEY": "k"}
    assert build_answerer(Settings(llm_provider="gemini"), env).fallback is not None
    assert build_answerer(Settings(llm_provider="gemini", gemini_fallback_model="off"), env).fallback is None


def test_each_event_loop_gets_its_own_provider_client():
    """The SDK client is bound to the loop it ran in: reusing it in a second loop failed every other request."""
    import asyncio

    answerer = GeminiAnswerer("main", "k")

    async def clients():
        return answerer.client, answerer.client

    first_a, first_b = asyncio.run(clients())
    second_a, _ = asyncio.run(clients())
    assert first_a is first_b and first_a is not second_a
