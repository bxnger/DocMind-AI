import json
import logging
import re
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import aclosing

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response, StreamingResponse

from app.chunking import SENTENCE_END
from app.citations import is_verbatim
from app.config import MAX_MESSAGE_CHARS
from app.deps import get_answerer, get_store
from app.errors import AppError
from app.highlights import quote_highlights
from app.ratelimit import limit_chat
from app.llm import Answerer, Excerpt, History, LlmAuthFailed, LlmMisconfigured, LlmRateLimited, LlmTimeout, LlmUnavailable
from app.retrieval import is_overview_question, overview_chunks, rank, tokenize
from app.schemas import CreateConversation, SendMessage
from app.store import Store

router = APIRouter(prefix="/conversations", tags=["conversations"])

EXCERPTS_PER_ANSWER = 5
HISTORY_TURNS = 3
SHORT_QUESTION_TOKENS = 3
NOT_FOUND_MARKER = "NOT_FOUND"
# A marker is [3]. Models sometimes group them as [1, 2], so those are read as well.
CITATION = re.compile(r"\[(\d+(?:\s*[,;]\s*\d+)*)\]")
DIGITS = re.compile(r"\d+")

logger = logging.getLogger("app.chat")


def cited_numbers(text: str) -> set[int]:
    return {int(number) for group in CITATION.findall(text) for number in DIGITS.findall(group)}


def normalize_markers(text: str) -> str:
    """[1, 2] becomes [1][2], so every marker in a saved answer is a single, linkable one."""
    return CITATION.sub(lambda m: "".join(f"[{n}]" for n in DIGITS.findall(m.group(1))), text)


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("", status_code=201)
def create_conversation(body: CreateConversation, store: Store = Depends(get_store)) -> dict:
    if len(set(body.document_ids)) != len(body.document_ids):
        raise AppError(422, "VALIDATION_ERROR", "documentIds must not repeat")
    names = []
    for document_id in body.document_ids:
        doc = store.get(document_id)
        if doc["status"] != "ready":
            raise AppError(409, "DOCUMENT_NOT_READY", "Document is still being processed")
        names.append(doc["name"])
    title = body.title or names[0]
    return store.create_conversation(title, body.document_ids)


@router.get("")
def list_conversations(store: Store = Depends(get_store)) -> dict:
    return {"items": store.list_conversations()}


@router.get("/{conversation_id}")
def get_conversation(conversation_id: str, store: Store = Depends(get_store)) -> dict:
    return store.get_conversation(conversation_id)


@router.delete("/{conversation_id}", status_code=204)
def delete_conversation(conversation_id: str, store: Store = Depends(get_store)) -> Response:
    store.delete_conversation(conversation_id)
    return Response(status_code=204)


@router.get("/{conversation_id}/messages")
def list_messages(conversation_id: str, store: Store = Depends(get_store)) -> dict:
    return {"items": store.list_messages(conversation_id)}


@router.post("/{conversation_id}/messages", dependencies=[Depends(limit_chat)])
async def send_message(
    conversation_id: str,
    body: SendMessage,
    request: Request,
    store: Store = Depends(get_store),
    answerer: Answerer | None = Depends(get_answerer),
) -> StreamingResponse:
    question = body.content.strip()
    if not question:
        raise AppError(422, "EMPTY_MESSAGE", "Message is empty")
    if len(question) > MAX_MESSAGE_CHARS:
        raise AppError(422, "MESSAGE_TOO_LONG", f"Message is longer than {MAX_MESSAGE_CHARS} characters")

    conversation = store.get_conversation(conversation_id)
    for document_id in conversation["documentIds"]:
        if store.get(document_id)["status"] != "ready":
            raise AppError(409, "DOCUMENT_NOT_READY", "A document in this conversation is not ready")
    if answerer is None:
        raise AppError(503, "LLM_UNAVAILABLE", "The AI model is not configured", retryable=True)

    prep_started = time.monotonic()
    history = build_history(store.list_messages(conversation_id))
    chunks = store.chunks_for_documents(conversation["documentIds"])
    picked, overview = select_chunks(question, history, chunks)

    store.add_message(conversation_id, "user", question)
    prep_ms = (time.monotonic() - prep_started) * 1000
    assistant_id = uuid.uuid4().hex
    return StreamingResponse(
        answer_stream(
            request, store, answerer, conversation_id, assistant_id, question, body.language, picked, history, overview, prep_ms, len(chunks)
        ),
        media_type="text/event-stream",
    )


