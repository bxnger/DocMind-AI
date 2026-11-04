import json
import re
import uuid
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response, StreamingResponse

from app.citations import is_verbatim
from app.config import MAX_MESSAGE_CHARS
from app.deps import get_answerer, get_store
from app.errors import AppError
from app.llm import Answerer, Excerpt, History, LlmTimeout, LlmUnavailable
from app.retrieval import rank, tokenize
from app.schemas import CreateConversation, SendMessage
from app.store import Store

router = APIRouter(prefix="/conversations", tags=["conversations"])

EXCERPTS_PER_ANSWER = 5
HISTORY_TURNS = 3
SHORT_QUESTION_TOKENS = 3
NOT_FOUND_MARKER = "NOT_FOUND"
CITATION = re.compile(r"\[(\d+)\]")


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


@router.post("/{conversation_id}/messages")
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

    history = build_history(store.list_messages(conversation_id))
    chunks = store.chunks_for_documents(conversation["documentIds"])
    hits = rank(retrieval_query(question, history), [chunk["text"] for chunk in chunks], EXCERPTS_PER_ANSWER)
    picked = [chunks[index] for index, _score in hits]

    store.add_message(conversation_id, "user", question)
    assistant_id = uuid.uuid4().hex
    return StreamingResponse(
        answer_stream(
            request, store, answerer, conversation_id, assistant_id, question, body.language, picked, history
        ),
        media_type="text/event-stream",
    )


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
) -> AsyncIterator[str]:
    yield sse("start", {"messageId": assistant_id})

    if not picked:
        # Nothing relevant in the documents: no model call, an honest not_found.
        store.add_message(conversation_id, "assistant", "", "not_found", [], message_id=assistant_id)
        yield sse("done", {"messageId": assistant_id, "answerStatus": "not_found"})
        return

    excerpts = [
        Excerpt(
            number=number,
            document_id=chunk["documentId"],
            document_name=chunk["documentName"],
            page=chunk["page"],
            location=chunk["location"],
            text=chunk["text"],
            segment_text=chunk["segmentText"],
        )
        for number, chunk in enumerate(picked, start=1)
    ]

    answer = ""
    pending = ""
    decided = False
    refused = False
    try:
        async for piece in answerer.stream(question, excerpts, language, history):
            if await request.is_disconnected():
                return  # the client stopped; leaving the loop closes the model stream
            answer += piece
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
        yield sse("error", {"code": "LLM_TIMEOUT", "message": "The AI model timed out", "retryable": True})
        return
    except LlmUnavailable:
        yield sse("error", {"code": "LLM_UNAVAILABLE", "message": "The AI model is unavailable", "retryable": True})
        return

    if not decided:
        refused = answer.strip().startswith(NOT_FOUND_MARKER)
        if not refused and pending:
            yield sse("token", {"text": pending})

    sources = [] if refused else verified_sources(answer, excerpts)
    status = "answered" if sources else "not_found"
    if sources:
        yield sse("sources", {"sources": sources})
    yield sse("done", {"messageId": assistant_id, "answerStatus": status})
    store.add_message(
        conversation_id,
        "assistant",
        answer if status == "answered" else "",
        status,
        sources,
        message_id=assistant_id,
    )


def verified_sources(answer: str, excerpts: list[Excerpt]) -> list[dict]:
    """Sources for the [n] markers the answer uses, keeping only quotes found verbatim in their segment."""
    cited = sorted({int(match) for match in CITATION.findall(answer)})
    sources = []
    for number in cited:
        if not 1 <= number <= len(excerpts):
            continue
        excerpt = excerpts[number - 1]
        if not is_verbatim(excerpt.text, excerpt.segment_text):
            continue
        sources.append(
            {
                "index": number,
                "documentId": excerpt.document_id,
                "documentName": excerpt.document_name,
                "page": excerpt.page,
                "location": excerpt.location,
                "quote": excerpt.text,
            }
        )
    return sources
