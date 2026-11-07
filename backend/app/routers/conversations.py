import json
import logging
import re
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import aclosing

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response, StreamingResponse

from app.answer_cache import REPLAY_PIECE_CHARS, AnswerCache, cache_key
from app.chunking import SENTENCE_END
from app.citations import is_verbatim, unsupported_numbers
from app.comparison import chat_evidence, is_change_question, load_sentences
from app.config import MAX_MESSAGE_CHARS
from app.deps import get_answerer, get_store
from app.errors import AppError
from app.extraction import ExtractionError, find_block, stored_blocks
from app.highlights import quote_highlights
from app.auth import Session, limited
from app.llm import Answerer, Excerpt, History, LlmAuthFailed, LlmMisconfigured, LlmRateLimited, LlmTimeout, LlmUnavailable
from app.retrieval import is_overview_question, overview_chunks, rank, tokenize
from app.schemas import CreateConversation, SendMessage
from app.store import Store
from app.translate import query_language, search_translation

router = APIRouter(prefix="/conversations", tags=["conversations"])

EXCERPTS_PER_ANSWER = 5
# A summary question gets a wider, evenly spread sample of the document (bounded: 12 chunks of at most 500 characters).
OVERVIEW_EXCERPTS = 12
# A document this small fits in one prompt. If search finds nothing (a synonym, a paraphrase), the model reads it all
# and decides, instead of the question being refused without anyone reading the document.
SMALL_DOCUMENT_CHUNKS = 12
# "What changed?" with two documents: up to this many changed clauses (and twice as many unchanged facts for
# "what did not change?"), plus the best search hits, which hold the document's own words about the change.
VERSION_PAIRS = 8
SEARCH_WITH_VERSIONS = 3
# "Which sums / amounts are mentioned?" (a question the interface suggests).
AMOUNTS_QUESTION = re.compile(r"сумм|amount|sums?\b|сомалар|сома\w*|денежн|money", re.IGNORECASE)
MONEY = re.compile(r"\d[\d  .,]*\s?(?:₸|тенге|теңге|тг\b|kzt|руб|₽|\$|usd|€|eur)", re.IGNORECASE)
AMOUNT_EXCERPTS = 5
HISTORY_TURNS = 3
SHORT_QUESTION_TOKENS = 3
NOT_FOUND_MARKER = "NOT_FOUND"
# A marker is [3]. Models sometimes group them as [1, 2], so those are read as well.
CITATION = re.compile(r"\[(\d+(?:\s*[,;]\s*\d+)*)\]")
DIGITS = re.compile(r"\d+")
ONLY_MARKERS = re.compile(r"(?:\s*\[\d+(?:\s*[,;]\s*\d+)*\])+\s*[.!?]*")

logger = logging.getLogger("app.chat")


def cited_numbers(text: str) -> set[int]:
    return {int(number) for group in CITATION.findall(text) for number in DIGITS.findall(group)}


def normalize_markers(text: str) -> str:
    """[1, 2] becomes [1][2], so every marker in a saved answer is a single, linkable one."""
    return CITATION.sub(lambda m: "".join(f"[{n}]" for n in DIGITS.findall(m.group(1))), text)


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("", status_code=201)
def create_conversation(
    body: CreateConversation, request: Request, store: Store = Depends(get_store), session: Session = Depends(limited("read"))
) -> dict:
    if len(set(body.document_ids)) != len(body.document_ids):
        raise AppError(422, "VALIDATION_ERROR", "documentIds must not repeat")
    names = []
    for document_id in body.document_ids:
        doc = store.get(document_id, session.owner_id)
        if doc["status"] != "ready":
            raise AppError(409, "DOCUMENT_NOT_READY", "Document is still being processed")
        names.append(doc["name"])
    title = body.title or names[0]
    return store.create_conversation(title, body.document_ids, session.owner_id, request.app.state.settings.session_max_conversations)


@router.get("")
def list_conversations(store: Store = Depends(get_store), session: Session = Depends(limited("read"))) -> dict:
    return {"items": store.list_conversations(session.owner_id)}


@router.get("/{conversation_id}")
def get_conversation(conversation_id: str, store: Store = Depends(get_store), session: Session = Depends(limited("read"))) -> dict:
    return store.get_conversation(conversation_id, session.owner_id)


