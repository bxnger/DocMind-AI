"""Production and purchasing: parts of a technical document, photo of a marking, price lists, offers, the purchase sheet.

Contract: docs/API-PROCUREMENT.md (revision 2). Money is computed by code (app.pricing), never by the AI.
"""

import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.auth import Session, limited
from app.deps import get_answerer, get_store
from app.errors import AppError
from app.llm import LlmAuthFailed, LlmMisconfigured, LlmRateLimited, LlmTimeout, LlmUnavailable
from app.parts import CATEGORIES, KIND as PART_LIST, empty_list, filtered, find_part, run_extraction
from app.pricing import (
    MAX_PRICE_LIST_BYTES, MAX_PRICE_LISTS, MAX_QUANTITY, calculate, export_rows, find_offer, new_price_list,
    offer_from, offers_for, public_price_list, to_csv, to_xlsx,
)
from app.sitecheck import allowed_domains, check_offer
from app.store import Store
from app.vision import MAX_IMAGE_BYTES, PROMPT as PHOTO_PROMPT, identify, image_type, is_json_object, recognized_from

router = APIRouter(tags=["procurement"])
logger = logging.getLogger("app.procurement")

PRICE_LIST = "price_list"
CONFIRMATION = "confirmation"
MAX_CHECKS = 10
CHECK_WORKERS = 4
CAMEL = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class StartParts(BaseModel):
    model_config = CAMEL
    category: Literal[CATEGORIES] | None = None  # type: ignore[valid-type]
    language: Literal["kk", "ru", "en"] | None = None


class ConfirmPart(BaseModel):
    model_config = CAMEL
    recognized_text: str = Field(default="", max_length=500)
    recognized_part_number: str | None = Field(default=None, max_length=80)
    decision: Literal["confirmed", "rejected"]


class OffersRequest(BaseModel):
    model_config = CAMEL
    document_id: str
    part_ids: list[str] = Field(min_length=1, max_length=200)


class CheckOffers(BaseModel):
    model_config = CAMEL
    offer_ids: list[str] = Field(min_length=1, max_length=MAX_CHECKS)


class QuoteItem(BaseModel):
    model_config = CAMEL
    part_id: str
    quantity: int | None = Field(default=None, gt=0, le=MAX_QUANTITY)
    offer_id: str | None = Field(default=None, max_length=80)
    confirmation_id: str | None = Field(default=None, max_length=40)


class QuoteRequest(BaseModel):
    model_config = CAMEL
    document_id: str
    items: list[QuoteItem] = Field(min_length=1, max_length=200)


def ready_document(store: Store, document_id: str, owner_id: str) -> dict:
    doc = store.get(document_id, owner_id)
    if doc["status"] != "ready":
        raise AppError(409, "DOCUMENT_NOT_READY", "Document is still being processed")
    return doc


def budget(request: Request, store: Store, session: Session):
    settings = request.app.state.settings

    def reserve() -> None:
        if settings.ai_emergency_stop:
            raise AppError(429, "AI_BUDGET_EXCEEDED", "AI answers are switched off for now")
        store.reserve_ai_request(
            session.owner_id, session.client_key, settings.ai_session_daily_limit,
            settings.ai_client_daily_limit, settings.ai_global_daily_limit,
        )

    return reserve


def ready_parts(store: Store, document_id: str, owner_id: str) -> dict:
    record = store.get_record(PART_LIST, document_id, owner_id)
    if record is None:
        raise AppError(404, "PARTS_NOT_STARTED", "Parts have not been extracted from this document yet")
    if record["status"] != "ready":
        raise AppError(409, "PARTS_NOT_READY", "Parts of this document are still being extracted")
    return record


# Parts ---------------------------------------------------------------------------------------------------------------

@router.post("/documents/{document_id}/parts", status_code=202)
def start_parts(
    document_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    body: StartParts | None = None,
    store: Store = Depends(get_store),
    answerer=Depends(get_answerer),
    session: Session = Depends(limited("compare")),
) -> dict:
    doc = ready_document(store, document_id, session.owner_id)
    existing = store.get_record(PART_LIST, document_id, session.owner_id)
    if existing is not None and existing["status"] != "failed":
        return filtered(existing)
    body = body or StartParts()
    record = empty_list(document_id, body.category)
    store.put_record(PART_LIST, document_id, session.owner_id, record, document_id=document_id)
    background_tasks.add_task(
        run_extraction, store, answerer, doc, session.owner_id, record, body.language, budget(request, store, session)
    )
    return filtered(record)


