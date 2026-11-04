# Document Assistant — backend

FastAPI backend for DOCMIND AI. Contract: `/api/v1`, camelCase JSON.

## What works

- `GET /api/v1/health`, `GET /api/v1/capabilities` (reports only what is implemented)
- `POST /api/v1/documents` for PDF and DOCX (type and size checks, 202 `processing`)
- Processing after upload: `queued → extracting → indexing → ready` or `failed` with `PARSE_FAILED`, `PASSWORD_PROTECTED`, `NO_TEXT_FOUND` or `INDEXING_FAILED`
- `GET /api/v1/documents`, `GET /api/v1/documents/{id}`, `DELETE /api/v1/documents/{id}`, `GET /api/v1/documents/{id}/file` (ready PDFs only, Range supported), `GET /api/v1/documents/{id}/pages/{page}`
- Document `language` (`kk`/`ru`/`en`/`mixed`) is guessed from the script
- `POST /api/v1/conversations`, `GET`/`DELETE /api/v1/conversations/{id}`, `GET /api/v1/conversations/{id}/messages`
- `POST /api/v1/conversations/{id}/messages` streams SSE (`start`, `token`, `sources`, `done`, `error`)
  - BM25 retrieval over chunks, top 5 excerpts go to Claude
  - Only `[n]` markers that point at a real excerpt become sources, and each quote is checked to be verbatim in its page or section
  - Follow-up questions: the last 3 answered turns go to the model, and a very short question borrows the previous one for search
  - No usable citation means `not_found`. With no relevant excerpt the model is not called at all

Also: `highlights` on PDF sources, `POST /api/v1/comparisons` (sentence diff, no model), rate limits (30 uploads and 30 chat messages per minute), DOCX tables. Full contract: [docs/api-contract.md](docs/api-contract.md).

OCR: scanned PDFs are read with Tesseract through PyMuPDF when Tesseract and its `kaz`/`rus`/`eng` data are installed (set `TESSDATA_PREFIX` if needed). Otherwise they fail with `NO_TEXT_FOUND`. Tesseract is not installed on the dev machine, so the OCR call itself has never been run, only the pipeline around it.

## Not implemented yet

- DOCX preview (`docxPreview: "none"`)
- Embeddings: retrieval is keyword-only (BM25 with a crude 5-letter stemmer and Russian prefix stripping), so synonyms are not matched
- Model-based comparison (meaning, conflicts)

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

Robustness: SQLite runs in WAL mode; documents left `processing` by a restart are processed again on startup and unfinished comparisons are marked failed; Claude requests time out after 60 s (`LLM_TIMEOUT`). Source quotes are the single best sentence of the cited excerpt, so highlights are precise.

## Evaluate answers (needs a key)

```bash
python eval/answer_eval.py demo.pdf eval/sample_set.json
```

Uploads the PDF, asks every question through the real chat endpoint with Claude, and counts answers whose cited pages include the expected one and off-topic questions that were refused. This is the honest accuracy number for the presentation, once you replace `sample_set.json` with questions on the demo document. It has only been run with a fake answerer so far.

## Evaluate search

```bash
python eval/retrieval_eval.py [your_set.json]
```

Checks only the search step (is the expected page in the top 5, is nothing found for off-topic questions). The bundled `eval/sample_set.json` is a tiny synthetic set and the stemmer was tuned while looking at it, so its 12/12 is not a measure of real accuracy. Put the questions on the demo documents in the same format.

## Test

```bash
pytest
```

The tests use a fake answerer. A real Claude call has not been run yet: only the error mapping was checked offline with a dummy key.
