import difflib
import re
from dataclasses import dataclass

from app.chunking import SENTENCE_END
from app.citations import is_verbatim
from app.errors import AppError
from app.store import Store

MAX_SENTENCES = 3000
SIMILAR_ENOUGH = 0.5
MAX_FULL_PAIRING = 2_500  # blocks up to about 50 x 50 sentences are compared exhaustively
PAIRING_WINDOW = 10
NUMBER = re.compile(r"\d{1,3}(?:[  ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?")  # "450 000" is one number


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


# "1.", "2.3", "5)", "(4)", "№ 7" at the start of a clause. Deleting a clause renumbers the ones after it, and the
# number alone must neither make two clauses look different nor make unrelated ones look alike.
CLAUSE_NUMBER = re.compile(r"^\s*(?:\(\d+\)|(?:\d+\.)+\d*|\d+\)|[№§#]\s*\d+)\s+")


def strip_clause_number(text: str) -> str:
    return CLAUSE_NUMBER.sub("", text, count=1)


def similarity(left: str, right: str) -> float:
    matcher = difflib.SequenceMatcher(None, left, right)
    if matcher.real_quick_ratio() < SIMILAR_ENOUGH or matcher.quick_ratio() < SIMILAR_ENOUGH:
        return 0.0  # cheap upper bounds: cannot reach the threshold
    return matcher.ratio()


def pair_sentences(left: list[Sentence], right: list[Sentence]) -> dict[int, int]:
    """Matches sentences of two unmatched blocks, most similar pairs first.

    Choosing the best pairs first (not the first sentence's best partner) keeps a deleted clause from
    stealing the partner of the clause that really changed. Ties break by position, so the result is
    the same on every run.
    """
    candidates = []
    # A large rewritten block would need millions of comparisons: look only near the same relative position.
    wide = len(left) * len(right) > MAX_FULL_PAIRING
    for i, left_sentence in enumerate(left):
        left_text = strip_clause_number(left_sentence.text)
        centre = round(i * len(right) / len(left))
        for j, right_sentence in enumerate(right):
            if wide and abs(j - centre) > PAIRING_WINDOW:
                continue
            ratio = similarity(left_text, strip_clause_number(right_sentence.text))
            if ratio >= SIMILAR_ENOUGH:
                candidates.append((-ratio, abs(i - j), i, j))
    candidates.sort()
    pairs: dict[int, int] = {}
    taken: set[int] = set()
    for _negative_ratio, _distance, i, j in candidates:
        if i not in pairs and j not in taken:
            pairs[i] = j
            taken.add(j)
    return pairs


def compare(a: list[Sentence], b: list[Sentence]) -> list[dict]:
    """Sentence-level differences between two documents, in document order.

    No model is involved: a pair of similar sentences is "changed", the rest is "added" or "removed".
    Text that only moved is reported as changed with the explanation "Moved".
    """
    matcher = difflib.SequenceMatcher(None, [s.text for s in a], [s.text for s in b], autojunk=False)
    differences: list[dict] = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        left, right = a[i1:i2], b[j1:j2]
        pairs = pair_sentences(left, right)
        for i, left_sentence in enumerate(left):
            if i in pairs:
                partner = right[pairs[i]]
                differences.append(
                    _difference("changed", _explain_change(left_sentence.text, partner.text), left_sentence, partner)
                )
            else:
                differences.append(_difference("removed", "Only in the first document", left_sentence, None))
        paired_right = set(pairs.values())
        for j, candidate in enumerate(right):
            if j not in paired_right:
                differences.append(_difference("added", "Only in the second document", None, candidate))
    differences = _join_moved(differences, a, b)
    for number, difference in enumerate(differences, start=1):
        difference["id"] = str(number)
    return differences


def _join_moved(differences: list[dict], a: list[Sentence], b: list[Sentence]) -> list[dict]:
    """A sentence that is removed in one place and added unchanged in another was moved, not rewritten."""
    removed = [d for d in differences if d["type"] == "removed" and d["a"]]
    added = [d for d in differences if d["type"] == "added" and d["b"]]
    by_text: dict[str, list[dict]] = {}
    for difference in added:
        by_text.setdefault(difference["b"]["quote"], []).append(difference)
    drop: set[int] = set()
    for difference in removed:
        partners = by_text.get(difference["a"]["quote"])
        if partners:
            partner = partners.pop(0)
            difference.update(type="changed", explanation="Moved to a different place", b=partner["b"])
            drop.add(id(partner))
    return [d for d in differences if id(d) not in drop]


def summarize(differences: list[dict]) -> str:
    if not differences:
        return "No differences found."
    counts = {kind: sum(1 for d in differences if d["type"] == kind) for kind in ("changed", "added", "removed")}
    return (
        f"{len(differences)} differences: {counts['changed']} changed, "
        f"{counts['added']} only in the second document, {counts['removed']} only in the first."
    )


def _explain_change(before: str, after: str) -> str:
    if before == after:
        return "Moved to a different place"
    if strip_clause_number(before) == strip_clause_number(after):
        return "Only the clause number differs"
    before, after = strip_clause_number(before), strip_clause_number(after)  # a clause number is not a changed figure
    numbers_before, numbers_after = NUMBER.findall(before), NUMBER.findall(after)
    if numbers_before != numbers_after:
        # Show only the figures that changed: "450 000 vs 500 000", not every number in the sentence.
        gone = [n for n in numbers_before if n not in numbers_after]
        new = [n for n in numbers_after if n not in numbers_before]
        return f"Numbers differ: {', '.join(gone) or 'none'} vs {', '.join(new) or 'none'}"
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
