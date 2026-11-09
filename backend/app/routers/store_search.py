"""Store search and barcodes (contract: docs/STORE-SEARCH-API.md). Only additions: the procurement endpoints are unchanged.

What the search finds in the shops is kept as one price list of the session (kind "store_catalog"), so the existing
/procurement/offers, /offers/check, /quote and /quote/export work with those offers as they are.
"""

from datetime import datetime, timezone
from typing import Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from app.auth import Session, limited
from app.barcodes import classify, decode_image, find_part_number, gtin_key
from app.codes import code_base, normalize_code
from app.deps import get_store
from app.errors import AppError
from app.parts import find_part
from app.pricing import STORE_CATALOG, by_price, offer_from, offers_for, row_match
from app.routers.procurement import CAMEL, PRICE_LIST, ready_parts
from app.sitecheck import CheckFailed
from app.store import Store
from app.stores import enabled_stores
from app.vision import MAX_IMAGE_BYTES, image_type

router = APIRouter(tags=["procurement"])

MAX_STORE_ROWS = 500
MAX_CODES = 5


class SearchRequest(BaseModel):
    model_config = CAMEL
    query: str | None = Field(default=None, max_length=200)
    kind: Literal["partNumber", "name", "barcode"] = "partNumber"
    document_id: str | None = Field(default=None, max_length=40)
    part_id: str | None = Field(default=None, max_length=40)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def catalog_of(request: Request):
    return request.app.state.catalog


def own_price_lists(store: Store, owner_id: str) -> list[dict]:
    return [pl for pl in store.list_records(PRICE_LIST, owner_id) if pl.get("kind") != STORE_CATALOG]


def store_list(store: Store, owner_id: str) -> dict:
    """The session's price list that keeps what the store search found."""
    for price_list in store.list_records(PRICE_LIST, owner_id):
        if price_list.get("kind") == STORE_CATALOG:
            return price_list
    now = datetime.now(timezone.utc)
    return {"id": f"pls{store.new_id()[:9]}", "kind": STORE_CATALOG, "supplier": "Магазины (поиск на сайтах)",
            "fileName": "", "rows": 0, "skipped": [], "checkedAt": now.date().isoformat(), "checkedAtOrigin": "site",
            "demo": False, "importedAt": now.isoformat(), "_rows": []}


def keep_store_results(store: Store, owner_id: str, results: list[dict]) -> list[tuple[dict, dict, str]]:
    """Saves the confirmed store results (exact / close) as rows; the same page found again updates its own row."""
    kept = [result for result in results if result["match"] in ("exact", "close")]
    if not kept:
        return []
    price_list = store_list(store, owner_id)
    rows = price_list["_rows"]
    by_url = {row["url"]: row for row in rows}
    next_row = max((row["row"] for row in rows), default=0) + 1
    out = []
    for result in kept:
        check = result["check"]
        row = by_url.get(result["url"])
        if row is None:
            row = {"row": next_row}
            next_row += 1
            rows.append(row)
            by_url[result["url"]] = row
        row.update({
            "partNumber": result["partNumber"], "title": result["title"], "price": check["price"],
            "currency": check["currency"], "stockStatus": check["stockStatus"], "stockQuantity": None,
            "url": result["url"], "supplier": result["store"], "checkedAt": None, "manufacturer": None,
            "sameSellerAs": result["sameSellerAs"], "siteCheck": check,
        })
        out.append((price_list, row, result["match"]))
    del rows[:-MAX_STORE_ROWS]
    price_list["rows"] = len(rows)
    store.put_record(PRICE_LIST, price_list["id"], owner_id, price_list)
    return out


def unconfirmed_offer(result: dict) -> dict:
    """A page the search opened but could not confirm as the part asked for. Not kept, so it cannot be chosen."""
    check = result["check"]
    read = check["status"] == "checked"
    return {"id": None, "source": STORE_CATALOG, "store": result["store"], "supplier": result["store"],
            "title": result["title"], "partNumber": result["partNumber"], "match": "unconfirmed",
            "price": check["price"] if read else None, "currency": check["currency"] if read else None,
            "stockStatus": check["stockStatus"] if read else "unknown", "url": result["url"],
            "checkedAt": check["checkedAt"] if read else None, "priceOrigin": "site_checked" if read else None,
            "reason": check["reason"], "demo": False, "sameSellerAs": result["sameSellerAs"]}


def result_body(query: str, kind: str, searched_as: str | None = None, reason: str | None = None) -> dict:
    return {"query": query, "searchedAs": searched_as, "normalized": normalize_code(searched_as) if searched_as else None,
            "kind": kind, "offers": [], "similar": [], "unconfirmed": [], "sources": [], "reason": reason,
            "searchedAt": now_iso()}


def run_search(query: str, kind: str, store: Store, owner_id: str, catalog) -> dict:
    """Offers for a part number (or a name with one in it, or a plain name) from the user's price lists and the shops."""
    searched_as, mode = query, "partNumber"
    if kind == "name":
        found = find_part_number(query)
        searched_as, mode = (found, "partNumber") if found else (query, "name")
    body = result_body(query, kind, searched_as if mode == "partNumber" else None)
    if mode == "partNumber":
        own_exact, own_similar = offers_for({"partNumber": searched_as}, own_price_lists(store, owner_id))
        body["offers"] += own_exact
        body["similar"] += own_similar
        body["sources"].append({"store": "price_lists", "status": "ok", "candidates": len(own_exact) + len(own_similar)})
    if enabled_stores():
        found = catalog.search(searched_as, mode)
        body["sources"] += found["sources"]
        for price_list, row, match in keep_store_results(store, owner_id, found["results"]):
            body["offers" if match == "exact" else "similar"].append(offer_from(price_list, row, match))
        body["unconfirmed"] += [unconfirmed_offer(r) for r in found["results"] if r["match"] == "unconfirmed"]
    body["offers"].sort(key=by_price)
    body["similar"].sort(key=by_price)
    return body


