"""Adds public, read-only demo documents: python -m app.demo_docs file.pdf [file.docx ...]

Run on the server by whoever deploys. Every session can read these and ask about them; nobody can delete them
through the API. Never add a private document.
"""

import shutil
import sys
from pathlib import Path

from app.deps import get_store
from app.pipeline import process_document


def add(path: Path) -> str:
    store = get_store()
    kind = path.suffix.lower().lstrip(".")
    doc_id = store.new_id()
    shutil.copyfile(path, store.file_path(doc_id, kind))
    store.insert(doc_id, path.name, kind, path.stat().st_size)
    store.mark_demo(doc_id)
    process_document(store, doc_id)
    return store.get(doc_id)["status"]


if __name__ == "__main__":
    for name in sys.argv[1:]:
        print(f"{Path(name).name}: {add(Path(name))}")
