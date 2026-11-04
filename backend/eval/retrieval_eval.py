"""Retrieval-only evaluation: no model, no network.

For each question, checks whether the expected page is among the top-5 BM25 chunks, and that questions
with no answer ("page": null) retrieve nothing. This measures the search step only. It says nothing about
the quality of Claude's answers.

    python eval/retrieval_eval.py [path/to/set.json]

Set format: {"pages": ["text of page 1", ...], "questions": [{"q": "...", "page": 1}, ...]}
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.chunking import build_chunks  # noqa: E402
from app.extraction import Segment, normalize  # noqa: E402
from app.retrieval import rank  # noqa: E402

TOP_K = 5


def main(path: Path) -> int:
    data = json.loads(path.read_text(encoding="utf-8"))
    segments = [Segment(page=number, location=None, text=normalize(text)) for number, text in enumerate(data["pages"], 1)]
    chunks = build_chunks(segments)
    texts = [text for _seq, text in chunks]

    answerable = hit_at_1 = hit_at_k = unanswerable = clean_refusals = 0
    for item in data["questions"]:
        hits = rank(item["q"], texts, TOP_K)
        pages = [segments[chunks[index][0]].page for index, _score in hits]
        expected = item["page"]
        if expected is None:
            unanswerable += 1
            clean_refusals += not pages
            outcome = "ok (nothing retrieved)" if not pages else f"retrieved pages {pages}"
        else:
            answerable += 1
            hit_at_1 += bool(pages) and pages[0] == expected
            hit_at_k += expected in pages
            outcome = "ok" if expected in pages else f"MISS, got {pages}"
        note = f"  [{item['known_weak']}]" if "known_weak" in item else ""
        print(f"p.{expected!s:>4}  {outcome:<28} {item['q']}{note}")

    print()
    print(f"answerable questions: {answerable}")
    print(f"  expected page is top-1:  {hit_at_1}/{answerable}")
    print(f"  expected page in top-{TOP_K}: {hit_at_k}/{answerable}")
    print(f"unanswerable questions: {unanswerable}, nothing retrieved for {clean_refusals}")
    return 0


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).with_name("sample_set.json"))
