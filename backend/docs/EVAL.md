# Evaluation report

Three kinds of evidence, kept apart:

- **A. Controlled fixtures** (unit and API tests, no model): `pytest`, 280 tests.
- **B. Real backend with a scripted model**: the chat, citation checks and cache tests use a scripted answerer, so they
  prove the backend's behaviour for given model outputs, not the model's quality.
- **C. Real model (Gemini)**: run on 5 November 2026, see the last section.

All documents and questions here are synthetic and written by the developers. They show whether the search works across
languages and similar clauses. They are not a score on real jury documents.

## Search (A): `python eval/run_retrieval_sets.py -v`

Search only: is the expected page among the top 5 chunks. No model, no network.

| Set | Language | Expected page first | In top 5 | Off-topic question retrieved nothing |
|---|---|---|---|---|
| ru_contract | Russian | 10/11 | 10/11 | 1/2 |
| kk_rules | Kazakh | 9/9 | 9/9 | 0/2 |
| en_handbook | English | 11/11 | 11/11 | 1/2 |
| ru_similar_numbers | Russian, near-identical clauses | 9/9 | 9/9 | 0/2 |
| all | | 39/40 | 39/40 | 2/8 |

The numbers include 2 questions that need two pages. They were measured before any change to the search code;
the search was not tuned on these sets, so this is the baseline and also the current result.

What the table says:

- The one miss is a synonym: «электричество и воду» against «коммунальные услуги». Keyword search cannot bridge it.
  Embeddings would, at the cost of another provider call per upload and per question and more quota pressure. Not added.
- Off-topic questions usually still retrieve something because they share ordinary words with the document («штраф», «company»).
  Search cannot refuse those. The refusal is made by the model («NOT_FOUND») and by citation checking. That part is
  measured only with the real model (section C).
- Not covered: tables in PDFs (DOCX tables have a test), scanned documents, and real long contracts.

## Search on a long document (A): `python eval/long_document_eval.py`

300 pages (the upload limit), 591 chunks of boilerplate clauses that share vocabulary with the questions, 6 hidden facts:
expected page first 6/6. One search takes a median of 12 ms. The boilerplate is easier than real text, so the accuracy is a
smoke test; the timing is the useful number: search is not a source of latency.

## Cross-language search (A, then C): `python eval/cross_language_eval.py [--long]`

The problem: a question in one language finds nothing in a document in another ("How much is the monthly rent?" shares no
words with "Арендная плата составляет 450 000 тенге"). Keyword search matches words, so the answer was `not_found`
although the document had it.

The fix: when the question's language differs from the documents', the search query is translated into the document
language (one short model call, 8 s limit, cached), and the search runs on the question and its translation. Only the query is
translated: the excerpts sent to the model and the quotes shown to the user are the original document text. If the
translation fails, or comes back in the wrong script, the search uses the question as asked. A same-language question
makes no extra call. Cost: one extra short call per new cross-language question.

Retrieval only, 56 answerable plus 12 unanswerable synthetic questions about three 6-page documents (Russian lease,
Kazakh university rules, English handbook), each asked in the two other languages. Translations are saved in
`eval/cross_language_translations.json`, so the run is reproducible without a key.

| Document <- question language | Expected page in top 5, before | after | Expected page first, after |
|---|---|---|---|
| English <- Kazakh | 1/9 | 9/9 | 9/9 |
| English <- Russian | 1/9 | 9/9 | 9/9 |
| Kazakh <- English | 0/9 | 8/9 | 8/9 |
| Kazakh <- Russian | 5/9 | 9/9 | 9/9 |
| Russian <- English | 0/10 | 10/10 | 9/10 |
| Russian <- Kazakh | 1/10 | 9/10 | 9/10 |
| **All** | **8/56** | **54/56** | **53/56** |

With `--long` the Russian lease is the 20-page `demo/lease_long.pdf` text, where words such as «Арендатор» are on every page:
53/56 in the top 5. ("Before" is the previous behaviour, measured on the same questions.)

