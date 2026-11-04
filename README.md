# Document Assistant — backend

FastAPI backend for DOCMIND AI. Contract: `/api/v1`, camelCase JSON.

## What works

- `GET /api/v1/health`, `GET /api/v1/capabilities` (reports only what is implemented)
- `POST /api/v1/documents` for PDF and DOCX (type and size checks, 202 `processing`)
- Processing after upload: `queued → extracting → indexing → ready` or `failed` with `PARSE_FAILED`, `PASSWORD_PROTECTED`, `NO_TEXT_FOUND` or `INDEXING_FAILED`
- `GET /api/v1/documents`, `GET /api/v1/documents/{id}`, `DELETE /api/v1/documents/{id}`, `GET /api/v1/documents/{id}/file` (ready PDFs only)
- `POST /api/v1/conversations`, `GET`/`DELETE /api/v1/conversations/{id}`, `GET /api/v1/conversations/{id}/messages`
- `POST /api/v1/conversations/{id}/messages` streams SSE (`start`, `token`, `sources`, `done`, `error`)
  - BM25 retrieval over chunks, top 5 excerpts go to Claude
  - Only `[n]` markers that point at a real excerpt become sources, and each quote is checked to be verbatim in its page or section
  - No usable citation means `not_found`. With no relevant excerpt the model is not called at all

## Not implemented yet

- OCR (scanned PDFs fail with `NO_TEXT_FOUND`)
- DOCX preview (`docxPreview: "none"`), tables in DOCX
- Range requests on `/file`
- `GET /documents/{id}/pages/{page}`
- Embeddings (retrieval is keyword-only, no stemming: Russian and Kazakh endings are not matched)
- Comparisons, highlights

## Run

```bash
python -m venv .venv
source .venv/bin/activate        # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
export ANTHROPIC_API_KEY=...     # without it, chat answers 503 LLM_UNAVAILABLE
fastapi dev app/main.py
```

Environment variables:

- `ANTHROPIC_API_KEY` — required for chat
- `CLAUDE_MODEL` — default `claude-opus-5-5`
- `DATA_DIR` — where `app.db` and uploaded files go (default `data/`)
- `CORS_ORIGINS` — comma-separated frontend origins (default `http://localhost:5173`)

## Test

```bash
pytest
```

The tests use a fake answerer. A real Claude call has not been run yet: only the error mapping was checked offline with a dummy key.
