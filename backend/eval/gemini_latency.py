"""Finds out what is slow when Gemini answers take a minute. Run it in your own terminal, where the key is set.

    export GEMINI_API_KEY=...
    PYTHONPATH=. python eval/gemini_latency.py path/to/file.pdf ["question"] [--runs 2] [--show]

It measures, with the official SDK and no retries and no 60 s limit (each call is capped at 150 s):
  1. network: DNS, TCP and TLS to the API host, and one metadata call (no generation);
  2. a tiny prompt without RAG, with the default thinking and with each thinking level;
  3. the real RAG prompt for your PDF and question (the same code and prompt as the server), same variants;
  4. whether the answer's [n] citations are valid under the current system prompt.
For every call: time until the response opens, until the first chunk, until the first text, until the end, plus
token counts (prompt, output, thinking). It prints sizes and times, never the key; the question and the answer
text appear only with --show.
"""

import argparse
import asyncio
import os
import shutil
import socket
import ssl
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path

from google import genai
from google.genai import errors, types

from app.config import Settings
from app.llm import SYSTEM_PROMPT, build_user_message
from app.llm_gemini import MAX_OUTPUT_TOKENS
from app.pipeline import process_document
from app.routers.conversations import cited_numbers, select_chunks, to_excerpts, verified_sources
from app.store import Store

HOST = "generativelanguage.googleapis.com"
CALL_CAP_SECONDS = 150.0
TINY_PROMPT = "Reply with one short sentence: what is 2 + 2?"


@dataclass
class Result:
    label: str
    open_s: float | None = None
    first_chunk_s: float | None = None
    first_token_s: float | None = None
    total_s: float | None = None
    chunks: int = 0
    text: str = ""
    finish: str | None = None
    served_by: str | None = None
    tokens: tuple = (None, None, None)  # prompt, output, thinking
    problem: str | None = None
    extra: dict = field(default_factory=dict)

    def line(self) -> str:
        def f(value: float | None) -> str:
            return "   -  " if value is None else f"{value:6.2f}"

        prompt, output, thought = self.tokens
        tail = f"  !! {self.problem}" if self.problem else ""
        return (
            f"  {self.label:<22} open {f(self.open_s)}s  first chunk {f(self.first_chunk_s)}s  first text "
            f"{f(self.first_token_s)}s  total {f(self.total_s)}s | tokens in={prompt} out={output} thinking={thought}"
            f" finish={self.finish}{tail}"
        )


def thinking_config(level: str | None) -> types.ThinkingConfig | None:
    return types.ThinkingConfig(thinking_level=types.ThinkingLevel(level.upper())) if level else None


async def measure(client: genai.Client, model: str, label: str, contents, system: str | None, level: str | None, max_tokens: int) -> Result:
    result = Result(label)
    config = types.GenerateContentConfig(system_instruction=system, max_output_tokens=max_tokens, thinking_config=thinking_config(level))
    start = time.monotonic()
    stage = "open"
    try:
        async with asyncio.timeout(CALL_CAP_SECONDS):
            stream = await client.aio.models.generate_content_stream(model=model, contents=contents, config=config)
            result.open_s, stage = time.monotonic() - start, "first_chunk"
            async for chunk in stream:
                result.chunks += 1
                if result.first_chunk_s is None:
                    result.first_chunk_s, stage = time.monotonic() - start, "first_text"
                result.served_by = getattr(chunk, "model_version", None) or result.served_by
                if chunk.candidates and chunk.candidates[0].finish_reason:
                    result.finish = str(chunk.candidates[0].finish_reason).split(".")[-1]
                usage = chunk.usage_metadata
                if usage is not None:
                    result.tokens = (usage.prompt_token_count, usage.candidates_token_count, usage.thoughts_token_count)
                if chunk.text:
                    if result.first_token_s is None:
                        result.first_token_s, stage = time.monotonic() - start, "stream"
                    result.text += chunk.text
    except TimeoutError:
        result.problem = f"no answer within {CALL_CAP_SECONDS:.0f}s, stuck waiting at: {stage}"
    except errors.APIError as exc:
        result.problem = f"HTTP {exc.code} {exc.status} at: {stage}"
    except Exception as exc:  # noqa: BLE001 - a diagnostic reports whatever happened
        result.problem = f"{type(exc).__name__} at: {stage}"
    result.total_s = time.monotonic() - start
    return result