What this does not show:

- **Unanswerable questions.** Before the change nothing was found for them, trivially, because nothing was ever found in another
  language. Now the translated words match some page for 9 of the 12 (3 of 12 retrieve nothing). The refusal is made by the model and
  the citation checks, not by the search: see the real runs below, where 8 of 8 unanswerable questions that reached the model
  were refused.
- Two kinds of misses remain: a translation that picks another word than the document («имущество» for «помещение»), and the
  crude 5-letter stemmer («аренда» vs «Арендатор» on every page).
- A variant that asked the model for a translation plus a synonym phrasing was measured and rejected: 50/56 in the top 5
  (5 questions had no translation because of connection errors) against 53/56, and 16/20 against 18/20 in the real run,
  with a slower answer (median 5.1 s against 2.6 s). The plain translation is what ships.
- The Claude provider has the same `translate_query` method but it was **not run** (no Anthropic key): NOT VERIFIED.

Real Gemini, full chat path (upload, translation, search, answer, citation checks), questions in another language than the
document. Pauses between questions kept to the free-tier per-minute quota, yet the quota still ran out in two runs.

| Document and questions | Answered with the expected page cited | Wrong page | No-answer questions refused | Provider errors | Latency median / p95 / max |
|---|---|---|---|---|---|
| 20-page Russian lease, English and Kazakh (24) | 18/20 | 0 | 4/4 | 0 | 2.6 s / 4.7 s / 7.4 s |
| Kazakh rules, Russian and English (22) | 18/18 | 0 | 4/4 | 0 | 3.4 s / 9.2 s / 16.9 s |
| Russian lease as DOCX, Russian and English (18) | 16/16 (DOCX has no pages: only "answered" is scored) | n/a | 2/2 | 0 | 2.0 s / 6.8 s / 10.4 s |
| English handbook, Russian and Kazakh (22) | 13/13 of those that reached the model | 0 | 3/3 | **6 (HTTP 429 on both models)** | 2.3 s / 2.5 s / 2.7 s |

- Provider errors are reported as errors, never as refusals: the API returned `RATE_LIMITED` for the 6 handbook questions
  (the quota ran out after about 60 calls in a few minutes) and the evaluation counts them apart.
- An earlier run on the lease reported 2 wrongly answered unanswerable questions. They were a fault of the test set: the filler
  pages mentioned parking, so the answer was right. The set was fixed and rerun (the 4/4 above).
- Each new cross-language question costs two model calls (translation and answer), so a demo that asks many new questions
  can meet the quota. Ask them in the warm-up: the translation and the verified answer are both cached.
- Single runs on synthetic documents: small samples, not a benchmark.

## Pipeline timing without a model (A): `python eval/pipeline_timing.py`

Upload including extraction and indexing, and one question (search and citation verification, scripted model):
300-page PDF 0.4 s and 0.12 s; 20-page PDF 0.1 s and 0.03 s; DOCX 0.12 s and 0.07 s; 6-page PDF 0.19 s and 0.04 s.
The model's own time is in the real runs above (about 2 to 5 s when the provider is healthy).

## DOCX (A, C)

`GET /documents/{id}/text` returns the extracted text by page (PDF) or by heading, paragraph and table row (DOCX), and a DOCX
chat source carries `paragraph`, the block that contains the quote, so a text reader can scroll to it. Word has no stable
pages, so none are invented, and there is no layout preview. Tested with generated DOCX files (`tests/test_docx_text.py`) and
with the real model on `demo/lease_v1.docx` (16/16 above).

Real Word files have more than paragraphs. An edge-case file with an image, tracked changes, a text box, a nested table,
a hyperlink, a header and a footnote showed that the first version **silently missed** inserted text, text boxes, nested
tables and footnotes. Fixed (`tests/test_docx_edge.py`): the final text of the document is indexed and shown in the reader.

