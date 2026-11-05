# Demo checklist (7 minutes, final on 14 November)

Everything here is synthetic. The demo documents are made by `demo/make_demo_pdfs.py` from texts in `eval/sets/`.
Nothing is hardcoded: the answers come from the real model and are checked by the backend.

## 1. Before the day (once)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate        # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env                                     # then edit .env (never commit it)
python demo/make_demo_pdfs.py                            # creates demo/*.pdf
python eval/gemini_diagnose.py                           # lists the models YOUR key can use
```

`backend/.env` (loaded by the backend itself; real environment variables win over the file):

```
LLM_PROVIDER=gemini
GEMINI_API_KEY=<your key>
GEMINI_MODEL=gemini-3.5-flash-lite        # worked in the real run; check with gemini_diagnose.py on YOUR key
GEMINI_FALLBACK_MODEL=gemini-3.5-flash     # used on 429 or a slow start (this is also the default)
```

Frontend: `frontend/.env` has `VITE_API_BASE_URL=http://127.0.0.1:8011`. Open the app as `http://localhost:5173`.

## 2. Start (10 minutes before)

```bash
cd backend && fastapi dev app/main.py --port 8011
cd frontend && npm run dev
```

Check: `curl http://127.0.0.1:8011/api/v1/health` returns `{"status":"ok"}`.
The first log lines must say `key=set`. If they say `key=MISSING`, `.env` is not where the backend looks
(`backend/.env`) or the key line is empty.

## 3. Warm-up (5 minutes before)

0. Questions in a language other than the document's are cached too (the translation and the verified answer), so ask the cross-language ones of the script during the warm-up as well.
1. Upload `demo/lease_v1.pdf` and ask every question of the script below once. Answers that pass verification are
   remembered, so on stage the same questions answer instantly and cannot hit a rate limit.
   (The memory is cleared when the backend restarts: do not restart after the warm-up.)
2. Upload `demo/lease_v2.pdf` for the comparison.
3. Run `python eval/answer_eval.py demo/lease_v1.pdf eval/sets/ru_contract.json` once. Its printout (answered,
   refused, median and p95 latency, provider errors) is your real number for the slide. Quote only what it prints.

## 4. Script

| Step | Do | Expected |
|---|---|---|
| 1 | Upload `lease_v1.pdf` | Ready in a few seconds, language `ru`, 6 pages |
| 2 | Show the key facts block (`GET /documents/{id}/facts`) | 450 000 тенге, 0,1%, 1 января 2027, 10 рабочих дней, each with page and highlight |
| 3 | Ask «Сколько составляет арендная плата?» | Answer with [1], source page 2, quote «450 000 тенге» |
| 4 | Click the source | PDF opens on page 2 with the passage highlighted |
| 5 | Ask «За сколько дней надо предупредить о расторжении?» | Page 5, 30 календарных дней |
| 6 | Ask in English: «How long is the lease term?» | An English answer from the Russian text with a source (checked once with the real model on 5 November: 3 of 3 English and 1 of 1 Kazakh question answered from the right page) |
| 7 | Open Knowledge Map | Graph from the real text of the document |
| 8 | Compare `lease_v1.pdf` with `lease_v2.pdf` | 5 differences: rent 450 000 → 500 000, term 11 → 12 months, notice 30 → 60 days, one sentence removed (office use), one added (insurance) |
| 9 | Ask «Есть ли в здании парковка?» | Honest «not found»: the document does not say |
| 10 | Upload `lease_long.pdf` (20 pages) and ask in English «How much is the monthly rent?» and in Kazakh «Жалдау ақысы қанша?» | Answered with a source on page 2 of the Russian text: the question is translated for the search only, the quote is the original Russian |
| 11 | Upload `lease_v1.docx` and ask «Сколько составляет арендная плата?» | Answer with a source that has a section and a `paragraph`; `GET /documents/{id}/text` returns the paragraphs for a text reader (Word has no pages, so no PDF preview) |
| 12 | Say plainly: every quote is checked word for word against the page, and numbers in the answer must appear in the cited text | |

## 5. What can go wrong

| Symptom | Cause | Do |
|---|---|---|
| Chat says model unavailable (503) | No key loaded | Fix `backend/.env`, restart, check `key=set` |
| `RATE_LIMITED` error in the chat | Provider quota | The backend already tried the fallback model. Wait a minute, or ask a question already asked in the warm-up |
| `LLM_TIMEOUT` | Provider stalled | Ask again; the repeat goes to the fallback model |
| `LLM_UNAVAILABLE`, not retryable | Wrong key or model name (404/403) | Run `python eval/gemini_diagnose.py`, copy a working model name into `GEMINI_MODEL` |
| Answer is «not found» for a question that is in the document | Search missed it (synonyms) or the cited number did not match | Rephrase with words from the document. Keyword search does not understand synonyms. The `reason` in the `done` event says which case it was |
| A question in another language than the document is «not found» | The translation of the question failed (quota, timeout) and the search used the original words | Ask again after a minute; a question already asked during the warm-up is cached. Cross-language costs one extra short model call per new question |
| No highlight on a source | The passage spans a layout the PDF search cannot match | The page still opens; the quote is shown next to it |
| Scanned PDF fails with `NO_TEXT_FOUND` | OCR needs Tesseract with kaz/rus/eng data | Do not demo scans unless Tesseract is installed and tested on the demo laptop |

## 6. Fallback when the real AI cannot be used

The frontend has a demo search mode that is **not AI** (it is labelled as such in the interface). If you must use it,
say so on stage. Never present it as the model answering. Do not mix the two in one run.

## 7. Do not claim

- Accuracy numbers that `eval/answer_eval.py` did not print on your documents.
- OCR, unless tested on the demo laptop.
- Semantic search: retrieval is keyword-based (BM25).
- That comparison understands meaning: it matches sentences by text similarity and says so.