def network_check(model: str, client: genai.Client) -> None:
    print("1. Network (no generation)")
    proxies = [name for name in ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY") if os.environ.get(name)]
    print(f"  proxy variables set: {', '.join(proxies) or 'none'}")
    start = time.monotonic()
    try:
        infos = socket.getaddrinfo(HOST, 443, type=socket.SOCK_STREAM)
        print(f"  DNS {HOST}: {time.monotonic() - start:.2f}s ({len(infos)} addresses, IPv6 among them: {any(i[0] == socket.AF_INET6 for i in infos)})")
        start = time.monotonic()
        with socket.create_connection((HOST, 443), timeout=15) as raw:
            tcp = time.monotonic() - start
            with ssl.create_default_context().wrap_socket(raw, server_hostname=HOST):
                print(f"  TCP connect {tcp:.2f}s, TLS handshake done at {time.monotonic() - start:.2f}s")
    except OSError as exc:
        print(f"  !! cannot reach {HOST}: {type(exc).__name__}")
    for attempt in (1, 2):
        start = time.monotonic()
        try:
            client.models.get(model=model)
            print(f"  models.get #{attempt}: {time.monotonic() - start:.2f}s (a plain API round trip)")
        except errors.APIError as exc:
            print(f"  models.get #{attempt}: HTTP {exc.code} {exc.status} after {time.monotonic() - start:.2f}s")


def build_rag(pdf: Path, question: str) -> tuple[Store, str, list, str, str, tempfile.TemporaryDirectory]:
    scratch = tempfile.TemporaryDirectory()
    store = Store(Path(scratch.name))
    doc_id = store.new_id()
    shutil.copy(pdf, store.file_path(doc_id, "pdf"))
    store.insert(doc_id, pdf.name, "pdf", pdf.stat().st_size)
    started = time.monotonic()
    process_document(store, doc_id)
    state = store.get(doc_id)
    print(f"  extraction + indexing: {time.monotonic() - started:.2f}s, status={state['status']}, pages={state['page_count']}")
    if state["status"] != "ready":
        sys.exit(f"The PDF could not be processed (status {state['status']}). Nothing to ask.")
    chunks = store.chunks_for_documents([doc_id])
    started = time.monotonic()
    picked, overview = select_chunks(question, [], chunks)
    print(f"  retrieval: {time.monotonic() - started:.3f}s over {len(chunks)} chunks -> {len(picked)} excerpts (overview sample: {overview})")
    excerpts = to_excerpts(picked, overview)
    message = build_user_message(question, excerpts, None)
    return store, doc_id, excerpts, message, scratch.name, scratch


def citation_report(result: Result, excerpts: list, store: Store, question: str) -> None:
    cited = sorted(cited_numbers(result.text))
    sources = verified_sources(result.text, excerpts, store, question)
    refused = result.text.strip().startswith("NOT_FOUND")
    print(f"      citations: cited={cited} verified={[s['index'] for s in sources]} model_said_NOT_FOUND={refused}"
          f" -> server would answer: {'answered' if sources else 'not_found'}")


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("question", nargs="?", default="как называется урок 15?")
    parser.add_argument("--runs", type=int, default=2)
    parser.add_argument("--show", action="store_true", help="also print the question and the answers")
    args = parser.parse_args()

    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        print("GEMINI_API_KEY is not set in this terminal.")
        return 2
    model = Settings().gemini_model
    print(f"model={model}  server thinking setting={Settings().gemini_thinking_level or 'default'}  "
          f"max_output_tokens={MAX_OUTPUT_TOKENS}  (key present, {len(key)} characters, never printed)\n")
    client = genai.Client(api_key=key)
    network_check(model, client)

    variants = [("default", None), ("minimal", "minimal"), ("low", "low")]
    print("\n2. Tiny prompt, no RAG, no system prompt")
    for label, level in variants:
        for run in range(1, args.runs + 1):
            print((await measure(client, model, f"{label} #{run}", TINY_PROMPT, None, level, 256)).line())

    print("\n3. Your PDF through the server's own retrieval and prompt")
    store, _doc_id, excerpts, message, _dir, scratch = build_rag(args.pdf, args.question)
    prompt_chars = len(SYSTEM_PROMPT) + len(message)
    try:
        counted = client.models.count_tokens(model=model, contents=message).total_tokens
    except errors.APIError as exc:
        counted = f"unknown (HTTP {exc.code})"
    print(f"  context sent: system prompt {len(SYSTEM_PROMPT)} + user message {len(message)} characters = {prompt_chars}; "
          f"user message is {counted} tokens (excerpts: {len(excerpts)}, each at most 500 characters)")
    if args.show:
        print(f"  question: {args.question}")
    for label, level in variants:
        for run in range(1, args.runs + 1):
            result = await measure(client, model, f"{label} #{run}", message, SYSTEM_PROMPT, level, MAX_OUTPUT_TOKENS)
            print(result.line())
            citation_report(result, excerpts, store, args.question)
            if args.show:
                print(f"      answer: {result.text.strip()[:600]}")
    scratch.cleanup()

    print("""
How to read it
  - tiny prompt also slow, or DNS/TCP/models.get slow: network, proxy, region or quota, not RAG or the prompt.
  - 'open' large: the connection or the API gateway is the wait (stuck at: open).
  - first text much later than first chunk, thinking tokens high: the model is reasoning. Compare the rows:
    if minimal/low are much faster than default, set GEMINI_THINKING_LEVEL for the server.
  - first text fast but total slow, output tokens high: the answer itself is long.
  - citations not verified although the model answered: the prompt format, see 'cited' against 'verified'.""")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