| In a DOCX | Indexed and shown |
|---|---|
| Paragraphs, headings, hyperlinks, tables | yes |
| Inserted text of tracked changes | yes |
| Deleted text of tracked changes | no, on purpose: it is not part of the final text |
| Text boxes | yes (own blocks, `kind: "text_box"`) |
| Nested tables | yes, flattened into their cell |
| Footnotes and endnotes | yes, as a final section "Footnotes" (`kind: "footnote"`) |
| Headers and footers | **no** (repeated on every page, little value; not extracted) |
| Text inside images, charts, SmartArt | **no** (would need OCR) |

A cited quote that starts with its section heading is now located in the paragraph it belongs to (`paragraph`).
Checked with generated files only: no real contract from outside was used.

## Groq as a backup provider (B, C)

`GROQ_API_KEY` in `backend/.env` adds an independent backup behind Gemini: Gemini model, backup Gemini model, then Groq,
each tried only if the one before failed before any text was sent. Mock tests: `tests/test_groq.py` (request shape, every
HTTP error mapped, the chain, the first error is the one raised, wiring).

Real runs with the dev key, on the 20-page Russian lease:

- **Failover.** Gemini key broken on purpose: all 12 Russian questions were answered by Groq, 10/10 with the expected page,
  2/2 refusals, 0 errors, median 1.4 s. The log shows the chain: flash-lite, flash, then Groq.
- **Groq as the only provider, questions in English and Kazakh** (24, with pauses so the free quota was not the limit):
  qwen/qwen3.8-27b 16/20 (4/4 refusals, median 0.9 s); openai/gpt-oss-120b 12/20 (4/4, median 1.5 s); Gemini 18/20.
  The misses of gpt-oss-120b are English questions: its translation of the query ("ежемесячная аренда") shares no word with
  the page that holds the answer («Арендная плата … в месяц»), so the search never found it. The model was not at fault.
- Groq's free tier has its own per-minute limit: without pauses 2 to 8 of 22 questions came back `RATE_LIMITED`.

Conclusion: Gemini stays the main provider and the translator; Groq (qwen by default) is a safety net, not an equal.
Only one key was tried and the samples are small.

## Answer language

The frontend sent no `language`, so the model answered in the document's language: an English question about a Russian lease
got a Russian answer (seen in the browser). The backend now names the language in the prompt, and when none is requested it
uses the language of the question. Checked with the real model: English question, English answer; Russian, Russian.

## Checked in the real frontend (manual, 5 November)

With the backend and the Vite app running: an English question about the Russian PDF is answered with a source on page 2,
and the highlight is exact, translucent, with the text readable. The same for the DOCX: the source shows the section
("Раздел 2") and the quote. The frontend does not yet use `/text`, `/facts`, `paragraph` or `reason`, shows an outdated hint
that a question in another language may find nothing, and sends no `language`. Solid yellow bars hiding the text were seen only in
its keyword demo mode, not with backend coordinates.

## Scanned PDFs (OCR) (A, C): `python eval/ocr_eval.py`

Tesseract data for kaz, rus and eng (set `TESSDATA_PREFIX`). One page of each demo document turned into an image-only PDF
with no text layer; the recognized words are compared with the real words of the page. Synthetic scans of clean typeset
text, one page per language, so these are small samples and an optimistic case.

| Scan | Words right, clean (200 dpi) | Words right, degraded | Time per page |
|---|---|---|---|
| Russian lease, page 2 | 28/28 (100%) | 21/28 (75%) | 0.9 to 1.7 s |
| Kazakh rules, page 3 | 16/16 (100%) | 6/16 (38%) | 0.6 to 0.7 s |
| English handbook, page 4 | 23/23 (100%) | 0/23 (0%, rejected as `NO_TEXT_FOUND`) | 0.8 to 1.2 s |

"Degraded" is 150 dpi, slightly crooked, blurred, speckled, strong JPEG compression: harsher than a decent office scanner.