def select_chunks(question: str, history: History, chunks: list[dict]) -> tuple[list[dict], bool]:
    """The chunks to show the model, and whether they are an overview sample rather than search results."""
    if is_overview_question(question):
        return overview_chunks(chunks, EXCERPTS_PER_ANSWER), True
    hits = rank(retrieval_query(question, history), [chunk["text"] for chunk in chunks], EXCERPTS_PER_ANSWER)
    return [chunks[index] for index, _score in hits], False


def to_excerpts(picked: list[dict], sampled: bool) -> list[Excerpt]:
    return [
        Excerpt(
            number=number,
            document_id=chunk["documentId"],
            document_name=chunk["documentName"],
            page=chunk["page"],
            location=chunk["location"],
            text=chunk["text"],
            segment_text=chunk["segmentText"],
            sampled=sampled,
        )
        for number, chunk in enumerate(picked, start=1)
    ]


def build_history(messages: list[dict]) -> History:
    """The last few answered (question, answer) pairs, for follow-up questions."""
    pairs: History = []
    for earlier, later in zip(messages, messages[1:]):
        if earlier["role"] == "user" and later["role"] == "assistant" and later["answerStatus"] == "answered":
            pairs.append((earlier["content"], later["content"]))
    return pairs[-HISTORY_TURNS:]


def retrieval_query(question: str, history: History) -> str:
    """A very short question ("and when?") borrows the words of the previous one."""
    if history and len(tokenize(question)) <= SHORT_QUESTION_TOKENS:
        return f"{history[-1][0]} {question}"
    return question


async def answer_stream(
    request: Request,
    store: Store,
    answerer: Answerer,
    conversation_id: str,
    assistant_id: str,
    question: str,
    language: str | None,
    picked: list[dict],
    history: History,
    overview: bool = False,
    prep_ms: float = 0.0,
    chunk_count: int = 0,
) -> AsyncIterator[str]:
    started = time.monotonic()
    first_token_ms: list[float] = []
    model = getattr(answerer, "model", type(answerer).__name__)
    mode = "overview" if overview else "search"

    def log(outcome: str, **facts: object) -> None:
        # Counts and names only. Questions, answers and document text are never logged.
        detail = " ".join(f"{key}={value}" for key, value in facts.items())
        first = f"{first_token_ms[0]:.0f}" if first_token_ms else "none"
        # prep_ms is the work before the model call (retrieval over chunk_count chunks), first_token_ms is
        # measured from the start of the answer, ms is the whole answer.
        logger.info(
            "chat %s mode=%s model=%s prep_ms=%.0f chunks=%d first_token_ms=%s ms=%d %s",
            outcome, mode, model, prep_ms, chunk_count, first, (time.monotonic() - started) * 1000, detail,
        )

    yield sse("start", {"messageId": assistant_id})

    if not picked:
        # Nothing relevant in the documents: no model call, an honest not_found.
        store.add_message(conversation_id, "assistant", "", "not_found", [], message_id=assistant_id)
        yield sse("done", {"messageId": assistant_id, "answerStatus": "not_found"})
        log("not_found", reason="no_matching_excerpt")
        return

    excerpts = to_excerpts(picked, overview)

    answer = ""
    pending = ""
    decided = False
    refused = False
    try:
        async with aclosing(answerer.stream(question, excerpts, language, history)) as pieces:
            async for piece in pieces:
                if await request.is_disconnected():
                    return  # the client stopped; leaving the loop closes the model stream
                answer += piece
                if piece and not first_token_ms:
                    first_token_ms.append((time.monotonic() - started) * 1000)
                if decided:
                    if not refused:
                        yield sse("token", {"text": piece})
                    continue
                # Hold back the first few characters: a NOT_FOUND reply must not reach the client as text.
                pending += piece
                if len(pending.strip()) < len(NOT_FOUND_MARKER):
                    continue
                decided = True
                refused = pending.strip().startswith(NOT_FOUND_MARKER)
                if not refused:
                    yield sse("token", {"text": pending})
    except LlmTimeout:
        log("error", code="LLM_TIMEOUT", answer_chars=len(answer))
        yield sse("error", {"code": "LLM_TIMEOUT", "message": "The AI model timed out", "retryable": True})
        return
    except LlmRateLimited:
        log("error", code="RATE_LIMITED", answer_chars=len(answer))
        yield sse("error", {"code": "RATE_LIMITED", "message": "The AI provider's rate limit was reached", "retryable": True})
        return
    except (LlmAuthFailed, LlmMisconfigured) as exc:
        log("error", code="LLM_UNAVAILABLE", cause=type(exc).__name__, answer_chars=len(answer))
        yield sse("error", {"code": "LLM_UNAVAILABLE", "message": "The AI provider is not configured correctly", "retryable": False})
        return
    except LlmUnavailable as exc:
        log("error", code="LLM_UNAVAILABLE", cause=type(exc).__name__, answer_chars=len(answer))
        yield sse("error", {"code": "LLM_UNAVAILABLE", "message": "The AI model is unavailable", "retryable": True})
        return

    if not decided:
        refused = answer.strip().startswith(NOT_FOUND_MARKER)
        if not refused and pending:
            yield sse("token", {"text": pending})

    sources = [] if refused else verified_sources(answer, excerpts, store, question)
    status = "answered" if sources else "not_found"
    if status == "answered":
        log("answered", excerpts=len(excerpts), cited=len(cited_numbers(answer)), sources=len(sources), answer_chars=len(answer))
    else:
        # Says why an answer became not_found: the model refused, wrote nothing, cited nothing, or cited wrongly.
        cited = cited_numbers(answer)
        reason = "model_refused" if refused else "empty_answer" if not answer.strip() else "no_citation" if not cited else "citations_failed_verification"
        log("not_found", reason=reason, excerpts=len(excerpts), cited=len(cited), answer_chars=len(answer))
    if sources:
        yield sse("sources", {"sources": sources})
    yield sse("done", {"messageId": assistant_id, "answerStatus": status})
    store.add_message(
        conversation_id,
        "assistant",
        normalize_markers(answer) if status == "answered" else "",
        status,
        sources,
        message_id=assistant_id,
    )


