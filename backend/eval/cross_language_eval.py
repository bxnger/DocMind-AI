"""Cross-language search evaluation: questions in one language, documents in another. Search only, no answer model.

    python eval/cross_language_eval.py [-v] [--long] [--cache FILE]

--long   the Russian lease is the 20-page demo/lease_long.pdf text (6 real pages + 14 pages of ordinary clauses),
         where common words such as "Арендатор" appear everywhere and the search has to work for it
--cache  where translations are saved (default eval/cross_language_translations.json)

For every question it measures the search twice:
  before: the question as asked (what the backend did before cross-language search),
  after:  the question plus its translation into the document language (what the backend does now).

Translations come from the real model the first time and are saved to eval/cross_language_translations.json, so a
later run is reproducible without a key. A question with no saved translation and no key is counted under "after"
as untranslated and listed as NOT VERIFIED.

Synthetic documents (eval/sets) and 60+ synthetic questions: this shows the mechanism works, not a score on real
documents.
"""
import asyncio
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.chunking import build_chunks  # noqa: E402
from app.extraction import Segment, normalize  # noqa: E402
from app.retrieval import rank  # noqa: E402
from app.translate import LANGUAGE_NAMES, clean_translation, query_language, translation_targets  # noqa: E402

HERE = Path(__file__).resolve().parent
CACHE = HERE / "cross_language_translations.json"
if "--cache" in sys.argv:
    CACHE = Path(sys.argv[sys.argv.index("--cache") + 1])
TOP_K = 5
PAUSE_SECONDS = 4.5  # keeps real calls under about 13 per minute


def load_documents(names: list[str]) -> dict[str, tuple[list[Segment], list[str], list[tuple[int, str]]]]:
    documents = {}
    for name in names:
        pages = json.loads((HERE / "sets" / f"{name}.json").read_text(encoding="utf-8"))["pages"]
        if "--long" in sys.argv and name == "ru_contract":
            sys.path.insert(0, str(HERE.parent / "demo"))
            from make_demo_pdfs import long_lease

            pages = long_lease(pages)
        segments = [Segment(page=n, location=None, text=normalize(t)) for n, t in enumerate(pages, 1)]
        chunks = build_chunks(segments)
        documents[name] = (segments, [text for _seq, text in chunks], chunks)
    return documents


def pages_for(query: str, document) -> list[int]:
    segments, texts, chunks = document
    return [segments[chunks[i][0]].page for i, _score in rank(query, texts, TOP_K)]


async def translate_all(queries: list[dict], languages: dict[str, str], cache: dict) -> int:
    """Fills the cache for questions that have no saved translation. Returns how many are still missing."""
    from app.deps import get_answerer

    answerer = get_answerer.__wrapped__()
    translate = getattr(answerer, "translate_query", None) if answerer else None
    missing = 0
    for item in queries:
        targets = translation_targets(query_language(item["q"]), [languages[item["doc"]]])
        key = f"{item['q']}|{','.join(targets)}"
        if not targets or key in cache:
            continue
        if translate is None:
            missing += 1
            continue
        result = None
        for attempt in range(4):  # a per-minute quota is waited out, not counted as a failure
            result = await translate(item["q"], [LANGUAGE_NAMES[t] for t in targets])
            if result:
                break
            await asyncio.sleep(25)
        await asyncio.sleep(PAUSE_SECONDS)
        if result:
            cache[key] = result
            CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")
        else:
            missing += 1
    return missing


def main() -> None:
    verbose = "-v" in sys.argv
    data = json.loads((HERE / "cross_language_queries.json").read_text(encoding="utf-8"))
    languages, queries = data["docs"], data["queries"]
    documents = load_documents(list(languages))
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    missing = asyncio.run(translate_all(queries, languages, cache))
    CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")

    stats = defaultdict(lambda: defaultdict(int))
    for item in queries:
        document = documents[item["doc"]]
        pair = f"{languages[item['doc']]} document <- {item['lang']} question"
        targets = translation_targets(query_language(item["q"]), [languages[item["doc"]]])
        translated = clean_translation(cache.get(f"{item['q']}|{','.join(targets)}", ""), targets)
        before = pages_for(item["q"], document)
        after = pages_for(f"{item['q']} {translated}", document)
        row = stats[pair]
        for label, pages in (("before", before), ("after", after)):
            if item["page"] is None:
                row[f"{label}_neg"] += 1
                row[f"{label}_neg_clean"] += not pages
            else:
                row[f"{label}_pos"] += 1
                row[f"{label}_top1"] += bool(pages) and pages[0] == item["page"]
                row[f"{label}_top5"] += item["page"] in pages
        if verbose and item["page"] is not None and item["page"] not in after:
            print(f"  MISS after: expected p.{item['page']}, got {after} <- {item['q']}  | {translated[:60]!r}")
    print(f"{'pair':<34}{'in top-5 before':>17}{'in top-5 after':>16}{'top-1 after':>13}{'no-answer: nothing found (before/after)':>42}")
    total = defaultdict(int)
    for pair, row in sorted(stats.items()):
        for key, value in row.items():
            total[key] += value
        print(
            f"{pair:<34}{row['before_top5']:>10}/{row['before_pos']:<6}{row['after_top5']:>9}/{row['after_pos']:<6}"
            f"{row['after_top1']:>6}/{row['after_pos']:<6}{row['before_neg_clean']:>20}/{row['before_neg']} -> {row['after_neg_clean']}/{row['after_neg']}"
        )
    print(
        f"{'ALL':<34}{total['before_top5']:>10}/{total['before_pos']:<6}{total['after_top5']:>9}/{total['after_pos']:<6}"
        f"{total['after_top1']:>6}/{total['after_pos']:<6}{total['before_neg_clean']:>20}/{total['before_neg']} -> {total['after_neg_clean']}/{total['after_neg']}"
    )
    if missing:
        print(f"\nNOT VERIFIED: {missing} questions have no translation (no key and no saved translation).")


if __name__ == "__main__":
    main()