@router.get("/documents/{document_id}/parts")
def get_parts(document_id: str, store: Store = Depends(get_store), session: Session = Depends(limited("read"))) -> dict:
    store.get(document_id, session.owner_id)
    record = store.get_record(PART_LIST, document_id, session.owner_id)
    if record is None:
        raise AppError(404, "PARTS_NOT_STARTED", "Parts have not been extracted from this document yet")
    return filtered(record)


# Photo of a marking --------------------------------------------------------------------------------------------------

@router.post("/documents/{document_id}/parts/identify")
async def identify_part(
    document_id: str,
    request: Request,
    image: UploadFile = File(...),
    language: Literal["kk", "ru", "en"] | None = Form(default=None),
    store: Store = Depends(get_store),
    answerer=Depends(get_answerer),
    session: Session = Depends(limited("chat")),
) -> dict:
    ready_document(store, document_id, session.owner_id)
    record = ready_parts(store, document_id, session.owner_id)
    data = await image.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise AppError(413, "IMAGE_TOO_LARGE", "The photo is larger than 8 MB")
    mime = image_type(data)
    if answerer is None or not getattr(answerer, "vision", False):
        raise AppError(503, "VISION_UNAVAILABLE", "Photo recognition needs the Gemini model", retryable=False)
    budget(request, store, session)()
    try:
        answer = await answerer.complete_json(PHOTO_PROMPT, image=data, mime_type=mime)
        if not is_json_object(answer):
            # Found live: once in a few runs the answer was not JSON and a clear photo came back "unreadable".
            logger.warning("photo identify: the answer was not JSON, asking once more")
            answer = await answerer.complete_json(PHOTO_PROMPT, image=data, mime_type=mime)
    except LlmRateLimited:
        raise AppError(429, "RATE_LIMITED", "The AI provider's rate limit was reached", retryable=True)
    except LlmTimeout:
        raise AppError(504, "LLM_TIMEOUT", "The AI model timed out", retryable=True)
    except (LlmAuthFailed, LlmMisconfigured):
        raise AppError(503, "VISION_UNAVAILABLE", "Photo recognition is not configured correctly")
    except LlmUnavailable:
        raise AppError(503, "VISION_UNAVAILABLE", "Photo recognition is unavailable", retryable=True)
    finally:
        del data  # the photo is not kept
    result = identify(record["parts"], recognized_from(answer), language)
    recognized = result["recognized"]
    logger.info("photo identify status=%s readability=%s type=%s/%s issues=%s matches=%d", result["matchStatus"],
                recognized["readability"], recognized["partType"], recognized["confidence"], recognized["issues"],
                len(result["matches"]))
    return result