@router.delete("/{conversation_id}", status_code=204)
def delete_conversation(conversation_id: str, store: Store = Depends(get_store), session: Session = Depends(limited("read"))) -> Response:
    store.get_conversation(conversation_id, session.owner_id)
    store.delete_conversation(conversation_id)
    return Response(status_code=204)


@router.get("/{conversation_id}/messages")
def list_messages(conversation_id: str, store: Store = Depends(get_store), session: Session = Depends(limited("read"))) -> dict:
    store.get_conversation(conversation_id, session.owner_id)
    return {"items": store.list_messages(conversation_id)}


@router.post("/{conversation_id}/messages")
async def send_message(
    conversation_id: str,
    body: SendMessage,
    request: Request,
    store: Store = Depends(get_store),
    answerer: Answerer | None = Depends(get_answerer),
    session: Session = Depends(limited("chat")),
) -> StreamingResponse:
    question = body.content.strip()
    if not question:
        raise AppError(422, "EMPTY_MESSAGE", "Message is empty")
    if len(question) > MAX_MESSAGE_CHARS:
        raise AppError(422, "MESSAGE_TOO_LONG", f"Message is longer than {MAX_MESSAGE_CHARS} characters")

    conversation = store.get_conversation(conversation_id, session.owner_id)
    for document_id in conversation["documentIds"]:
        if store.get(document_id)["status"] != "ready":
            raise AppError(409, "DOCUMENT_NOT_READY", "A document in this conversation is not ready")
    if answerer is None:
        raise AppError(503, "LLM_UNAVAILABLE", "The AI model is not configured", retryable=True)

    prep_started = time.monotonic()
    history = build_history(store.list_messages(conversation_id))
    # The requested language wins. Without one the answer follows the question, not the document:
    # an English question about a Russian contract is answered in English.
    language = body.language or query_language(question)
    # A self-contained question has the same answer whatever was asked before, so the history is part of the key
    # only for a short follow-up ("and when?"), which means something different after each earlier answer.
    # Without this a warm-up in a fresh conversation never matched the real one, which has a history.
    key_history = history if len(tokenize(question)) <= SHORT_QUESTION_TOKENS else []
    key = cache_key(conversation["documentIds"], question, language, key_history)
    # Looked up before the search and the translation: a remembered answer needs neither.
    cached = ANSWER_CACHE.get(key)
    chunks: list[dict] = []
    picked: list[dict] = []
    overview = False
    if cached is None:
        # Counted before the first model call (the translation). A remembered answer costs nothing.
        settings = request.app.state.settings
        if settings.ai_emergency_stop:
            raise AppError(429, "AI_BUDGET_EXCEEDED", "AI answers are switched off for now")
        store.reserve_ai_request(
            session.owner_id, session.client_key, settings.ai_session_daily_limit,
            settings.ai_client_daily_limit, settings.ai_global_daily_limit,
        )
        chunks = store.chunks_for_documents(conversation["documentIds"])
        translated = ""
        if not is_overview_question(question):
            # A question in another language than the documents is also searched in their language.
            document_languages = [store.get(document_id)["language"] for document_id in conversation["documentIds"]]
            translated, targets, translate_ms = await search_translation(
                answerer, retrieval_query(question, history), document_languages
            )
            if targets:
                logger.info("chat translate targets=%s ok=%s ms=%.0f", ",".join(targets), bool(translated), translate_ms)
        picked, overview = select_chunks(question, history, chunks, translated)
        if not overview and len(conversation["documentIds"]) >= 2 and is_change_question(question):
            picked = version_chunks(store, conversation["documentIds"][:2], question) + picked[:SEARCH_WITH_VERSIONS]

    prep_ms = (time.monotonic() - prep_started) * 1000
    assistant_id = uuid.uuid4().hex
    return StreamingResponse(
        answer_stream(
            request, store, answerer, conversation_id, assistant_id, question, language,
            picked, history, overview, prep_ms, len(chunks), key=key, cached=cached,
        ),
        media_type="text/event-stream",
    )


