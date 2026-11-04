"""End-to-end evaluation: upload a PDF, ask each question through the real chat endpoint.

Needs ANTHROPIC_API_KEY (it calls Claude and costs a little money). For every question it records whether
the answer was given or refused, which pages were cited, and compares them with the expected page.

    python eval/answer_eval.py demo.pdf eval/sample_set.json

The question file has the same format as for retrieval_eval.py; only "questions" is used, with
{"q": "...", "page": 3} for an answerable question and {"q": "...", "page": null} for one the PDF cannot answer.
Everything runs in a temporary data directory, nothing is kept.
"""
import json
import sys
import tempfile
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

    @property
    def correct(self) -> bool:
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
        response = client.post(f"/api/v1/conversations/{conversation['id']}/messages", json={"content": item["q"]})
        events = parse_sse(response.text)
        sources = next((data["sources"] for name, data in events if name == "sources"), [])
        status = next(data["answerStatus"] for name, data in events if name == "done")
        results.append(
            Result(
                question=item["q"],
                expected_page=item["page"],
                answered=status == "answered",
                cited_pages=sorted({s["page"] for s in sources if s["page"] is not None}),
                text="".join(data["text"] for name, data in events if name == "token"),
            )
        )
    return results


def report(results: list[Result]) -> None:
    for result in results:
        mark = "ok  " if result.correct else "FAIL"
        state = f"answered, cited {result.cited_pages}" if result.answered else "not_found"
        print(f"{mark} p.{result.expected_page!s:>4}  {state:<28} {result.question}")
    answerable = [r for r in results if r.expected_page is not None]
    unanswerable = [r for r in results if r.expected_page is None]
    print()
    print(f"answerable: {sum(r.correct for r in answerable)}/{len(answerable)} answered with the expected page cited")
    print(f"unanswerable: {sum(r.correct for r in unanswerable)}/{len(unanswerable)} correctly refused")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    from app.deps import get_answerer as real_answerer

    answerer = real_answerer.__wrapped__()  # bypass the cache so the key is read now
    if answerer is None:
        raise SystemExit("Set ANTHROPIC_API_KEY first.")
    questions = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))["questions"]
    with tempfile.TemporaryDirectory() as directory:
        report(evaluate(Path(sys.argv[1]), questions, answerer, Path(directory)))
