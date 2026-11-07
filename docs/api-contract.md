# DOCMIND Procurement: API contract

**Status: draft for review by the backend owner (Erasyl). Not implemented on the backend yet.**
The frontend is built against this text. Routes and JSON field names change only by agreement, in a commit of their own.
The rest of the API is described in `backend/docs/api-contract.md`, and nothing in it changes.

Base `/api/v1`. All routes need `Authorization: Bearer <token>`. Someone else's id gives 404. Errors use the existing `{ "error": { code, message, retryable, requestId } }` body, and 429 has `Retry-After`.

## Principles

- A part exists only with a verbatim quote from the document. A quote that fails verification drops the part and is counted in `warnings`.
- `quantity` is never guessed. If the document doesn't state it, it is `null`.
- A status is computed by plain code from text a person confirmed. A model only proposes that text.
- A price exists only as a row of an uploaded price list. Nothing is filled in by a model.
- No external shop APIs, no automatic orders, no interchangeability claims.
- Amounts are decimal strings. Currencies are never converted, and each has its own total.

## Availability

`GET /capabilities` gains `procurement: boolean`. The frontend calls these routes only when it is `true`. Until then it uses a mock labelled as demonstration data.

## Parts

`POST /documents/{id}/parts` extracts, or returns what was already extracted (idempotent). `GET` returns the same, 404 `PARTS_NOT_EXTRACTED` before the first POST. 409 `DOCUMENT_NOT_READY`.

```json
{
  "documentId": "d1",
  "items": [{
    "id": "p1",
    "rawCode": "SKF 6205-2RS1",
    "normalizedCode": "62052RS1",
    "brand": "SKF",
    "description": "Подшипник шариковый",
    "quantity": 2,
    "unit": "шт",
    "quantityStatus": "found",
    "quantitySource": "document",
    "included": true,
    "note": "",
    "page": 14,
    "location": null,
    "paragraph": null,
    "quote": "Подшипник SKF 6205-2RS1 — 2 шт.",
    "highlights": [{ "x": 0.12, "y": 0.4, "w": 0.5, "h": 0.02 }],
    "extraction": "pattern"
  }],
  "warnings": [{ "code": "QUOTE_NOT_VERIFIED", "count": 1 }]
}
```

- `quantityStatus`: `found | missing`. `quantitySource`: `document | user`. `extraction`: `pattern | table | model`.
- PDF: `page` set, `location` and `paragraph` null. DOCX: `page` null, `paragraph` is the block index in `/documents/{id}/text`, `location` the section.

`PATCH /parts/{id}` with any of `{ "quantity": 3, "included": false, "note": "..." }` returns the part. Changing `quantity` sets `quantitySource: "user"`. `quote` and `page` never change.

## Markings

`POST /documents/{id}/markings`, multipart `file`: JPEG, PNG or WebP, up to 8 MB. 415 `IMAGE_INVALID`, 413 `FILE_TOO_LARGE`. EXIF is removed.

```json
{
  "id": "m1",
  "readText": "SKF 6205-2RS1",
  "readBy": "model",
  "confirmed": false,
  "confirmedText": null,
  "status": null,
  "matchedPartId": null,
  "candidates": [],
  "imageUrl": "/api/v1/markings/m1/image"
}
```

`readText` and `readBy` are null when the marking can't be read: that is a normal answer, and the person types it. `status` stays null until confirmation.

`POST /markings/{id}/confirm` with `{ "text": "SKF 6205-2RS1" }` returns the same object with `confirmed: true` and:

```json
{
  "status": "conflict",
  "matchedPartId": "p1",
  "candidates": [{ "partId": "p1", "status": "conflict", "differences": [{ "document": "2RS1", "marking": "ZZ" }] }]
}
```

`GET /markings/{id}/image` returns the image.

### Status rules

Normalization: upper case, Cyrillic look-alikes to Latin, no spaces or `- . / _`. A leading brand word is compared separately.

| Status | Rule |
|---|---|
| `exact` | Whole code equal, brands don't differ |
| `possible` | One code is the start of the other (at least 3 characters), or they differ only in look-alikes `O/0 I/1 L/1 S/5 B/8` |
| `conflict` | Both complete and different with the same base or at most 2 edits apart, or different brands |
| `insufficient` | Under 3 characters, or no candidate |

Test vectors, document `SKF 6205-2RS1`:

| Marking | Status |
|---|---|
| `SKF 6205-2RS1`, `6205 2RS1`, `6205-2РС1` | `exact` |
| `6205` | `possible` |
| `62O5-2RS1` | `possible` |
| `6205-2RS1/C3` | `possible` |
| `6205-ZZ`, `6206-2RS1` | `conflict` |
| `FAG 6205-2RS1` | `conflict` |
| `62`, empty, `XYZ-999` | `insufficient` |

## Price lists

`POST /price-lists`, multipart `file` (CSV or XLSX, up to 5 MB, 20 000 rows), `supplier`, `sourceNote`. 422 `PRICE_LIST_INVALID`, 413 `PRICE_LIST_TOO_LARGE`. `GET /price-lists` returns `{ items }`.

Columns: `sku`, `price`, `currency`, `checked_at` (ISO date) are required; `brand`, `name`, `stock`, `url` are optional.

```json
{
  "id": "pl1",
  "fileName": "supplier.xlsx",
  "supplier": "Поставщик",
  "sourceNote": "",
  "uploadedAt": "2026-11-13T09:00:00Z",
  "rowCount": 1240,
  "skippedRows": [{ "row": 17, "reason": "PRICE_INVALID" }]
}
```

## Procurement sheet

`GET /documents/{id}/procurement?priceListId=pl1` (`priceListId` optional):

```json
{
  "items": [{
    "partId": "p1",
    "markingStatus": "exact",
    "markingId": "m1",
    "selectedOfferId": "o1",
    "lineTotal": "9000.00",
    "offers": [{
      "id": "o1",
      "priceListId": "pl1",
      "supplier": "Поставщик",
      "sku": "6205-2RS1",
      "sourceRow": 412,
      "unitPrice": "4500.00",
      "currency": "KZT",
      "checkedAt": "2026-11-12",
      "stock": 10,
      "url": null,
      "match": "exact"
    }]
  }],
  "totals": [{ "currency": "KZT", "amount": "9000.00", "lines": 1 }],
  "unpricedParts": 0,
  "complete": true
}
```

- `match`: `exact` when the normalized SKU equals the part's, `needs_review` when it starts with it. Other rows aren't offers.
- `needs_review` is never selected automatically.
- Parts with `included: false` don't count. `complete` is false if an included part has no selected offer or no quantity.

`PUT /parts/{id}/offer` with `{ "offerId": "o1" }` or `null` returns 204.

`GET /documents/{id}/procurement/export?priceListId=pl1&format=csv|xlsx` returns the file. Columns: code, quantity, unit, marking status, page or section, quote, supplier, price, currency, checked at, line total, note. Values starting with `= + - @` are escaped.
