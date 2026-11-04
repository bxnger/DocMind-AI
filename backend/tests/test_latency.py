"""Timeouts and timing logs: where a slow answer stalls, and what is sent, without logging any text."""

import asyncio
import logging
from types import SimpleNamespace

import pytest
from google.genai import types

from app.config import Settings
from app.deps import build_answerer
from app.llm import Excerpt, LlmTimeout
from app.llm_gemini import THINKING_LEVELS, GeminiAnswerer
from tests.conftest import FakeAnswerer
from tests.test_chat import ask, conversation_for, ready_document
from tests.test_gemini import FakeClient, FakeStream, answerer_for, collect

EXCERPT = Excerpt(1, "d", "n.pdf", 2, None, "Excerpt text", "Excerpt text")


class SlowOpen:
    """The API never answers the request."""

    def __init__(self):
        self.aio = SimpleNamespace(models=SimpleNamespace(generate_content_stream=self._generate))

    async def _generate(self, **_):
        await asyncio.sleep(5)


class Silent(FakeStream):
    """Chunks arrive but carry no text, as when a model is still thinking, then it stalls."""

    def __init__(self, texts):
        super().__init__([])
        self.texts = list(texts)

    async def __anext__(self):
        if self.texts:
            return SimpleNamespace(text=self.texts.pop(0), candidates=[], prompt_feedback=None, usage_metadata=None)
        await asyncio.sleep(5)


def timed_out(client, caplog) -> str:
    with caplog.at_level(logging.INFO, logger="app.gemini"), pytest.raises(LlmTimeout):
        collect(answerer_for(client))
    return caplog.text


@pytest.fixture(autouse=True)
def short_deadline(monkeypatch):
    monkeypatch.setattr("app.llm_gemini.REQUEST_TIMEOUT_SECONDS", 0.15)


def test_timeout_while_waiting_for_the_response_is_labelled_open(caplog):
    assert "failed_at=timeout_open" in timed_out(SlowOpen(), caplog)


def test_timeout_after_chunks_without_text_is_labelled_first_token(caplog):
    assert "failed_at=timeout_first_token" in timed_out(FakeClient(Silent([None, None])), caplog)


def test_timeout_before_any_chunk_is_labelled_first_chunk(caplog):
    assert "failed_at=timeout_first_chunk" in timed_out(FakeClient(Silent([])), caplog)


def test_timeout_after_text_is_labelled_stream(caplog):
    assert "failed_at=timeout_stream" in timed_out(FakeClient(Silent(["Some text"])), caplog)


def test_finished_request_logs_timings_and_size_but_no_text(caplog):
    with caplog.at_level(logging.INFO, logger="app.gemini"):
        collect(answerer_for(FakeClient(FakeStream(["Visible answer [1]."]))))
    line = caplog.text
    for field in ("open_ms=", "first_chunk_ms=", "first_token_ms=", "total_ms=", "prompt_chars=", "thinking=default"):
        assert field in line
    assert "failed_at" not in line and "Visible answer" not in line and "Excerpt text" not in line


def test_prompt_chars_counts_what_is_sent(caplog):
    with caplog.at_level(logging.INFO, logger="app.gemini"):
        collect(answerer_for(FakeClient(FakeStream(["x"]))), history=[("Earlier question?", "Earlier answer [1].")])
    from app.llm import SYSTEM_PROMPT, build_user_message

    expected = len(SYSTEM_PROMPT) + len("Earlier question?") + len("Earlier answer [1].") + len(build_user_message("Question?", [EXCERPT], None))
    assert f"prompt_chars={expected}" in caplog.text


# --- thinking setting


def request_config(thinking_level):
    fake = FakeClient(FakeStream(["x"]))
    collect(GeminiAnswerer(model="m", api_key="unused", client=fake, thinking_level=thinking_level))
    return fake.requests[0]["config"]


def test_no_thinking_setting_leaves_the_model_default():
    config = request_config(None)
    assert config.thinking_config is None


@pytest.mark.parametrize("level", THINKING_LEVELS)
def test_thinking_level_reaches_the_sdk_config(level):
    config = request_config(level)
    assert config.thinking_config.thinking_level == types.ThinkingLevel(level.upper())


def test_thinking_level_is_logged(caplog):
    with caplog.at_level(logging.INFO, logger="app.gemini"):
        collect(GeminiAnswerer(model="m", api_key="unused", client=FakeClient(FakeStream(["x"])), thinking_level="low"))
    assert "thinking=low" in caplog.text


def test_environment_selects_the_thinking_level():
    built = build_answerer(Settings(llm_provider="gemini", gemini_thinking_level="minimal"), {"GEMINI_API_KEY": "k"})
    assert built.thinking_level == "minimal"
    assert build_answerer(Settings(llm_provider="gemini"), {"GEMINI_API_KEY": "k"}).thinking_level is None


def test_unknown_thinking_level_is_ignored_and_reported(caplog):
    with caplog.at_level(logging.ERROR, logger="app.deps"):
        built = build_answerer(Settings(llm_provider="gemini", gemini_thinking_level="turbo"), {"GEMINI_API_KEY": "k"})
    assert built.thinking_level is None and "GEMINI_THINKING_LEVEL" in caplog.text


def test_all_thinking_levels_exist_in_the_sdk():
    assert {level.name.lower() for level in types.ThinkingLevel} >= set(THINKING_LEVELS)


# --- the chat log separates retrieval from model time


def test_chat_log_reports_prep_and_first_token_times(client, answerer, caplog):
    answerer.reply = "Registration closes on 5 November 2026 [1]."
    with caplog.at_level(logging.INFO, logger="app.chat"):
        ask(client, conversation_for(client, ready_document(client)), "When does registration close?")
    assert "prep_ms=" in caplog.text and "chunks=2" in caplog.text and "first_token_ms=" in caplog.text
    assert "first_token_ms=none" not in caplog.text
    assert "Registration closes" not in caplog.text


def test_chat_log_has_no_first_token_when_the_model_errors(client, caplog):
    from app.deps import get_answerer
    from app.llm import LlmTimeout as Timeout

    class Failing(FakeAnswerer):
        async def stream(self, *args):
            raise Timeout()
            yield ""

    client.app.dependency_overrides[get_answerer] = lambda: Failing()
    with caplog.at_level(logging.INFO, logger="app.chat"):
        ask(client, conversation_for(client, ready_document(client)), "When does registration close?")
    assert "chat error" in caplog.text and "first_token_ms=none" in caplog.text and "LLM_TIMEOUT" in caplog.text
