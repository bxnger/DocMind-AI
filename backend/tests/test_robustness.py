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


def test_a_summary_question_samples_a_wide_bounded_part_of_a_long_document(client, answerer):
    from tests.test_chat import BIG_DOCUMENT, ask, conversation_for, ready_document

    document = ready_document(client, pages=BIG_DOCUMENT)  # 15 chunks
    answerer.reply = "Registration closes on 5 November 2026 [1]."
    ask(client, conversation_for(client, document), "What is this document about?")
    sent = answerer.calls[0][1]
    assert len(sent) == 12 and sent[0].page == 1 and sent[-1].page == 15  # from the start to the end, never unbounded


def test_concurrent_questions_on_different_documents_do_not_mix(client, answerer):
    from concurrent.futures import ThreadPoolExecutor

    from tests.test_chat import ask, conversation_for, ready_document

    a = ready_document(client, pages=("Alpha rule: the fee is 111 USD.",))
    b = ready_document(client, pages=("Beta rule: the fee is 222 USD.",))
    conversations = [(conversation_for(client, a), "111"), (conversation_for(client, b), "222")] * 4

    async def stream(question, excerpts, language, history):
        yield f"The fee is {excerpts[0].text.split()[-2]} USD [1]."

    answerer.stream = stream

    def run(item):
        conversation, fee = item
        events = dict(ask(client, conversation, "What is the fee?"))
        return fee, events["done"]["answerStatus"], events["sources"]["sources"][0]["quote"]

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(run, conversations))
    assert all(status == "answered" and fee in quote for fee, status, quote in results)


def test_a_hostile_file_name_cannot_write_outside_the_data_directory(client, store, tmp_path):
    from tests.conftest import make_pdf

    for name in ("../../evil.pdf", "..\\..\\evil.pdf", "/etc/passwd.pdf", "a\x00b.pdf"):
        response = client.post(
            "/api/v1/documents", files={"file": (name, make_pdf(["Some text for the index."]), "application/pdf")}
        )
        assert response.status_code in (202, 415, 422), name
    outside = [p for p in tmp_path.parent.rglob("evil.pdf")]
    assert outside == []  # files are stored under a generated id, never under the uploaded name
    assert all(path.parent == store.files_dir for path in store.files_dir.glob("*.pdf"))
