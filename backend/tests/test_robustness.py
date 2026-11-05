import sys
import time
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.deps import get_answerer
from app.main import create_app
from app.routers.conversations import best_sentence, claim_for
from tests.conftest import FakeAnswerer, make_pdf
from tests.test_chat import ask, conversation_for, upload

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "eval"))
import answer_eval  # noqa: E402


def wait_for(condition, seconds=10.0):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if condition():
            return True
        time.sleep(0.05)
    return False


def test_restart_finishes_documents_left_processing(store):
    doc_id = store.new_id()
    store.file_path(doc_id, "pdf").write_bytes(make_pdf(["Left over from before the restart."]))
    store.insert(doc_id, "old.pdf", "pdf", 100)
    assert store.get(doc_id)["status"] == "processing"

    app = create_app(Settings(data_dir=store.files_dir.parent), store)
    with TestClient(app):  # entering the client runs startup
        assert wait_for(lambda: store.get(doc_id)["status"] == "ready")


def test_restart_fails_comparisons_left_processing(store):
    comparison = store.create_comparison("a", "b")

    app = create_app(Settings(data_dir=store.files_dir.parent), store)
    with TestClient(app):
        assert wait_for(lambda: store.get_comparison(comparison["id"])["status"] == "failed")
    assert store.get_comparison(comparison["id"])["error"]["retryable"] is True


def test_best_sentence_picks_the_one_that_answers():
    text = "Intro about nothing. Registration closes on 5 November 2026. Closing remarks follow."
    assert best_sentence(text, "When does registration close?") == "Registration closes on 5 November 2026."


def test_best_sentence_falls_back_to_the_whole_excerpt():
    text = "First sentence here. Second sentence there."
    assert best_sentence(text, "zzz qqq") == text
    assert best_sentence("Just one sentence.", "sentence") == "Just one sentence."


def test_claim_is_the_sentence_with_the_marker():
    assert claim_for("First claim [1]. Second claim [2].", 2) == "Second claim [2]."
    assert claim_for("No markers.", 1) == ""


def test_quote_is_the_relevant_sentence_not_the_whole_page(client, answerer):
    page = "Intro about nothing.\nRegistration closes on 5 November 2026.\nClosing remarks follow here."
    document_id = upload(client, "rules.pdf", make_pdf([page])).json()["id"]
    conversation_id = conversation_for(client, document_id)
    answerer.reply = "Registration closes on 5 November 2026 [1]."

    events = ask(client, conversation_id, "When does registration close?")
    source = next(data["sources"] for name, data in events if name == "sources")[0]
    assert source["quote"] == "Registration closes on 5 November 2026."
    assert source["highlights"]


def test_answer_eval_scores_answers_and_refusals(tmp_path):
    pdf = tmp_path / "rules.pdf"
    pdf.write_bytes(make_pdf(["Registration closes on 5 November 2026.", "Teams have at most three members."]))
    questions = [
        {"q": "When does registration close?", "page": 1},
        {"q": "How many members can a team have?", "page": 2},
        {"q": "quantum chromodynamics", "page": None},
    ]

    class Scripted(FakeAnswerer):
        async def stream(self, question, excerpts, language, history):
            self.reply = "NOT_FOUND" if "quantum" in question else "Yes [1]."
            async for piece in super().stream(question, excerpts, language, history):
                yield piece

    results = answer_eval.evaluate(pdf, questions, Scripted(), tmp_path / "data")
    assert [r.correct for r in results] == [True, True, True]
    assert [r.cited_pages for r in results] == [[1], [2], []]
