import io
import zipfile

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.deps import get_store
from app.main import create_app
from app.store import Store


@pytest.fixture
def store(tmp_path) -> Store:
    return Store(tmp_path)


@pytest.fixture
def client(store) -> TestClient:
    app = create_app(Settings(data_dir=store.files_dir.parent, cors_origins=("http://localhost:5173",)))
    app.dependency_overrides[get_store] = lambda: store
    return TestClient(app)


def pdf_bytes() -> bytes:
    return b"%PDF-1.4\n% minimal test file\n%%EOF\n"


def docx_bytes() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("word/document.xml", "<w:document/>")
    return buf.getvalue()
