# Evaluation report

Three kinds of evidence, kept apart:

- **A. Controlled fixtures** (unit and API tests, no model): `pytest`, 231 tests.
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
