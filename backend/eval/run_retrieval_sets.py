"""Runs the search step over every set in eval/sets and prints one table. No model, no network.

    python eval/run_retrieval_sets.py [-v]      # -v lists every question that missed

The sets are synthetic and written by the developers: they show whether the search works across
languages and similar clauses, not how it would score on real jury documents.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.chunking import build_chunks  # noqa: E402
from app.extraction import Segment, normalize  # noqa: E402
from app.retrieval import rank  # noqa: E402

TOP_K = 5
KEYS = ("answerable", "top1", "topk", "unanswerable", "refused")


def evaluate(path: Path, verbose: bool) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    segments = [Segment(page=n, location=None, text=normalize(t)) for n, t in enumerate(data["pages"], 1)]
    chunks = build_chunks(segments)
    texts = [text for _seq, text in chunks]
    result = dict.fromkeys(KEYS, 0)
    for item in data["questions"]:
        hits = rank(item["q"], texts, TOP_K)
        pages = [segments[chunks[i][0]].page for i, _score in hits]
        if "pages" in item:  # needs several pages: all of them must be among the top results
            result["answerable"] += 1
            result["top1"] += bool(pages) and pages[0] in item["pages"]
            result["topk"] += all(page in pages for page in item["pages"])
            if verbose and not all(page in pages for page in item["pages"]):
                print(f"  {path.stem}: expected pages {item['pages']}, got {pages}  <- {item['q']}")
            continue
        expected = item["page"]
        if expected is None:
            result["unanswerable"] += 1
            result["refused"] += not pages
            ok = not pages
        else:
            result["answerable"] += 1
            result["top1"] += bool(pages) and pages[0] == expected
            result["topk"] += expected in pages
            ok = bool(pages) and pages[0] == expected
        if verbose and not ok:
            print(f"  {path.stem}: expected p.{expected}, got {pages}  <- {item['q']}")
    return result


def main() -> None:
    verbose = "-v" in sys.argv
    total = dict.fromkeys(KEYS, 0)
    print(f"{'set':<22}{'top-1':>9}{'top-5':>9}{'no-answer refused':>22}")
    for path in sorted(Path(__file__).with_name("sets").glob("*.json")):
        r = evaluate(path, verbose)
        for key in KEYS:
            total[key] += r[key]
        print(f"{path.stem:<22}{r['top1']:>5}/{r['answerable']:<3}{r['topk']:>5}/{r['answerable']:<3}{r['refused']:>17}/{r['unanswerable']}")
    print(f"{'ALL':<22}{total['top1']:>5}/{total['answerable']:<3}{total['topk']:>5}/{total['answerable']:<3}{total['refused']:>17}/{total['unanswerable']}")


if __name__ == "__main__":
    main()
