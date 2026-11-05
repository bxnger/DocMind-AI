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
  - No usable citation means `not_found`, and the `done` event says why (`reason`). With no relevant excerpt in a large document the model is not called at all; a small document (up to 12 chunks) is sent whole instead
  - Cross-language questions: when the question is in another language than the documents (Russian, Kazakh, English), the search query is also translated into the document language with one short model call (cached, 8 s limit). Only the query is translated; excerpts and quotes stay original. If the translation fails the search uses the question as asked

Also: `GET /documents/{id}/text` (extracted text by page or, for DOCX, by heading/paragraph, for a text reader), `paragraph` on DOCX sources, `highlights` on PDF sources, `POST /api/v1/comparisons` (sentence diff, no model), rate limits (30 uploads and 30 chat messages per minute), DOCX tables. Full contract: [docs/api-contract.md](docs/api-contract.md).

OCR: scanned PDFs are read with Tesseract through PyMuPDF when Tesseract and its `kaz`/`rus`/`eng` data are installed (set `TESSDATA_PREFIX` if needed). Otherwise they fail with `NO_TEXT_FOUND`. Tesseract is not installed on the dev machine, so the OCR call itself has never been run, only the pipeline around it.

## Not implemented yet

- DOCX preview in the original layout (`docxPreview: "none"`): Word has no stable pages. Use `GET /documents/{id}/text` for an honest text reader
- Embeddings: retrieval is keyword-only (BM25 with a crude 5-letter stemmer and Russian prefix stripping), so synonyms inside one language are not matched. Across languages the question is translated first (see above)
- Model-based comparison (meaning, conflicts)

## Run

Short version: see the repository's root README (`cp .env.example .env`, then `set -a; source .env; set +a`).

```bash
python -m venv .venv
source .venv/bin/activate        # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Choose one provider. Without the key of the chosen provider, chat answers 503 LLM_UNAVAILABLE.
export ANTHROPIC_API_KEY=...     # default provider
# or
export LLM_PROVIDER=gemini
export GEMINI_API_KEY=...

fastapi dev app/main.py --port 8011
```

Environment variables:

- `LLM_PROVIDER` — `anthropic` (default), `gemini` or `groq`
- `ANTHROPIC_API_KEY` — required for chat with `anthropic`
- `GEMINI_API_KEY` — required for chat with `gemini`
- `GROQ_API_KEY` — with `gemini` it enables Groq as an independent backup: when every Gemini model is rate limited, down or too slow before any text is sent, the question goes to Groq (the question translation for cross-language search too). With `LLM_PROVIDER=groq` it is the main provider. Run `python eval/groq_diagnose.py` to check the key and pick a model
- `GROQ_MODEL` — default `qwen/qwen3.8-27b`; model names change, copy a working one from `groq_diagnose.py`
- `GEMINI_MODEL` — default `gemini-3.5-flash-lite`
- `GEMINI_THINKING_LEVEL` — `minimal`, `low`, `medium` or `high`. Empty (default) keeps the model's own default. Set it only after `eval/gemini_latency.py` shows thinking is the slow part
- `CLAUDE_MODEL` — default `claude-opus-5-5`
- `DATA_DIR` — where `app.db` and uploaded files go (default `data/`)
- `CORS_ORIGINS` — comma-separated frontend origins (default `http://localhost:5173`)

Robustness: SQLite runs in WAL mode; documents left `processing` by a restart are processed again on startup and unfinished comparisons are marked failed; model requests time out after 60 s (`LLM_TIMEOUT`). Source quotes are the single best sentence of the cited excerpt, so highlights are precise.

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

## Gemini errors (404, wrong model)

`Gemini API error, status 404 (model not found)` in the server log means this key cannot call the configured model.
In your own terminal, with the key set:

```bash
python eval/gemini_diagnose.py
```

It lists the models your key can use, tests the configured one and suggests a working alternative.
Set it with `GEMINI_MODEL=<name>` and restart. It never prints the key.

## Reading the server log

With `LLM_PROVIDER=gemini` the start of the log says which model this process really uses, for example
`LLM provider=gemini model=gemini-3.5-flash-lite key=set` (`key=MISSING` if the variable is not exported in that terminal).
Every chat answer then logs one line: `chat answered|not_found|error mode=search|overview model=... reason=...`.
`reason` is one of `no_matching_excerpt` (nothing in the document matched, the model was not called), `model_refused`,
`empty_answer`, `no_citation`, `citations_failed_verification`. `Gemini stream finished ... served_by=... finish=...`
shows which model answered and how it ended. The log holds counts and names only, never questions, answers or document text.

## Slow or timed-out answers

`Gemini stream finished ... failed_at=timeout_<stage>` says where a request stalled: `open` (no response from the API),
`first_chunk` (response open, nothing sent), `first_token` (chunks without text, usually the model thinking), `stream`
(text started, then stalled). The same line has `open_ms`, `first_chunk_ms`, `first_token_ms`, `total_ms`, `prompt_chars`
and token counts. `chat ...` lines add `prep_ms` (retrieval before the model call) and `first_token_ms`.
To measure Gemini with your own PDF and question, in a terminal where the key is set:

```bash
PYTHONPATH=. python eval/gemini_latency.py path/to/file.pdf "your question"
```

## Check Gemini for real (needs a key)

`tests/test_gemini.py` uses a fake SDK client and never calls Google. To check the real API, start the server with
`LLM_PROVIDER=gemini` and `GEMINI_API_KEY` set, then run:

```bash
python eval/gemini_smoke.py path/to/real.pdf "A question the PDF answers" "A question it does not answer"
```

## Test

```bash
pytest
```

The tests use a fake answerer. A real Claude call has not been run yet: only the error mapping was checked offline with a dummy key.