- **End to end with the real model**, on the degraded scans: the Russian scan was processed (`ocrUsed: true`, language `ru`),
  the question was answered and the quote matched the recognized text; the Kazakh scan was processed but the question was
  not answered (38% of the words recognized); the English scan was rejected with a clear `NO_TEXT_FOUND`.
- **Without OCR set up** a scan fails with `NO_TEXT_FOUND` and a message that says OCR is not configured (checked).
- A scan has **no text layer, so no highlight rectangles**: the page opens and the quote is shown, nothing is drawn.
- **A scan quote is checked against the recognized text, not against the picture.** If OCR misread a word ("тенгевмесяц"),
  the quote shows the same error and still passes the verbatim check. The frontend should mark `ocrUsed` documents
  ("recognized text, may contain errors").
- Quality decides everything: a clean scan reads at 100%, a poor one is unreliable. For a demo use a sharp scan.
- Image preprocessing (denoise, contrast, enlarge) was started as an experiment and dropped: the first attempt was broken and
  the second was too slow to finish; no result and no change to the code.

## Not verified

- **Photographed pages, handwriting, tables in scans, scans of other languages.** Not tested.
- **Translation through Claude** (`ClaudeAnswerer.translate_query`): no Anthropic key: NOT VERIFIED. The same prompt as Gemini and Groq.

## Citation checks (B): `tests/test_citation_support.py`, `tests/test_chat.py`

For a scripted model reply, the backend keeps a source only if the cited excerpt exists, its quote is verbatim in the page,
and every number the cited sentence states appears in the cited excerpts ("15 000", "15,000" and "15000" are equal).

Tested: correct citation, wrong number, wrong fee, invented citation number, no citation, model refusal,
second claim with a wrong number (only the first source stays), several correct sources, two excerpts cited by one sentence.

Limits, stated plainly:

- Support is checked for **numbers and verbatim quotes only**. Whether a cited passage *means* what the sentence says is
  not checked. That needs a model (or an entailment model), and a keyword overlap test would reject correct answers
  written in another language than the document.
- Numbers written in words ("three") are not compared.
- A sentence without a citation is checked only for numbers: a figure that appears in none of the excerpts removes the sentence. Uncited sentences without figures are kept.
- The answer is verified before any of it is shown. A sentence that cites a missing source or states an unsupported number is removed from the text the reader sees and from the saved message; if nothing is left the answer is `not_found` and no text is sent. The cost: the text arrives after the model finishes, not letter by letter.

## Comparison (A): `tests/test_comparison_quality.py`

Fixed: a deleted clause paired with the changed clause after it (the neighbour was reported as modified and its real
original as removed). Pairs are now chosen most-similar first, ignoring a leading clause number, and deterministic.
Added: renumbering is reported as "Only the clause number differs", moved text as one "changed: Moved", numbers like
«450 000» are one figure and only changed figures are listed.

On `demo/lease_v1.pdf` against `demo/lease_v2.pdf` it reports exactly the 5 planted changes (3 changed, 1 added, 1 removed).

It is text similarity, not semantic analysis. A paragraph rewritten with different words is shown as removed + added.
Blocks of more than about 50 × 50 unmatched sentences are paired only among nearby positions to bound the time:
3000 fully different sentences take about 16 s in a background job (worst case, shared vocabulary).

## Security (A, B)

Excerpt text is escaped in the prompt, so a document cannot close its own tag or pose as the question
(`tests/test_prompt_injection.py`). The system prompt tells the model that excerpts are data. A document that tells the
model to answer something else produces an answer with no valid citation, which becomes `not_found`.
Uploads are checked by magic bytes and size; `data/` and `backend/.env` are ignored by Git; keys are never logged
(startup shows only `key=set` or `key=MISSING`).

## Real model (C): measured with a real Gemini key

Run on 5 November 2026 with `python eval/answer_eval.py demo/<file>.pdf eval/sets/<set>.json`: the real backend, the real
Gemini API, the synthetic demo documents. **One run per row, 11 to 13 questions each**: these are small samples on
easy documents, not a benchmark, and they say nothing about real jury documents.

