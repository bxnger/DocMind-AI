"""End-to-end evaluation: upload a PDF, ask each question through the real chat endpoint.

Needs a key for the chosen provider in the environment or backend/.env (ANTHROPIC_API_KEY or
GEMINI_API_KEY with LLM_PROVIDER). It calls the real model and costs a little. For every question it records
whether the answer was given or refused, which pages were cited, how long it took, and whether the provider
failed, then compares the pages with the expected one.

    python eval/answer_eval.py demo.pdf eval/sample_set.json

The question file has the same format as for retrieval_eval.py; only "questions" is used, with
{"q": "...", "page": 3} for an answerable question and {"q": "...", "page": null} for one the PDF cannot answer.
Everything runs in a temporary data directory, nothing is kept.
"""
import json
import statistics
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from app.config import Settings  # noqa: E402
from app.deps import get_answerer, get_store  # noqa: E402
from app.main import create_app  # noqa: E402
from app.store import Store  # noqa: E402


@dataclass
class Result:
    question: str
    expected_page: int | None
    answered: bool
    cited_pages: list[int]
    text: str
    seconds: float = 0.0
    error_code: str | None = None  # a provider failure: not an answer and not a refusal
    expected_pages: list[int] | None = None  # for a question that needs several pages

    @property
    def correct(self) -> bool:
        if self.error_code:
            return False
        if self.expected_pages:
            return self.answered and all(page in self.cited_pages for page in self.expected_pages)
        if self.expected_page is None:
            return not self.answered
        return self.answered and self.expected_page in self.cited_pages


def parse_sse(text: str) -> list[tuple[str, dict]]:
    events = []
    for block in text.strip().split("\n\n"):
        fields = dict(line.split(": ", 1) for line in block.split("\n"))
        events.append((fields["event"], json.loads(fields["data"])))
    return events


def evaluate(pdf_path: Path, questions: list[dict], answerer, data_dir: Path) -> list[Result]:
    """Runs the questions against the PDF with the given answerer (the real one, or a fake in tests)."""
    store = Store(data_dir)
    settings = Settings(data_dir=data_dir, upload_limit_per_minute=1000, chat_limit_per_minute=1000)
    app = create_app(settings, store)
    app.dependency_overrides[get_store] = lambda: store
    app.dependency_overrides[get_answerer] = lambda: answerer
    client = TestClient(app)

    upload = client.post("/api/v1/documents", files={"file": (pdf_path.name, pdf_path.read_bytes(), "application/pdf")})
    upload.raise_for_status()
    document = client.get(f"/api/v1/documents/{upload.json()['id']}").json()
    if document["status"] != "ready":
        raise SystemExit(f"The PDF could not be processed: {document['error']}")

    results = []
    for item in questions:
        # A fresh conversation per question keeps earlier answers out of the context.
        conversation = client.post("/api/v1/conversations", json={"documentIds": [document["id"]]}).json()
        started = time.perf_counter()
        response = client.post(f"/api/v1/conversations/{conversation['id']}/messages", json={"content": item["q"]})
        seconds = time.perf_counter() - started
        if response.status_code != 200:
            code = response.json().get("error", {}).get("code", f"HTTP_{response.status_code}")
            results.append(Result(item["q"], item.get("page"), False, [], "", seconds, code, item.get("pages")))
            continue
        events = parse_sse(response.text)
        error = next((data for name, data in events if name == "error"), None)
        if error:
            results.append(Result(item["q"], item.get("page"), False, [], "", seconds, error.get("code", "ERROR"), item.get("pages")))
            continue
        sources = next((data["sources"] for name, data in events if name == "sources"), [])
        status = next(data["answerStatus"] for name, data in events if name == "done")
        results.append(
            Result(
                question=item["q"],
                expected_page=item.get("page"),
                expected_pages=item.get("pages"),
                seconds=seconds,
                answered=status == "answered",
                cited_pages=sorted({s["page"] for s in sources if s["page"] is not None}),
                text="".join(data["text"] for name, data in events if name == "token"),
            )
        )
    return results


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, round(fraction * (len(ordered) - 1)))]


def report(results: list[Result]) -> None:
    for result in results:
        mark = "ok  " if result.correct else "FAIL"
        want = result.expected_pages or result.expected_page
        if result.error_code:
            state = f"PROVIDER ERROR {result.error_code}"
        else:
            state = f"answered, cited {result.cited_pages}" if result.answered else "not_found"
        print(f"{mark} p.{want!s:>8}  {state:<30} {result.seconds:5.1f}s  {result.question}")
    asked = [r for r in results if not r.error_code]
    errors = [r for r in results if r.error_code]
    answerable = [r for r in asked if r.expected_page is not None or r.expected_pages]
    unanswerable = [r for r in asked if r.expected_page is None and not r.expected_pages]
    wrong_answers = [r for r in answerable if r.answered and not r.correct]
    wrongly_answered = [r for r in unanswerable if r.answered]
    print()
    print(f"questions: {len(results)}, provider errors: {len(errors)} ({len(errors) / max(len(results), 1):.0%})")
    print(f"answerable: {sum(r.correct for r in answerable)}/{len(answerable)} answered with the expected page(s) cited")
    print(f"  answered but cited the wrong page: {len(wrong_answers)} (unsupported-claim proxy)")
    print(f"unanswerable: {sum(r.correct for r in unanswerable)}/{len(unanswerable)} correctly refused; {len(wrongly_answered)} wrongly answered")
    if asked:
        seconds = [r.seconds for r in asked]
        print(f"latency: median {statistics.median(seconds):.1f}s, p95 {percentile(seconds, 0.95):.1f}s, max {max(seconds):.1f}s")
    print("Note: errors are counted separately and never shown as refusals.")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    from app.deps import get_answerer as real_answerer

    answerer = real_answerer.__wrapped__()  # bypass the cache so the key is read now
    if answerer is None:
        raise SystemExit("No model configured: set LLM_PROVIDER and the matching key in backend/.env or the environment.")
    questions = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))["questions"]
    with tempfile.TemporaryDirectory() as directory:
        report(evaluate(Path(sys.argv[1]), questions, answerer, Path(directory)))