def select_chunks(question: str, history: History, chunks: list[dict], translated: str = "") -> tuple[list[dict], bool]:
    """The chunks to show the model, and whether they are an overview sample rather than search results."""
    if is_overview_question(question):
        return overview_chunks(chunks, OVERVIEW_EXCERPTS), True
    query = f"{retrieval_query(question, history)} {translated}".strip()
    hits = rank(query, [chunk["text"] for chunk in chunks], EXCERPTS_PER_ANSWER)
    picked = [chunks[index] for index, _score in hits]
    if AMOUNTS_QUESTION.search(question):
        # "Which amounts are in the document?": the word "amount" is rarely next to the figures, so search misses them.
        with_money = sorted(
            (chunk for chunk in chunks if MONEY.search(chunk["text"])), key=lambda chunk: -len(MONEY.findall(chunk["text"]))
        )
        picked += [chunk for chunk in with_money if chunk not in picked][:AMOUNT_EXCERPTS]
    if not picked and 0 < len(chunks) <= SMALL_DOCUMENT_CHUNKS:
        return list(chunks), False
    return picked, False


def version_chunks(store: Store, document_ids: list[str], question: str) -> list[dict]:
    """Excerpts for "what changed between the two documents?": the clauses the comparison finds, with their values.
    Empty when the documents are too large to compare here."""
    try:
        first, second = (load_sentences(store, document_id) for document_id in document_ids)
    except AppError:
        return []
    names = [store.get(document_id)["name"] for document_id in document_ids]

    def chunk(sentence, side: int, version: str) -> dict:
        return {
            "documentId": document_ids[side], "documentName": names[side], "page": sentence.page,
            "location": sentence.location, "text": sentence.text, "segmentText": sentence.segment_text, "version": version,
        }

    picked: list[dict] = []
    for kind, left, right in chat_evidence(first, second, question, VERSION_PAIRS):
        if kind == "same" and left:
            picked.append(chunk(left, 0, "both"))
            continue
        if left:
            picked.append(chunk(left, 0, "first"))
        if right:
            picked.append(chunk(right, 1, "second"))
    return picked


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
            version=chunk.get("version"),
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


ANSWER_CACHE = AnswerCache()


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
    key: tuple | None = None,
    cached=None,
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

    def save(content: str, status: str, sources: list[dict], reason: str | None = None) -> None:
        # The question is saved together with its answer, and before the answer is sent. A failed attempt
        # (provider error, timeout, a closed connection) leaves nothing behind, so a retry does not repeat
        # the question in the history or in the model's context.
        store.add_message(conversation_id, "user", question)
        store.add_message(conversation_id, "assistant", content, status, sources, message_id=assistant_id, reason=reason)

    yield sse("start", {"messageId": assistant_id})

    if cached is not None:
        # The same question on the same documents was answered and verified before: replay it without the model.
        save(cached.text, "answered", cached.sources)
        for piece in cached.pieces():
            yield sse("token", {"text": piece})
        yield sse("sources", {"sources": cached.sources})
        yield sse("done", {"messageId": assistant_id, "answerStatus": "answered"})
        log("answered", cache="hit", sources=len(cached.sources))
        return

    if not picked:
        # Nothing relevant in the documents: no model call, an honest not_found.
        save("", "not_found", [], "no_matching_excerpt")
        yield sse("done", {"messageId": assistant_id, "answerStatus": "not_found", "reason": "no_matching_excerpt"})
        log("not_found", reason="no_matching_excerpt")
        return

    excerpts = to_excerpts(picked, overview)

    answer = ""
    try:
        async with aclosing(answerer.stream(question, excerpts, language, history)) as pieces:
            async for piece in pieces:
                if await request.is_disconnected():
                    return  # the client stopped; leaving the loop closes the model stream
                answer += piece
                if piece and not first_token_ms:
                    first_token_ms.append((time.monotonic() - started) * 1000)
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

    # The answer is checked before any of it is shown: a sentence the sources do not support never reaches the reader.
    refused = answer.strip().startswith(NOT_FOUND_MARKER)
    reason = ""
    final_text, sources = ("", []) if refused else verify_answer(answer, excerpts, store, question)
    status = "answered" if sources else "not_found"
    if status == "answered":
        final_text = normalize_markers(final_text)
        dropped = len(SENTENCE_END.split(answer.strip())) - len(SENTENCE_END.split(final_text.strip()))
        log("answered", excerpts=len(excerpts), cited=len(cited_numbers(answer)), sources=len(sources), answer_chars=len(answer), dropped_sentences=max(dropped, 0))
        for start in range(0, len(final_text), REPLAY_PIECE_CHARS):
            yield sse("token", {"text": final_text[start : start + REPLAY_PIECE_CHARS]})
    else:
        # Says why an answer became not_found: the model refused, wrote nothing, cited nothing, or cited wrongly.
        cited = cited_numbers(answer)
        reason = "model_refused" if refused else "empty_answer" if not answer.strip() else "no_citation" if not cited else "citations_failed_verification"
        log("not_found", reason=reason, excerpts=len(excerpts), cited=len(cited), answer_chars=len(answer))
    if status == "answered":
        ANSWER_CACHE.put(key, final_text, sources)
    save(final_text if status == "answered" else "", status, sources, reason if status == "not_found" else None)
    if sources:
        yield sse("sources", {"sources": sources})
    done = {"messageId": assistant_id, "answerStatus": status}
    if status == "not_found":
        done["reason"] = reason  # model_refused, no_citation, citations_failed_verification, empty_answer
    yield sse("done", done)


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