| Documents (language) | Model | Answered with the expected page cited | Wrong page cited | No-answer questions refused | Provider errors | Latency median / p95 / max |
|---|---|---|---|---|---|---|
| Lease (Russian) | gemini-3.5-flash-lite, fallback flash | 10/11 | 0 | 2/2 | 0/13 | 11.4 s / 20.9 s / 28.4 s |
| Lease (Russian) | gemini-3.5-flash, fallback flash-lite | 10/11 | 0 | 2/2 | 0/13 | 2.2 s / 7.6 s / 48.9 s |
| Handbook (English) | gemini-3.5-flash-lite | 11/11 | 0 | 2/2 | 0/13 | 1.0 s / 1.3 s / 4.3 s |
| Rules (Kazakh) | gemini-3.5-flash-lite | 9/9 | 0 | 2/2 | 0/11 | 1.1 s / 7.8 s / 7.8 s |

(Each row includes one question that needs two pages, answered with both pages cited.)

**After two later changes** (answers are verified before they are shown, and a document of up to 12 chunks is sent whole when
search finds nothing), measured again the same day:

| Documents | Model | Answered with the expected page cited | Wrong page | No-answer questions refused | Provider errors | Latency median / p95 / max |
|---|---|---|---|---|---|---|
| Lease (Russian) | gemini-3.5-flash-lite, fallback flash | **11/11** | 0 | 2/2 | 0/13 | 1.4 s / 1.7 s / 2.5 s |
| Questions in English and Kazakh about the Russian lease | same | 4/4 | 0 | 1/1 (1 more hit a quota error) | 1/6 | 1.4 s / 4.8 s / 4.8 s |

- The synonym miss is gone: «Кто платит за электричество и воду?» is now answered from page 6, because the lease is small enough
  to be sent whole when search finds nothing. This works only for small documents; on a large one the search gap remains.
- Questions asked in English and in Kazakh about the Russian document were answered with sources from the right Russian page.
- In the second run one question got HTTP 429 from **both** models (quota), and the API returned `RATE_LIMITED`. It was counted
  as a provider error and not as a refusal, which is the behaviour the product must have.
- The 1.4 s median is the provider being fast at that moment. The first runs the same day were 10 to 28 s (see below).

What the runs showed:

- The one Russian miss is the synonym case from the search section: «электричество и воду» did not retrieve «коммунальные услуги»,
  so nothing was sent to the model and the answer was `not_found`. The model never saw the page.
- Answers were verified end to end: every cited page was the expected one, and the off-topic questions were refused. The tables
  above count a cited page, not whether each sentence of the answer was right; read a few answers by eye before the demo.
- **Latency varies a lot with provider load, not with the question.** The first Russian run on flash-lite took 9 to 28 s per
  answer; the same model answered English and Kazakh questions in about 1 s a little later. One question took 48.9 s once
  (flash was rate limited with HTTP 429 and the backend switched to flash-lite). Do not promise a latency on stage; warm the
  cache first (see DEMO.md).
- The fallback model was used for real: flash returned 429 and flash-lite answered; flash-lite timed out once and flash answered.
- Models: `gemini-3.5-flash-lite` and `gemini-3.5-flash` answered for this key. `gemini-2.5-flash` and `gemini-2.5-flash-lite` are listed
  for the key but return 404. `gemini-3.1-flash-lite`, `gemini-3.7-flash` and `gemini-flash-latest` returned 503 at the time of the check.
- A bug found only by the real run: the provider client broke on every second request when requests ran in different event
  loops (5 of 13 questions failed in the first run). Fixed (one client per loop, with a test). Under one server loop it would
  probably not have shown on stage, but it is fixed either way.

Not measured: documents longer than 6 pages with the real model, scans, tables, and a document in a language other
than Russian with questions in a third language. All real runs are single runs on synthetic documents.
