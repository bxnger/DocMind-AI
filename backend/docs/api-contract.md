# API contract v1 (as implemented)

Base `/api/v1`. JSON in camelCase, times ISO-8601 UTC, ids are strings, no auth. Interactive docs: `/docs`, schema: `/openapi.json`.
Changes to this file go in their own commit, agreed by both sides.

Every response has an `X-Request-Id` header. Every error has this body:

```json
{ "error": { "code": "DOCUMENT_NOT_READY", "message": "...", "retryable": false, "requestId": "..." } }
```

Principles: `Source.quote` is verbatim text of the stated page or section, checked by the server (whitespace collapsed to single spaces). Pages count from 1. When the documents have no answer, `answerStatus` is `not_found` and `sources` is empty. Nothing is invented.

## Guest sessions

Every route under `/api/v1` needs a session except `GET /health`, `GET /capabilities` and `POST /sessions`.

- `POST /sessions` (no body) → 201 `{ token, expiresAt }`. The token is random, shown only here, and stored only as a hash. It lasts `SESSION_TTL_HOURS` (72). 429 `RATE_LIMITED` per address.
- Send it on every request, including `fetch` for SSE and the PDF viewer: `Authorization: Bearer <token>`. Never in a URL. Cookies are not used, because the frontend and the API are on different sites.
- Frontend: keep the token in `localStorage`, create one when there is none, and on 401 create a new one and treat the old documents as gone (conversation ids stored locally too). PDF.js needs `httpHeaders`; a plain link or `<iframe>` to `/file` cannot work.
- `GET /sessions/current` → `{ expiresAt, usage {documents, storedBytes, aiRequestsToday}, limits {maxDocuments, maxBytes, aiRequestsPerDay} }`.
- `DELETE /sessions/current` → 204. Deletes the session and everything it owns. Expired sessions are purged the same way.

The owner comes only from the token. An owner or user id in a request is ignored.

| Status | Code | Meaning | Client |
|---|---|---|---|
| 401 | `UNAUTHORIZED` | No usable token | Create a session |
| 401 | `SESSION_EXPIRED` | Unknown or expired token | Create a session; the data is gone |
| 403 | `DEMO_READ_ONLY` | Deleting a demo document | Do not offer it when `isDemo` |
| 404 | `DOCUMENT_NOT_FOUND`, `CONVERSATION_NOT_FOUND`, `COMPARISON_NOT_FOUND` | Missing, or someone else's: the two look the same | |
| 413 | `FILE_TOO_LARGE`, `DOCX_TOO_LARGE` | Over a size limit | Do not retry |
| 429 | `RATE_LIMITED` | Too many requests. `retryable: true`, with `Retry-After` in seconds | Retry after that time |
| 429 | `QUOTA_EXCEEDED` | Session's documents, conversations or comparisons are full. `retryable: false` | Delete something |
| 429 | `AI_SESSION_BUDGET_EXCEEDED`, `AI_BUDGET_EXCEEDED` | Daily AI allowance used up. `retryable: false`, `Retry-After` until 00:00 UTC | Do not offer Retry; demo search and reading still work |
| 503 | `STORAGE_FULL` | Server has no room. `retryable: true` | Try later |
| 500 | `INTERNAL_ERROR` | No details are given. `retryable: true` | Retry |

**Retry:** follow `retryable` in the body. A question is counted against the AI allowance when the model is about to be called, so a failed attempt that is retried counts again. A remembered answer is free.

**SSE:** session, limit and budget errors arrive as ordinary JSON before the stream starts. After `start`, the events below are unchanged.

**Demo documents:** added on the server with `python -m app.demo_docs <files>`. Every session sees them in `GET /documents` with `isDemo: true` and can read, ask about and compare them. Only DELETE is refused. Conversations and comparisons about them belong to the session that made them.

**Limits per session (defaults, all configurable):** chat 12, upload 6, comparison 6, facts 20, `/text` 30 and other reads 600 per minute; 10 documents, 100 MB, 3 processing at once; 50 conversations; 20 comparisons, 1 running; 40 AI requests a day. Also 300 AI requests a day per address, and 1000 for the whole server.