def sentence_problem(sentence: str, excerpts: list[Excerpt]) -> bool:
    """True when the sentence cannot be shown: it cites a source that does not exist, states a number its
    own sources do not contain, or states a number from nowhere without citing anything."""
    cited = cited_numbers(sentence)
    if cited:
        if any(not 1 <= number <= len(excerpts) for number in cited):
            return True
        evidence = " ".join(excerpts[number - 1].text for number in cited)
        return bool(unsupported_numbers(sentence, evidence))
    return bool(unsupported_numbers(sentence, " ".join(excerpt.text for excerpt in excerpts)))


def verify_answer(answer: str, excerpts: list[Excerpt], store: Store, question: str = "") -> tuple[str, list[dict]]:
    """The answer without the sentences its sources do not support, and the verified sources of what is left.

    A source is kept only when a shown sentence cites it and its quote is verbatim in its segment.
    PDF sources also carry the quote's highlights when they can be located.
    """
    parts = re.split(r"(?<=[.!?])(\s+)", answer.strip())  # sentence, separator, sentence, ...
    sentences = []
    for piece in parts[0::2]:
        # "… 3 шт. [1]." splits after "шт.": the lone "[1]." belongs to the sentence before it. Left alone, that sentence
        # had no marker and was dropped, and the answer shown was just "[1]." (found by eval/procurement_quality.py).
        if sentences and ONLY_MARKERS.fullmatch(piece):
            sentences[-1] = f"{sentences[-1]} {piece}"
        else:
            sentences.append(piece)
    bad = [sentence_problem(sentence, excerpts) for sentence in sentences]
    shown = [sentence for sentence, is_bad in zip(sentences, bad) if not is_bad]
    text = " ".join(shown) if any(bad) else answer.strip()
    sources = []
    for number in sorted(cited_numbers(" ".join(shown))):
        if not 1 <= number <= len(excerpts):
            continue
        excerpt = excerpts[number - 1]
        claim = " ".join(sentence for sentence in shown if number in cited_numbers(sentence))
        quote = best_sentence(excerpt.text, f"{question} {claim}")
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
        else:
            paragraph = paragraph_of(store, excerpt.document_id, quote)
            if paragraph is not None:
                source["paragraph"] = paragraph  # the block index in GET /documents/{id}/text
        sources.append(source)
    return (text if sources else ""), sources


def paragraph_of(store: Store, document_id: str, quote: str) -> int | None:
    """Index of the DOCX block holding `quote`, or None (a PDF, or a file that cannot be read again)."""
    path = store.file_path(document_id, "docx")
    if not path.exists():
        return None
    try:
        return find_block(stored_blocks(path), quote)
    except (ExtractionError, OSError):
        return None


def verified_sources(answer: str, excerpts: list[Excerpt], store: Store, question: str = "") -> list[dict]:
    """Sources of the shown part of the answer (see verify_answer)."""
    return verify_answer(answer, excerpts, store, question)[1]