def claim_for(answer: str, number: int) -> str:
    """The sentence of the answer that carries the marker [number]."""
    return next((sentence for sentence in SENTENCE_END.split(answer) if number in cited_numbers(sentence)), "")


def best_sentence(excerpt_text: str, focus: str) -> str:
    """The sentence of the excerpt that shares the most words with `focus`, or the whole excerpt.

    A shorter quote shows the reader exactly where the answer comes from. Sentences are exact
    substrings of the excerpt, so the quote stays verbatim.
    """
    sentences = [sentence for sentence in SENTENCE_END.split(excerpt_text) if sentence]
    if len(sentences) < 2:
        return excerpt_text
    focus_words = set(tokenize(focus))
    scores = [len(focus_words & set(tokenize(sentence))) for sentence in sentences]
    best = max(scores)
    return excerpt_text if best == 0 else sentences[scores.index(best)]


def verified_sources(answer: str, excerpts: list[Excerpt], store: Store, question: str = "") -> list[dict]:
    """Sources for the [n] markers the answer uses, keeping only quotes found verbatim in their segment.

    The quote is the sentence of the excerpt closest to the question and the cited claim.
    PDF sources also carry `highlights`, the quote's rectangles on the page, when they can be located.
    """
    cited = sorted(cited_numbers(answer))
    sources = []
    for number in cited:
        if not 1 <= number <= len(excerpts):
            continue
        excerpt = excerpts[number - 1]
        quote = best_sentence(excerpt.text, f"{question} {claim_for(answer, number)}")
        if not is_verbatim(quote, excerpt.segment_text):
            continue
        source = {
            "index": number,
            "documentId": excerpt.document_id,
            "documentName": excerpt.document_name,
            "page": excerpt.page,
            "location": excerpt.location,
            "quote": quote,
        }
        if excerpt.page is not None:
            highlights = quote_highlights(store.file_path(excerpt.document_id, "pdf"), excerpt.page, quote)
            if highlights:
                source["highlights"] = highlights
        sources.append(source)
    return sources
