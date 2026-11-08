"""Check a statement against the documents of a conversation: supported, partly, contradicted or not in the documents.

The same pipeline as the chat (search, translation for another language, the budget, the verification of every
quote), but one JSON answer instead of a stream, and nothing is added to the chat history.
"""

import logging
import re
import time
from contextlib import aclosing

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel
from typing import Literal

from app.auth import Session, limited
from app.deps import get_answerer, get_store
from app.errors import AppError
from app.llm import Answerer, LlmAuthFailed, LlmMisconfigured, LlmRateLimited, LlmTimeout, LlmUnavailable
from app.routers.conversations import select_chunks, to_excerpts, verify_answer, normalize_markers
from app.store import Store
from app.translate import query_language, search_translation

router = APIRouter(prefix="/conversations", tags=["claims"])
logger = logging.getLogger("app.claims")

MAX_CLAIM_CHARS = 1000
VERDICTS = {"SUPPORTED": "supported", "PARTLY": "partly", "CONTRADICTED": "contradicted", "NOT_FOUND": "not_found"}
FIRST_WORD = re.compile(r"^\W*([A-Za-z_]+)")

INSTRUCTION = (
    "Check the statement below against the excerpts. Reply in exactly this form. First line: one word. "
    "SUPPORTED when an excerpt says the same. "
    "CONTRADICTED when an excerpt states a different value for the very same thing (a different number, date, name or "
    "condition): the excerpt must contain that other value. "
    "PARTLY instead of CONTRADICTED when the statement joins two or more values (\"A is 2, and B is 3\") and at least one "
    "of them is right. Where a value is (the part, the place) is not a value of its own: \"in the gearbox there are 2 "
    "bearings\" when the excerpt says 4 is CONTRADICTED. "
    "NOT_FOUND when the excerpts do not state the thing the statement is about, even if they mention related topics: a "
    "missing price, number, date or name is NOT_FOUND, never CONTRADICTED. "
    "Second line (not for NOT_FOUND): one or two sentences naming the exact value the excerpts give, each followed by the "
    "excerpt number in square brackets, like [1]. Do not repeat the statement. Statement: "
)


class CheckClaim(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    claim: str = Field(max_length=MAX_CLAIM_CHARS)
    language: Literal["kk", "ru", "en"] | None = None


def parse_verdict(answer: str) -> tuple[str, str]:
    """("supported" | "partly" | "contradicted" | "not_found", the explanation). Anything unclear is not_found."""
    text = answer.strip()
    found = FIRST_WORD.match(text)
    verdict = VERDICTS.get(found.group(1).upper()) if found else None
    if verdict is None:
        return "not_found", ""
    return verdict, text[found.end():].strip(" \n:-—*")


@router.post("/{conversation_id}/verify")
async def check_claim(
    conversation_id: str,
    body: CheckClaim,
    request: Request,
    store: Store = Depends(get_store),
    answerer: Answerer | None = Depends(get_answerer),
    session: Session = Depends(limited("chat")),
) -> dict:
    claim = " ".join(body.claim.split())
    if not claim:
        raise AppError(422, "EMPTY_MESSAGE", "The statement is empty")
    conversation = store.get_conversation(conversation_id, session.owner_id)
    for document_id in conversation["documentIds"]:
        if store.get(document_id)["status"] != "ready":
            raise AppError(409, "DOCUMENT_NOT_READY", "A document in this conversation is not ready")
    if answerer is None:
        raise AppError(503, "LLM_UNAVAILABLE", "The AI model is not configured", retryable=True)

    settings = request.app.state.settings
    if settings.ai_emergency_stop:
        raise AppError(429, "AI_BUDGET_EXCEEDED", "AI answers are switched off for now")
    store.reserve_ai_request(
        session.owner_id, session.client_key, settings.ai_session_daily_limit,
        settings.ai_client_daily_limit, settings.ai_global_daily_limit,
    )

    started = time.monotonic()
    chunks = store.chunks_for_documents(conversation["documentIds"])
    document_languages = [store.get(document_id)["language"] for document_id in conversation["documentIds"]]
    translated, _targets, _ms = await search_translation(answerer, claim, document_languages)
    picked, _overview = select_chunks(claim, [], chunks, translated)
    language = body.language or query_language(claim)
    if not picked:
        logger.info("claim not_found reason=no_matching_excerpt chunks=%d", len(chunks))
        return {"verdict": "not_found", "explanation": "", "sources": [], "reason": "no_matching_excerpt"}

    excerpts = to_excerpts(picked, False)
    answer = ""
    try:
        async with aclosing(answerer.stream(INSTRUCTION + claim, excerpts, language, [])) as pieces:
            async for piece in pieces:
                answer += piece
    except LlmTimeout:
        raise AppError(504, "LLM_TIMEOUT", "The AI model timed out", retryable=True)
    except LlmRateLimited:
        raise AppError(429, "RATE_LIMITED", "The AI provider's rate limit was reached", retryable=True)
    except (LlmAuthFailed, LlmMisconfigured):
        raise AppError(503, "LLM_UNAVAILABLE", "The AI provider is not configured correctly")
    except LlmUnavailable:
        raise AppError(503, "LLM_UNAVAILABLE", "The AI model is unavailable", retryable=True)

    verdict, explanation = parse_verdict(answer)
    reason = None
    sources: list[dict] = []
    text = ""
    if verdict != "not_found":
        # The same check as in the chat: a sentence its sources do not support is dropped; with nothing left the
        # verdict cannot be shown as proven.
        text, sources = verify_answer(explanation, excerpts, store, claim)
        if not sources:
            verdict, reason = "not_found", "citations_failed_verification"
    else:
        reason = "model_refused"
    logger.info("claim %s ms=%d excerpts=%d sources=%d", verdict, (time.monotonic() - started) * 1000, len(excerpts), len(sources))
    result = {"verdict": verdict, "explanation": normalize_markers(text) if verdict != "not_found" else "", "sources": sources}
    if reason and verdict == "not_found":
        result["reason"] = reason
    return result
