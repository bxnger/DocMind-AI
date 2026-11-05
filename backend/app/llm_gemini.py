import asyncio
import logging
import time
import weakref
from collections.abc import AsyncIterator

import httpx
from google import genai
from google.genai import errors, types

from app.llm import (
    REQUEST_TIMEOUT_SECONDS,
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

logger = logging.getLogger("app.gemini")

# Newer Gemini models can spend part of this limit on internal reasoning before the visible answer.
MAX_OUTPUT_TOKENS = 4096
GATEWAY_TIMEOUT = 504
# A failure before the first token is retried, because 500/503 ("high demand") from Gemini are brief.
# Accepted by the SDK's ThinkingConfig for Gemini 3.x. Which levels a model supports differs (see the docs).
THINKING_LEVELS = ("minimal", "low", "medium", "high")
# With a backup model the main one gets less time, so a stalled request moves on early.
PRIMARY_BUDGET_SECONDS = 25.0
MAX_ATTEMPTS = 3
RETRY_DELAY_SECONDS = 0.7
TRANSIENT_NETWORK_ERRORS = (httpx.ConnectError, httpx.ConnectTimeout, httpx.RemoteProtocolError, httpx.ReadError)


def classify_not_found(exc: errors.APIError) -> str:
    """Says what a 404 refers to, without exposing the provider's message to anyone."""
    text = str(exc.message or "").lower()
    if "model" in text:
        return "model"  # models/<name> is not found for this API version or this key
    return "endpoint"


def _translate(exc: errors.APIError, model: str) -> LlmUnavailable:
    # Status, model name and the kind of 404 go to the log. Messages, responses and keys never do.
    if exc.code == 404:
        kind = classify_not_found(exc)
        logger.error(
            "Gemini API error, status 404 (%s not found), model=%s. Run `python eval/gemini_diagnose.py`"
            " to list the models this key can use",
            kind,
            model,
        )
        return LlmMisconfigured() if kind == "model" else LlmUnavailable()
    logger.warning("Gemini API error, status %s %s model=%s", exc.code, exc.status or "", model)
    if exc.code == 429:
        return LlmRateLimited()
    if exc.code in (401, 403):
        return LlmAuthFailed()
    if exc.code == 400 and "API_KEY" in str(exc.status or "") + str(exc.message or ""):
        return LlmAuthFailed()  # Gemini reports an invalid key as 400 API_KEY_INVALID.
    if exc.code == GATEWAY_TIMEOUT:
        return LlmTimeout()
    return LlmUnavailable()


def _is_transient(exc: Exception) -> bool:
    if isinstance(exc, errors.ServerError):
        return exc.code in (500, 502, 503)
    return isinstance(exc, TRANSIENT_NETWORK_ERRORS)


class _Report:
    """Timing and size facts about one request. Counts, names and milliseconds only, never text."""

    def __init__(self, prompt_chars: int) -> None:
        self.prompt_chars = prompt_chars
        self.begun = time.monotonic()
        self.opened_at: float | None = None
        self.first_chunk_at: float | None = None
        self.first_token_at: float | None = None
        self.chunks = 0
        self.chars = 0
        self.finish_reason = None
        self.block_reason = None
        self.served_by = None
        self.prompt_tokens = self.output_tokens = self.thought_tokens = None

    def opened(self) -> None:
        self.opened_at = time.monotonic()

    def see(self, chunk: object) -> None:
        self.chunks += 1
        self.first_chunk_at = self.first_chunk_at or time.monotonic()
        self.served_by = getattr(chunk, "model_version", None) or self.served_by
        candidates = getattr(chunk, "candidates", None) or []
        if candidates and getattr(candidates[0], "finish_reason", None):
            self.finish_reason = candidates[0].finish_reason
        feedback = getattr(chunk, "prompt_feedback", None)
        self.block_reason = getattr(feedback, "block_reason", None) or self.block_reason
        usage = getattr(chunk, "usage_metadata", None)
        if usage is not None:
            self.prompt_tokens = getattr(usage, "prompt_token_count", None)
            self.output_tokens = getattr(usage, "candidates_token_count", None)
            self.thought_tokens = getattr(usage, "thoughts_token_count", None)

    def text(self, length: int) -> None:
        self.first_token_at = self.first_token_at or time.monotonic()
        self.chars += length

    @property
    def stalled_at(self) -> str:
        """Where a timeout happened: waiting for the response, its first chunk, its first text, or mid-answer."""
        if self.opened_at is None:
            return "open"
        if self.first_chunk_at is None:
            return "first_chunk"
        if self.first_token_at is None:
            return "first_token"
        return "stream"

    def ms(self, moment: float | None) -> str:
        return "none" if moment is None else f"{(moment - self.begun) * 1000:.0f}"

    def log(self, model: str, attempts: int, thinking: str, failure: str | None = None) -> None:
        logger.info(
            "Gemini stream finished model=%s served_by=%s thinking=%s attempts=%d prompt_chars=%d"
            " open_ms=%s first_chunk_ms=%s first_token_ms=%s total_ms=%s chunks=%d chars=%d finish=%s block=%s"
            " prompt_tokens=%s output_tokens=%s thought_tokens=%s%s",
            model, self.served_by, thinking, attempts, self.prompt_chars,
            self.ms(self.opened_at), self.ms(self.first_chunk_at), self.ms(self.first_token_at),
            self.ms(time.monotonic()), self.chunks, self.chars, self.finish_reason, self.block_reason,
            self.prompt_tokens, self.output_tokens, self.thought_tokens,
            f" failed_at={failure}" if failure else "",
        )


class GeminiAnswerer:
    """Answers through the Google Gen AI SDK with real streaming, using the same prompt as Claude."""

    def __init__(
        self,
        model: str,
        api_key: str,
        client: genai.Client | None = None,
        thinking_level: str | None = None,
        timeout_seconds: float | None = None,
        fallback: "GeminiAnswerer | None" = None,
    ) -> None:
        self.model = model
        self.fallback = fallback  # asked when this model is rate limited or too slow before any text
        self.timeout_seconds = timeout_seconds  # None: REQUEST_TIMEOUT_SECONDS
        self.thinking_level = thinking_level
        self.api_key = api_key
        self._given_client = client  # tests pass a fake
        # The SDK's async client is bound to the event loop it was first used in. Under one server loop a
        # single client is enough; a second loop (reload, tests, scripts) gets its own instead of failing.
        self._clients: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, genai.Client]" = weakref.WeakKeyDictionary()

    @property
    def client(self) -> genai.Client:
        if self._given_client is not None:
            return self._given_client
        loop = asyncio.get_running_loop()
        client = self._clients.get(loop)
        if client is None:
            client = genai.Client(
                api_key=self.api_key,
                http_options=types.HttpOptions(timeout=int(REQUEST_TIMEOUT_SECONDS * 1000)),
            )
            self._clients[loop] = client
        return client

    async def stream(
        self, question: str, excerpts: list[Excerpt], language: str | None, history: History
    ) -> AsyncIterator[str]:
        """Once text has reached the client nothing is retried on the other model, so words are never repeated."""
        yielded = False
        try:
            async for piece in self._stream_once(question, excerpts, language, history):
                yielded = True
                yield piece
            return
        except (LlmRateLimited, LlmTimeout) as exc:
            if yielded or self.fallback is None:
                raise
            logger.warning("Gemini %s failed (%s), falling back to %s", self.model, type(exc).__name__, self.fallback.model)
        async for piece in self.fallback._stream_once(question, excerpts, language, history):
            yield piece

    async def _stream_once(
        self, question: str, excerpts: list[Excerpt], language: str | None, history: History
    ) -> AsyncIterator[str]:
        contents: list[dict] = []
        for earlier_question, earlier_answer in history:
            contents.append({"role": "user", "parts": [{"text": earlier_question}]})
            contents.append({"role": "model", "parts": [{"text": earlier_answer}]})
        user_message = build_user_message(question, excerpts, language)
        contents.append({"role": "user", "parts": [{"text": user_message}]})
        # Without a level the model's own default applies, so behavior only changes when it is asked to.
        thinking = (
            types.ThinkingConfig(thinking_level=types.ThinkingLevel(self.thinking_level.upper()))
            if self.thinking_level
            else None
        )
        config = types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT, max_output_tokens=MAX_OUTPUT_TOKENS, thinking_config=thinking
        )
        level_name = self.thinking_level or "default"
        prompt_chars = len(SYSTEM_PROMPT) + sum(len(part["parts"][0]["text"]) for part in contents)

        loop = asyncio.get_running_loop()
        # The HTTP timeout only limits gaps between bytes; this also bounds the whole answer, retries included.
        deadline = loop.time() + (self.timeout_seconds or REQUEST_TIMEOUT_SECONDS)
        report = _Report(prompt_chars)
        yielded = False
        attempt = 0
        while True:
            attempt += 1
            chunks = None
            try:
                async with asyncio.timeout_at(deadline):
                    chunks = await self.client.aio.models.generate_content_stream(
                        model=self.model, contents=contents, config=config
                    )
                report.opened()
                iterator = aiter(chunks)
                while True:
                    async with asyncio.timeout_at(deadline):
                        try:
                            chunk = await anext(iterator)
                        except StopAsyncIteration:
                            report.log(self.model, attempt, level_name)
                            return
                    report.see(chunk)
                    # A chunk can hold no text, for example the last one or a safety block. Then the
                    # answer has no valid citation and the router turns it into not_found.
                    if chunk.text:
                        report.text(len(chunk.text))
                        yielded = True
                        yield chunk.text
            except (TimeoutError, httpx.TimeoutException) as exc:
                if not isinstance(exc, TimeoutError) and not yielded and attempt < MAX_ATTEMPTS:
                    logger.warning("Gemini timed out, retrying (attempt %d) model=%s", attempt, self.model)
                    await asyncio.sleep(RETRY_DELAY_SECONDS * attempt)
                    continue
                report.log(self.model, attempt, level_name, failure=f"timeout_{report.stalled_at}")
                raise LlmTimeout() from exc
            except Exception as exc:
                # Only a failure before any text reached the client can be retried without repeating words.
                if not yielded and attempt < MAX_ATTEMPTS and _is_transient(exc) and loop.time() < deadline:
                    logger.warning(
                        "Gemini failed before the first token (%s %s), retrying (attempt %d) model=%s",
                        type(exc).__name__, getattr(exc, "code", ""), attempt, self.model,
                    )
                    await asyncio.sleep(RETRY_DELAY_SECONDS * attempt)
                    continue
                report.log(self.model, attempt, level_name, failure=f"{type(exc).__name__}_{report.stalled_at}")
                if isinstance(exc, errors.APIError):
                    raise _translate(exc, self.model) from exc
                # Anything else, including a response the SDK could not parse, is logged by type only.
                logger.error("Gemini request failed unexpectedly: %s.%s", type(exc).__module__, type(exc).__name__)
                raise LlmUnavailable() from exc
            finally:
                # Closing on client disconnect drops the connection and stops generation.
                close = getattr(chunks, "aclose", None)
                if close is not None:
                    await close()

