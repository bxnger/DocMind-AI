"""Groq (an OpenAI-compatible chat API) as an independent backup when Gemini is out of quota or down.

A different company with its own quota, so a Gemini 429 or 503 does not stop the demo. The answer is requested in one
piece, not streamed: the chat verifies the whole answer before showing any of it, so streaming would gain nothing.
"""

import logging
import re

import httpx

from app.llm import (
    SYSTEM_PROMPT,
    Excerpt,
    History,
    LlmAuthFailed,
    LlmMisconfigured,
    LlmRateLimited,
    LlmTimeout,
    LlmUnavailable,
    build_user_message,
)
from app.translate import translation_prompt

logger = logging.getLogger("app.groq")

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_TIMEOUT_SECONDS = 25.0
MAX_TOKENS = 1024
# Reasoning models put their working in <think>...</think> before the answer; it is not part of the answer.
THINK_BLOCK = re.compile(r"<think>.*?</think>", re.DOTALL)


def _raise_for_status(status: int, model: str) -> None:
    """Maps an HTTP status to the same errors the other providers raise. Never logs a response body."""
    if status < 400:
        return
    logger.warning("Groq API error, status %s model=%s", status, model)
    if status == 429:
        raise LlmRateLimited()
    if status in (401, 403):
        raise LlmAuthFailed()
    if status == 404:
        raise LlmMisconfigured()  # the model name is not available to this key
    raise LlmUnavailable()


class GroqAnswerer:
    """Answers with the same prompt as the other providers. The key goes in a header, never in the URL."""

    def __init__(
        self,
        model: str,
        api_key: str,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout_seconds: float = GROQ_TIMEOUT_SECONDS,
    ) -> None:
        self.model = model
        self.api_key = api_key
        self.transport = transport  # tests pass a mock transport
        self.timeout_seconds = timeout_seconds

    async def _complete(self, messages: list[dict], max_tokens: int, timeout: float) -> str:
        body = {"model": self.model, "messages": messages, "max_tokens": max_tokens, "temperature": 0.2}
        try:
            async with httpx.AsyncClient(timeout=timeout, transport=self.transport) as client:
                response = await client.post(GROQ_URL, json=body, headers={"Authorization": f"Bearer {self.api_key}"})
            _raise_for_status(response.status_code, self.model)
            content = response.json()["choices"][0]["message"]["content"] or ""
        except httpx.TimeoutException as exc:
            raise LlmTimeout() from exc
        except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError) as exc:
            logger.warning("Groq request failed (%s) model=%s", type(exc).__name__, self.model)
            raise LlmUnavailable() from exc
        return THINK_BLOCK.sub("", content).strip()

    async def stream(self, question: str, excerpts: list[Excerpt], language: str | None, history: History):
        messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
        for earlier_question, earlier_answer in history:
            messages.append({"role": "user", "content": earlier_question})
            messages.append({"role": "assistant", "content": earlier_answer})
        messages.append({"role": "user", "content": build_user_message(question, excerpts, language)})
        text = await self._complete(messages, MAX_TOKENS, self.timeout_seconds)
        if text:
            yield text

    async def translate_query(self, question: str, target_languages: list[str], timeout: float = 8.0) -> str | None:
        """The question translated for cross-language search. None on any failure: a search aid must not raise."""
        prompt = translation_prompt(question, target_languages)
        try:
            text = await self._complete([{"role": "user", "content": prompt}], 256, timeout)
        except LlmUnavailable as exc:
            logger.warning("query translation failed on groq (%s)", type(exc).__name__)
            return None
        return text or None
