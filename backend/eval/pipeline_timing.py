"""Times the parts of the pipeline that do not need a model: upload to ready (extraction and indexing), search,
and answer verification. Uses a scripted answerer, so there is no network and no key.

    python eval/pipeline_timing.py [path.pdf ...]

With no arguments it builds a 300-page synthetic PDF (the upload limit) and uses the demo files if they exist.
The model's own time is not measured here: see answer_eval.py, which reports it with a real key.
"""
import statistics
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pymupdf  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.config import Settings  # noqa: E402
from app.deps import get_answerer, get_store  # noqa: E402
from app.main import create_app  # noqa: E402
from app.store import Store  # noqa: E402

HERE = Path(__file__).resolve().parent
FONTS = (r"C:\Windows\Fonts\arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
WORDS = "payment delivery warranty penalty notice supplier customer premises invoice equipment report claim".split()


class Scripted:
    """Answers [1] over whatever the search found, so the timing covers search and verification only."""

    model = "scripted"

    async def stream(self, question, excerpts, language, history):
        yield f"{excerpts[0].text.split('.')[0]}. [1]" if excerpts else "NOT_FOUND"


def synthetic_pdf(path: Path, pages: int = 300) -> None:
    doc = pymupdf.open()
    for number in range(pages):
        page = doc.new_page()
        text = " ".join(f"{WORDS[(number + i) % len(WORDS)]} clause {number}-{i} applies to the parties." for i in range(18))
        page.insert_textbox(pymupdf.Rect(48, 48, 548, 790), text, fontsize=10)
    doc.save(path)


def timed_run(client: TestClient, path: Path, question: str) -> None:
    started = time.perf_counter()
    created = client.post("/api/v1/documents", files={"file": (path.name, path.read_bytes(), "application/octet-stream")})
    upload_ms = (time.perf_counter() - started) * 1000
    document = created.json()
    while client.get(f"/api/v1/documents/{document['id']}").json()["status"] == "processing":
        time.sleep(0.05)
    ready_ms = (time.perf_counter() - started) * 1000
    state = client.get(f"/api/v1/documents/{document['id']}").json()
    if state["status"] != "ready":
        print(f"{path.name:<22} FAILED {state['error']}")
        return
    conversation = client.post("/api/v1/conversations", json={"documentIds": [document["id"]]}).json()
    totals = []
    for _ in range(5):
        started = time.perf_counter()
        client.post(f"/api/v1/conversations/{conversation['id']}/messages", json={"content": question})
        totals.append((time.perf_counter() - started) * 1000)
        client.delete(f"/api/v1/conversations/{conversation['id']}")
        conversation = client.post("/api/v1/conversations", json={"documentIds": [document["id"]]}).json()
    print(
        f"{path.name:<22} pages={state['pageCount'] or '-':<4} upload_request={upload_ms:6.0f} ms  "
        f"upload->ready={ready_ms:7.0f} ms  question (search+verify, scripted model) median={statistics.median(totals):5.0f} ms"
    )


def main() -> None:
    files = [Path(arg) for arg in sys.argv[1:]]
    with tempfile.TemporaryDirectory() as directory:
        data_dir = Path(directory)
        if not files:
            big = data_dir / "synthetic_300_pages.pdf"
            synthetic_pdf(big)
            files = [big] + [p for p in (HERE.parent / "demo" / n for n in ("lease_long.pdf", "lease_v1.docx", "lease_v1.pdf")) if p.exists()]
        store = Store(data_dir / "data")
        app = create_app(Settings(data_dir=data_dir / "data", upload_limit_per_minute=1000, chat_limit_per_minute=1000), store)
        app.dependency_overrides[get_store] = lambda: store
        app.dependency_overrides[get_answerer] = lambda: Scripted()
        with TestClient(app) as client:
            for path in files:
                timed_run(client, path, "What penalty applies to the supplier?")


if __name__ == "__main__":
    main()
