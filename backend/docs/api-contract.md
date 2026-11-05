# API contract v1 (as implemented)

Base `/api/v1`. JSON in camelCase, times ISO-8601 UTC, ids are strings, no auth. Interactive docs: `/docs`, schema: `/openapi.json`.
Changes to this file go in their own commit, agreed by both sides.

Every response has an `X-Request-Id` header. Every error has this body:

```json
{ "error": { "code": "DOCUMENT_NOT_READY", "message": "...", "retryable": false, "requestId": "..." } }
```

Principles: `Source.quote` is verbatim text of the stated page or section, checked by the server (whitespace collapsed to single spaces). Pages count from 1. When the documents have no answer, `answerStatus` is `not_found` and `sources` is empty. Nothing is invented.

## Types

- `Lang`: `"kk" | "ru" | "en"`
- `Document`: `id, name, kind ("pdf"|"docx"), sizeBytes, status ("processing"|"ready"|"failed"), stage ("queued"|"extracting"|"ocr"|"indexing"|null), pageCount (null for DOCX), language (Lang|"mixed"|null, guessed from the script), ocrUsed, hasPreview (true for PDF), createdAt, error (ApiError|null)`
- `Source`: `index` (the `[n]` marker in the answer), `documentId, documentName, page (null for DOCX), location (heading, DOCX only), quote, highlights?, paragraph?` where `highlights` is a list of `{x, y, w, h}` as 0..1 of the page (PDF only, absent when the quote cannot be located) and `paragraph` is the block `index` in `GET /documents/{id}/text` that contains the quote (DOCX only, absent when it cannot be found)
- `Message`: `id, role, content, createdAt, answerStatus ("answered"|"not_found"|null), sources (Source[]|null)`
- `Conversation`: `id, title, documentIds, createdAt, updatedAt`

## System

- `GET /health` → `{ "status": "ok" }`
- `GET /capabilities` → `version, languages, ocr, docxPreview, comparison, highlights, limits {maxFileSizeBytes, maxPages, maxDocumentsPerConversation}`. `ocr` is true only when Tesseract with `kaz`/`rus`/`eng` data is found. `languages` is empty for now (answers follow the question language, not verified end to end).

## Documents

- `POST /documents` multipart field `file` → 202 `Document` (`processing`, `queued`). Errors: 413 `FILE_TOO_LARGE` (20 MB), 415 `UNSUPPORTED_TYPE` (extension or content), 422 `VALIDATION_ERROR`, 429 `RATE_LIMITED`.
- `GET /documents` → `{ items }`; `GET /documents/{id}` → `Document` (poll while `processing`). 404 `DOCUMENT_NOT_FOUND`.
- `GET /documents/{id}/file` → PDF with Range support. 404 `DOCUMENT_NOT_FOUND`, 404 `PREVIEW_UNAVAILABLE` (DOCX), 409 `DOCUMENT_NOT_READY`.
- `GET /documents/{id}/pages/{page}` → `{ documentId, page, text }`. 404 `PAGE_NOT_FOUND`, 409 `DOCUMENT_NOT_READY`. PDF only.
- `GET /documents/{id}/text` → `{ documentId, kind, language, blocks: [{ index, kind, section, page, text }] }`. For the extracted-text reader. PDF: one block per page (`kind: "page"`, `page` set). DOCX: one block per heading, paragraph or table row (`kind: "heading"|"paragraph"|"table_row"`, `section` is the heading it sits under, `page` is null: Word has no stable pages). `text` is normalized like the indexed text, so a chat `Source.quote` is a substring of the block named by `Source.paragraph`. 404 `DOCUMENT_NOT_FOUND`, 409 `DOCUMENT_NOT_READY`.
- `GET /documents/{id}/facts` → `{ documentId, facts: [{ kind, value, quote, page, location, highlights }], suggestedQuestions: string[] }`. `kind` is `deadline`, `date`, `duration` (for example "within 3 working days"), `amount` or `percent`. Found by patterns, no model: `quote` is the exact sentence, `page` is null for DOCX (use `location`), `highlights` as in chat sources (empty for DOCX). `suggestedQuestions` are in the document language. At most 60 facts. 409 `DOCUMENT_NOT_READY`.
- `DELETE /documents/{id}` → 204.

Processing ends in `ready` or `failed`. Failure is in `Document.error`: `PARSE_FAILED`, `PASSWORD_PROTECTED`, `NO_TEXT_FOUND` (scan without OCR), `OCR_FAILED`, `INDEXING_FAILED`.

## Chat

- `POST /conversations` `{ documentIds (1..5), title? }` → 201 `Conversation`. 404 `DOCUMENT_NOT_FOUND`, 409 `DOCUMENT_NOT_READY`, 422 `VALIDATION_ERROR`.
- `GET /conversations`, `GET /conversations/{id}`, `DELETE /conversations/{id}`, `GET /conversations/{id}/messages` → `{ items }`. 404 `CONVERSATION_NOT_FOUND`.
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