@router.post("/procurement/search")
def search_offers(body: SearchRequest, request: Request, store: Store = Depends(get_store),
                  session: Session = Depends(limited("search"))) -> dict:
    query = (body.query or "").strip()
    if body.part_id:
        if not body.document_id:
            raise AppError(422, "VALIDATION_ERROR", "partId needs documentId")
        store.get(body.document_id, session.owner_id)
        part = find_part(ready_parts(store, body.document_id, session.owner_id), body.part_id)
        if part is None:
            raise AppError(404, "PART_NOT_FOUND", f"No part {body.part_id[:20]} in this document")
        query = query or (part["partNumber"] or "")
    if len(query) < 2:
        raise AppError(422, "VALIDATION_ERROR", "query needs at least 2 characters (or a part that has a part number)")
    if body.kind == "barcode":
        code = classify(query, "text")
        return {"codes": [code], "lookup": lookup_code(code, store, session.owner_id, catalog_of(request))}
    return run_search(query, body.kind, store, session.owner_id, catalog_of(request))


def lookup_code(code: dict, store: Store, owner_id: str, catalog) -> dict:
    """What a decoded code leads to. A GTIN is looked up only where barcodes really are; nothing is guessed from it."""
    value, kind = code["value"], code["kind"]
    if kind == "gtin":
        if not code["valid"]:
            return result_body(value, "barcode", reason="checksum_failed")
        offers = [offer_from(pl, row, "exact") for pl in own_price_lists(store, owner_id) for row in pl["_rows"]
                  if row.get("barcode") and gtin_key(row["barcode"]) == gtin_key(value)]
        body = result_body(value, "barcode", reason=None if offers else "gtin_not_in_sources")
        body["offers"] = sorted(offers, key=by_price)
        body["sources"] = [{"store": "price_lists", "status": "ok", "candidates": len(offers)},
                           *({"store": domain, "status": "skipped", "reason": "no_barcodes_published", "candidates": 0}
                             for domain in enabled_stores())]
        return body
    if kind == "url":
        host = (urlsplit(value).hostname or "").lower()
        domain = next((d for d in enabled_stores() if host == d or host.endswith("." + d)), None)
        if domain is None:
            return result_body(value, "url", reason="domain_not_allowed" if enabled_stores() else "store_search_off")
        return product_by_link(value, domain, store, owner_id, catalog)
    if kind == "partNumber":
        return run_search(value, "partNumber", store, owner_id, catalog)
    found = find_part_number(value)
    if found:
        return run_search(found, "partNumber", store, owner_id, catalog)
    return result_body(value, "text", reason="not_a_product_code")


def product_by_link(url: str, domain: str, store: Store, owner_id: str, catalog) -> dict:
    """A QR code with a link to a product page of a shop on the list: that page is the offer, with its own part number."""
    body = result_body(url, "url")
    body["sources"] = [{"store": domain, "status": "ok", "candidates": 1}]
    try:
        with catalog.slot():
            _final, products, _read_at = catalog.read_page(url, domain)
    except CheckFailed as failure:
        body["reason"] = failure.reason
        body["sources"][0].update(status="unavailable", reason=failure.reason)
        return body
    code = page_part_number(products)
    if code is None:
        body["reason"] = "part_number_not_on_page"
        return body
    result = catalog.judge_page(url, domain, code, "partNumber")
    body.update(searchedAs=code, normalized=normalize_code(code))
    for price_list, row, match in keep_store_results(store, owner_id, [result]):
        body["offers"].append(offer_from(price_list, row, match))
    if not body["offers"]:
        body["unconfirmed"].append(unconfirmed_offer(result))
    return body


def page_part_number(products: list[dict]) -> str | None:
    """The part number a product page shows people: a code written in the product name. A shop's own stock number
    (bcindustry.kz: sku "20285" for 6205-2RSH) is not in the name, so it is never taken for the part number."""
    for product in products:
        for code in product["codes"]:
            if code_base(code) and row_match(code, {"partNumber": None, "title": product["name"]}) == "exact":
                return code
    return None


@router.post("/procurement/barcodes")
async def read_codes(
    request: Request,
    image: UploadFile | None = File(default=None),
    text: str | None = Form(default=None, max_length=500),
    store: Store = Depends(get_store),
    session: Session = Depends(limited("search")),
) -> dict:
    if image is not None:
        data = await image.read(MAX_IMAGE_BYTES + 1)
        if len(data) > MAX_IMAGE_BYTES:
            raise AppError(413, "IMAGE_TOO_LARGE", "The photo is larger than 8 MB")
        image_type(data)
        decoded = await run_in_threadpool(decode_image, data)
        if not decoded:
            raise AppError(422, "BARCODE_NOT_FOUND", "No EAN-13, EAN-8, UPC-A or QR code was found on the photo")
    elif text and text.strip():
        decoded = [{"format": "text", "value": text}]
    else:
        raise AppError(422, "VALIDATION_ERROR", "Send an image or a text")
    codes = [classify(item["value"], item["format"]) for item in decoded[:MAX_CODES]]
    lookup = await run_in_threadpool(lookup_code, codes[0], store, session.owner_id, catalog_of(request))
    return {"codes": codes, "lookup": lookup}
