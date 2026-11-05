"""Search accuracy and speed on a long document (default 300 pages, the upload limit). No model, no network.

Builds a deterministic document of boilerplate clauses that share vocabulary with the questions, hides a few
facts in it ("needles") and checks that the search puts the right page first. Also prints how long one
search takes, which is the retrieval part of the answer latency.

    python eval/long_document_eval.py [pages]

Synthetic: boilerplate is easier and stranger than a real contract, so treat the accuracy as a smoke test
and the timing as the useful number.
"""
import random
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.chunking import build_chunks  # noqa: E402
from app.extraction import Segment, normalize  # noqa: E402
from app.retrieval import rank  # noqa: E402

SUBJECTS = ["The Supplier", "The Customer", "The Contractor", "The Tenant", "The Landlord", "The Employee"]
VERBS = ["shall notify", "must pay", "may terminate", "is responsible for", "shall deliver", "agrees to review"]
OBJECTS = ["the invoice", "the equipment", "the premises", "the annual report", "the penalty", "the warranty claim"]
CONDITIONS = ["within the agreed period", "in writing", "after written notice", "at its own cost", "on the first day of each month"]

NEEDLES = [
    ("The deposit is refunded within 14 working days after the keys are returned.", "How many working days until the deposit is refunded?"),
    ("The late delivery penalty is 0.7% of the order value for each full week.", "What is the late delivery penalty per week?"),
    ("The arbitration seat is Almaty and the language of proceedings is Russian.", "Where is the arbitration seat?"),
    ("Software warranty covers defects reported within 18 months of acceptance.", "How long does the software warranty cover defects?"),
    ("The maximum liability of the Supplier is capped at 2 500 000 KZT.", "What is the liability cap of the Supplier?"),
    ("Confidential information must be destroyed within 45 days of termination.", "When must confidential information be destroyed?"),
]


def build_document(pages: int, seed: int = 7) -> tuple[list[str], list[tuple[str, int]]]:
    rng = random.Random(seed)
    texts = []
    for _ in range(pages):
        clauses = [
            f"{rng.choice(SUBJECTS)} {rng.choice(VERBS)} {rng.choice(OBJECTS)} {rng.choice(CONDITIONS)}."
            for _ in range(rng.randint(8, 14))
        ]
        texts.append(" ".join(clauses))
    placed = []
    for (fact, question), page in zip(NEEDLES, rng.sample(range(1, pages + 1), len(NEEDLES))):
        texts[page - 1] += " " + fact
        placed.append((question, page))
    return texts, placed


def main(pages: int) -> None:
    texts, questions = build_document(pages)
    segments = [Segment(page=n, location=None, text=normalize(t)) for n, t in enumerate(texts, 1)]
    chunks = build_chunks(segments)
    chunk_texts = [text for _seq, text in chunks]
    top1 = top5 = 0
    timings = []
    for question, page in questions:
        started = time.perf_counter()
        hits = rank(question, chunk_texts, 5)
        timings.append((time.perf_counter() - started) * 1000)
        found = [segments[chunks[i][0]].page for i, _score in hits]
        top1 += bool(found) and found[0] == page
        top5 += page in found
        print(f"p.{page:<4} {'ok' if found[:1] == [page] else f'got {found}':<22} {question}")
    print()
    print(f"{pages} pages, {len(chunks)} chunks, {len(questions)} questions")
    print(f"expected page first: {top1}/{len(questions)}, in top-5: {top5}/{len(questions)}")
    print(f"one search: median {statistics.median(timings):.0f} ms, max {max(timings):.0f} ms")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 300)