@router.post("/documents/{document_id}/parts/{part_id}/confirmations", status_code=201)
def confirm_part(
    document_id: str, part_id: str, body: ConfirmPart,
    store: Store = Depends(get_store), session: Session = Depends(limited("read")),
) -> dict:
    store.get(document_id, session.owner_id)
    part = find_part(store.get_record(PART_LIST, document_id, session.owner_id), part_id)
    if part is None:
        raise AppError(404, "PART_NOT_FOUND", "No such part in this document")
    confirmation = {
        "id": f"c{store.new_id()[:12]}", "partId": part_id, "documentId": document_id, "decision": body.decision,
        "recognizedText": body.recognized_text.strip(), "recognizedPartNumber": body.recognized_part_number,
        "documentPartNumber": part["partNumber"], "confirmedBy": "user", "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    store.put_record(CONFIRMATION, confirmation["id"], session.owner_id, confirmation, document_id=document_id)
    return confirmation


@router.get("/documents/{document_id}/parts/{part_id}/confirmations")
def list_confirmations(
    document_id: str, part_id: str, store: Store = Depends(get_store), session: Session = Depends(limited("read"))
) -> dict:
    store.get(document_id, session.owner_id)
    items = [c for c in store.list_records(CONFIRMATION, session.owner_id, document_id) if c["partId"] == part_id]
    return {"items": items}


# Price lists ---------------------------------------------------------------------------------------------------------

@router.post("/price-lists", status_code=201)
async def upload_price_list(
    file: UploadFile = File(...),
    supplier: str | None = Form(default=None, max_length=120),
    currency: str | None = Form(default=None, max_length=8),
    checked_at: str | None = Form(default=None, alias="checkedAt", max_length=20),
    demo: bool = Form(default=False),
    store: Store = Depends(get_store),
    session: Session = Depends(limited("upload")),
) -> dict:
    if store.count_records(PRICE_LIST, session.owner_id) >= MAX_PRICE_LISTS:
        raise AppError(429, "LIMIT_REACHED", f"At most {MAX_PRICE_LISTS} price lists per session")
    data = await file.read(MAX_PRICE_LIST_BYTES + 1)
    if len(data) > MAX_PRICE_LIST_BYTES:
        raise AppError(413, "PRICE_LIST_TOO_LARGE", "The price list is larger than 5 MB")
    record = new_price_list(f"pl{store.new_id()[:10]}", file.filename or "price.csv", data, supplier, currency, checked_at, demo)
    store.put_record(PRICE_LIST, record["id"], session.owner_id, record)
    return public_price_list(record)


@router.get("/price-lists")
def list_price_lists(store: Store = Depends(get_store), session: Session = Depends(limited("read"))) -> dict:
    return {"items": [public_price_list(record) for record in store.list_records(PRICE_LIST, session.owner_id)]}


@router.delete("/price-lists/{price_list_id}", status_code=204, response_class=Response)
def delete_price_list(price_list_id: str, store: Store = Depends(get_store), session: Session = Depends(limited("read"))) -> Response:
    if not store.delete_record(PRICE_LIST, price_list_id, session.owner_id):
        raise AppError(404, "PRICE_LIST_NOT_FOUND", "No such price list")
    return Response(status_code=204)


# Offers and the purchase sheet ---------------------------------------------------------------------------------------

@router.post("/procurement/offers")
def procurement_offers(body: OffersRequest, store: Store = Depends(get_store), session: Session = Depends(limited("read"))) -> dict:
    store.get(body.document_id, session.owner_id)
    record = ready_parts(store, body.document_id, session.owner_id)
    price_lists = store.list_records(PRICE_LIST, session.owner_id)
    items = []
    for part_id in body.part_ids:
        part = find_part(record, part_id)
        if part is None:
            raise AppError(404, "PART_NOT_FOUND", f"No part {part_id[:20]} in this document")
        offers, similar = offers_for(part, price_lists)
        items.append({"partId": part_id, "partNumber": part["partNumber"], "offers": offers, "similar": similar})
    return {"items": items}


@router.post("/procurement/offers/check")
def check_offers(body: CheckOffers, store: Store = Depends(get_store), session: Session = Depends(limited("compare"))) -> dict:
    """Read each offer's price on the supplier's page (app.sitecheck). The result is kept on the price list row, so
    later offers and quotes use it; a failed check keeps the file's price and says why."""
    price_lists = store.list_records(PRICE_LIST, session.owner_id)
    targets = []
    for offer_id in dict.fromkeys(body.offer_ids):
        found = find_offer(offer_id, price_lists)
        if found is None:
            raise AppError(404, "OFFER_NOT_FOUND", f"No offer {offer_id[:40]}")
        targets.append((offer_id, *found))
    domains = allowed_domains()

    def run(target):
        _offer_id, price_list, row = target
        if price_list["demo"]:
            return {"status": "failed", "reason": "demo_price_list", "price": None, "currency": None,
                    "stockStatus": "unknown", "checkedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "url": None}
        return check_offer(row["url"], row["partNumber"], domains)

    with ThreadPoolExecutor(max_workers=CHECK_WORKERS) as pool:
        results = list(pool.map(run, targets))
    changed = {}
    items = []
    for (offer_id, price_list, row), result in zip(targets, results):
        row["siteCheck"] = result
        changed[price_list["id"]] = price_list
        logger.info("price check %s status=%s reason=%s", offer_id, result["status"], result["reason"])
        offer = offer_from(price_list, row, "exact")  # the match to a part is not known here: only price fields are sent
        items.append({"offerId": offer_id, "siteCheck": result, "priceOrigin": offer["priceOrigin"],
                      "price": offer["price"], "currency": offer["currency"], "filePrice": offer["filePrice"]})
    for price_list in changed.values():
        store.put_record(PRICE_LIST, price_list["id"], session.owner_id, price_list)
    return {"items": items}


def build_quote(body: QuoteRequest, store: Store, owner_id: str) -> dict:
    store.get(body.document_id, owner_id)
    record = ready_parts(store, body.document_id, owner_id)
    price_lists = store.list_records(PRICE_LIST, owner_id)
    confirmations = store.list_records(CONFIRMATION, owner_id, body.document_id)
    items, warnings = [], []
    for request_item in body.items:
        part = find_part(record, request_item.part_id)
        if part is None:
            raise AppError(404, "PART_NOT_FOUND", f"No part {request_item.part_id[:20]} in this document")
        quantity = request_item.quantity or part["quantity"] or 1
        offer, status, match_warning = None, "no_price", False
        if request_item.offer_id:
            found = find_offer(request_item.offer_id, price_lists)
            kind = None
            if found:
                from app.pricing import offer_from, row_match

                kind = row_match(part["partNumber"], found[1]) if part["partNumber"] else None
                if kind in ("exact", "close"):
                    offer = offer_from(found[0], found[1], kind)
            if offer is not None and offer["price"] is None:
                warnings.append(f"{part['partNumber'] or part['name']}: у выбранного предложения {offer['supplier']} нет прочитанной цены")
                offer, status = None, "no_price"
            elif offer is None:
                status = "offer_missing"
                warnings.append(f"{part['partNumber'] or part['name']}: предложение {request_item.offer_id} недоступно (прайс удалён или не подходит)")
            else:
                status, match_warning = "priced", kind == "close"
                if match_warning:
                    warnings.append(f"{part['partNumber']}: выбран похожий артикул {offer['partNumber']}, проверьте совместимость")
        chosen = next((c for c in confirmations if c["id"] == request_item.confirmation_id and c["partId"] == part["id"]), None)
        if chosen is None and request_item.confirmation_id is None:
            chosen = next((c for c in reversed(confirmations) if c["partId"] == part["id"]), None)
        identification = {
            "status": {"confirmed": "user_confirmed", "rejected": "user_rejected"}[chosen["decision"]] if chosen else "document_only",
            "confirmationId": chosen["id"] if chosen else None,
        }
        items.append({
            "partId": part["id"], "name": part["name"], "partNumber": part["partNumber"], "quantity": quantity,
            "unit": part["unit"] or "шт", "offer": offer, "unitPrice": offer["price"] if offer else None,
            "currency": offer["currency"] if offer else None, "lineTotal": None, "status": status,
            "matchWarning": match_warning, "identification": identification, "_sources": part["sources"],
        })
    items, totals, unpriced = calculate(items)
    demo_priced = sum(1 for item in items if item["status"] == "priced" and (item["offer"] or {}).get("demo"))
    if demo_priced:
        warnings.append(f"{demo_priced} поз. с ценами DEMO: цены придуманы для показа, по ним нельзя закупать")
    if unpriced:
        warnings.append(f"{unpriced} поз. без цены не входят в итог")
    if len(totals) > 1:
        warnings.append("Цены в разных валютах: итог посчитан по каждой валюте отдельно, без конвертации")
    return {"items": items, "totals": totals, "unpriced": unpriced, "warnings": warnings,
            "calculatedAt": datetime.now(timezone.utc).isoformat()}


def public_quote(quote: dict) -> dict:
    return {**quote, "items": [{k: v for k, v in item.items() if not k.startswith("_")} for item in quote["items"]]}


@router.post("/procurement/quote")
def procurement_quote(body: QuoteRequest, store: Store = Depends(get_store), session: Session = Depends(limited("read"))) -> dict:
    return public_quote(build_quote(body, store, session.owner_id))


@router.post("/procurement/quote/export", response_class=Response)
def export_quote(
    body: QuoteRequest,
    format: Literal["xlsx", "csv"] = Query(default="xlsx"),
    store: Store = Depends(get_store),
    session: Session = Depends(limited("read")),
) -> Response:
    quote = build_quote(body, store, session.owner_id)
    for item in quote["items"]:
        item["sources"] = item.pop("_sources")
    rows = export_rows(quote)
    if format == "csv":
        content, media = to_csv(rows), "text/csv; charset=utf-8"
    else:
        content, media = to_xlsx(rows), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    return Response(content, media_type=media, headers={"Content-Disposition": f'attachment; filename="docmind-purchase.{format}"'})