**Uploads:** 20 MB. PDF: `%PDF-` signature, 300 pages, scans 50 pages. DOCX: a real archive with `word/document.xml`, at most 2000 entries, 100 MB unpacked, of which 32 MB XML. Reading runs in a separate process limited to 180 s and 768 MB; over that, the document ends `failed` with `DOCUMENT_TOO_COMPLEX`. A failed document keeps its record, without its file or text, and still counts towards the document limit until deleted.

## Types

- `Lang`: `"kk" | "ru" | "en"`
- `Document`: `id, name, kind ("pdf"|"docx"), sizeBytes, status ("processing"|"ready"|"failed"), stage ("queued"|"extracting"|"ocr"|"indexing"|null), pageCount (null for DOCX), language (Lang|"mixed"|null, guessed from the script), ocrUsed, hasPreview (true for PDF), isDemo, createdAt, error (ApiError|null)`
- `Source`: `index` (the `[n]` marker in the answer), `documentId, documentName, page (null for DOCX), location (heading, DOCX only), quote, highlights?, paragraph?` where `highlights` is a list of `{x, y, w, h}` as 0..1 of the page (PDF only, absent when the quote cannot be located) and `paragraph` is the block `index` in `GET /documents/{id}/text` that contains the quote (DOCX only, absent when it cannot be found)
- `Message`: `id, role, content, createdAt, answerStatus ("answered"|"not_found"|null), sources (Source[]|null), reason (string|null)`. `reason` is set on a `not_found` assistant message with the same values as the `done` event, so the cause survives a reload; it is null otherwise and on messages saved before it existed
- `Conversation`: `id, title, documentIds, createdAt, updatedAt`

## System

- `GET /health` → `{ "status": "ok" }`
- `GET /capabilities` → `version, languages, ocr, docxPreview, comparison, highlights, limits {maxFileSizeBytes, maxPages, maxDocumentsPerConversation}`. `ocr` is true only when Tesseract with `kaz`/`rus`/`eng` data is found. `languages` is empty for now (answers follow the question language, not verified end to end).

## Documents

- `POST /documents` multipart field `file` → 202 `Document` (`processing`, `queued`). Errors: 413 `FILE_TOO_LARGE` (20 MB), 413 `DOCX_TOO_LARGE`, 415 `UNSUPPORTED_TYPE` (extension or content; a broken DOCX archive is refused here), 422 `VALIDATION_ERROR`, 429 `RATE_LIMITED` or `QUOTA_EXCEEDED`, 503 `STORAGE_FULL`.
- `GET /documents` → `{ items }`, the session's own and the demo documents; `GET /documents/{id}` → `Document` (poll while `processing`). 404 `DOCUMENT_NOT_FOUND`.
- `GET /documents/{id}/file` → PDF with Range support. 404 `DOCUMENT_NOT_FOUND`, 404 `PREVIEW_UNAVAILABLE` (DOCX), 409 `DOCUMENT_NOT_READY`.
- `GET /documents/{id}/pages/{page}` → `{ documentId, page, text }`. 404 `PAGE_NOT_FOUND`, 409 `DOCUMENT_NOT_READY`. PDF only.
- `GET /documents/{id}/text` → `{ documentId, kind, language, blocks: [{ index, kind, section, page, text }] }`. For the extracted-text reader. PDF: one block per page (`kind: "page"`, `page` set). DOCX: one block per heading, paragraph or table row (`kind: "heading"|"paragraph"|"table_row"`, `section` is the heading it sits under, `page` is null: Word has no stable pages). `text` is normalized like the indexed text, so a chat `Source.quote` is a substring of the block named by `Source.paragraph`. 404 `DOCUMENT_NOT_FOUND`, 409 `DOCUMENT_NOT_READY`.
- `GET /documents/{id}/facts` → `{ documentId, facts: [{ kind, value, quote, page, location, highlights }], suggestedQuestions: string[] }`. `kind` is `deadline`, `date`, `duration` (for example "within 3 working days"), `amount` or `percent`. Found by patterns, no model: `quote` is the exact sentence, `page` is null for DOCX (use `location`), `highlights` as in chat sources (empty for DOCX). For DOCX each fact also has `paragraph`, the block `index` in `GET /documents/{id}/text`, and its `quote` never runs across blocks (not from a heading into a paragraph, not across table rows). `suggestedQuestions` are in the document language. At most 60 facts. 409 `DOCUMENT_NOT_READY`.
- `DELETE /documents/{id}` → 204.

