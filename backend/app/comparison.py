import difflib
import re
from dataclasses import dataclass

from app.chunking import SENTENCE_END
from app.citations import is_verbatim
from app.errors import AppError
from app.store import Store

MAX_SENTENCES = 3000
SIMILAR_ENOUGH = 0.5
NUMBER = re.compile(r"\d+(?:[.,]\d+)?")


@dataclass(frozen=True)
class Sentence:
    text: str
    page: int | None
    location: str | None
    segment_text: str


def load_sentences(store: Store, doc_id: str) -> list[Sentence]:
    sentences = []
    for segment in store.segments_for_document(doc_id):
        for text in SENTENCE_END.split(segment["text"]):
            if text:
                sentences.append(Sentence(text, segment["page"], segment["location"], segment["text"]))
    if len(sentences) > MAX_SENTENCES:
        raise AppError(
            413,
            "DOCUMENT_TOO_LARGE_FOR_COMPARISON",
            f"Documents of more than {MAX_SENTENCES} sentences cannot be compared",
        )
    return sentences


def compare(a: list[Sentence], b: list[Sentence]) -> list[dict]:
    """Sentence-level differences between two documents, in document order.

    No model is involved: a pair of similar sentences is "changed", the rest is "added" or "removed".
    """
    matcher = difflib.SequenceMatcher(None, [s.text for s in a], [s.text for s in b], autojunk=False)
    differences: list[dict] = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        right = b[j1:j2]
        paired: set[int] = set()
        for left_sentence in a[i1:i2]:
            best, best_ratio = None, SIMILAR_ENOUGH
            for index, candidate in enumerate(right):
                if index in paired:
                    continue
                ratio = difflib.SequenceMatcher(None, left_sentence.text, candidate.text).ratio()
                if ratio >= best_ratio:
                    best, best_ratio = index, ratio
            if best is None:
                differences.append(_difference("removed", "Only in the first document", left_sentence, None))
            else:
                paired.add(best)
                differences.append(
                    _difference("changed", _explain_change(left_sentence.text, right[best].text), left_sentence, right[best])
                )
        for index, candidate in enumerate(right):
            if index not in paired:
                differences.append(_difference("added", "Only in the second document", None, candidate))
    for number, difference in enumerate(differences, start=1):
        difference["id"] = str(number)
    return differences


def summarize(differences: list[dict]) -> str:
    if not differences:
        return "No differences found."
    counts = {kind: sum(1 for d in differences if d["type"] == kind) for kind in ("changed", "added", "removed")}
    return (
        f"{len(differences)} differences: {counts['changed']} changed, "
        f"{counts['added']} only in the second document, {counts['removed']} only in the first."
    )


def _explain_change(before: str, after: str) -> str:
    numbers_before, numbers_after = NUMBER.findall(before), NUMBER.findall(after)
    if numbers_before != numbers_after:
        return f"Numbers differ: {', '.join(numbers_before) or 'none'} vs {', '.join(numbers_after) or 'none'}"
    return "The wording differs"


def _difference(kind: str, explanation: str, a: Sentence | None, b: Sentence | None) -> dict:
    return {"type": kind, "explanation": explanation, "a": _evidence(a), "b": _evidence(b)}


def _evidence(sentence: Sentence | None) -> dict | None:
    if sentence is None or not is_verbatim(sentence.text, sentence.segment_text):
        return None
    return {"page": sentence.page, "quote": sentence.text}


def run_comparison(store: Store, comparison_id: str, a: list[Sentence], b: list[Sentence]) -> None:
    """Background task: ends the comparison in `ready` or `failed`."""
    try:
        store.set_comparison_progress(comparison_id, 0.1)
        differences = compare(a, b)
        store.finish_comparison(comparison_id, summarize(differences), differences)
    except Exception:
        store.fail_comparison(comparison_id, "INTERNAL_ERROR", "The comparison failed")