Processing ends in `ready` or `failed`. Failure is in `Document.error`: `DOCUMENT_TOO_COMPLEX`, `PARSE_FAILED`, `PASSWORD_PROTECTED`, `NO_TEXT_FOUND` (scan without OCR), `OCR_FAILED`, `INDEXING_FAILED`.

## Chat

- `POST /conversations` `{ documentIds (1..5), title? }` → 201 `Conversation`. 404 `DOCUMENT_NOT_FOUND`, 409 `DOCUMENT_NOT_READY`, 422 `VALIDATION_ERROR`.
- `GET /conversations`, `GET /conversations/{id}`, `DELETE /conversations/{id}`, `GET /conversations/{id}/messages` → `{ items }`. 404 `CONVERSATION_NOT_FOUND`. A question is saved together with its answer (`answered` or `not_found`); an attempt that ended in an `error` event or a closed connection saves nothing, so a retry does not repeat the question in the history or in the model's context.
- `POST /conversations/{id}/messages` `{ content (max 2000 chars), language? }` → `text/event-stream`. Read it with `fetch`. The question may be in Russian, Kazakh or English whatever the language of the documents: when it differs, the search query is also translated into the document language (one short model call, cached). Only the search query is translated; excerpts, quotes and sources are always the original document text. If the translation fails, the search uses the question as asked.

| event | data |
|---|---|
| `start` | `{ messageId }` |
| `token` | `{ text }` (a `NOT_FOUND` reply sends no tokens) |
| `sources` | `{ sources: Source[] }` (after the tokens; only when answered) |
| `done` | `{ messageId, answerStatus, reason? }`. `reason` is present only for `not_found`: `no_matching_excerpt` (search found nothing; the model was not asked), `model_refused` (the model said the documents do not contain it), `no_citation`, `citations_failed_verification` (the answer was rejected by the checks), `empty_answer`. A provider failure is never a `not_found`: it is an `error` event. |
| `error` | `ApiError` (`LLM_UNAVAILABLE`, `LLM_TIMEOUT`, `RATE_LIMITED` when the AI provider limits us; no `done` follows). `retryable` is false when the provider rejects the API key |

Errors before the stream: 404 `CONVERSATION_NOT_FOUND`, 409 `DOCUMENT_NOT_READY`, 422 `EMPTY_MESSAGE`, 422 `MESSAGE_TOO_LONG`, 429 `RATE_LIMITED`, 503 `LLM_UNAVAILABLE` (no API key). Closing the connection stops generation.

A `[n]` in the text matches `Source.index`. `Source.quote` is the sentence of the cited excerpt closest to the question and to the claim (the whole excerpt, at most 500 characters, when no sentence stands out). If the model's answer contains no valid `[n]`, the result is `not_found` even though its text was already streamed: hide the text for `not_found`.

## Comparison

- `POST /comparisons` `{ documentAId, documentBId }` → 202 `Comparison`. 404 `DOCUMENT_NOT_FOUND`, 409 `DOCUMENT_NOT_READY`, 422 `SAME_DOCUMENT`, 413 `DOCUMENT_TOO_LARGE_FOR_COMPARISON` (over 3000 sentences).
- `GET /comparisons/{id}` → `{ id, documentAId, documentBId, status, progress, summary, differences, error }`. 404 `COMPARISON_NOT_FOUND`.
- `Difference`: `{ id, type ("changed"|"added"|"removed"), explanation, a, b }` with `Evidence = { page, quote }`. `a` is null for `added`, `b` is null for `removed`. `potential_conflict` is not produced.

The comparison is a sentence diff without a model: a similar pair is `changed` (the explanation names differing numbers), the rest is `added` or `removed`. It does not understand meaning.
