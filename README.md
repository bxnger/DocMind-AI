# Document Assistant — backend

FastAPI backend for the AI Document Assistant. Contract: `/api/v1`, camelCase JSON, see `docs/api-contract.md` (to be added).

Implemented so far (skeleton):

- `GET /api/v1/health`
- `GET /api/v1/capabilities`, reports only what is actually implemented
- `POST /api/v1/documents` (PDF/DOCX, size and content-type checks, 202 `processing`)
- `GET /api/v1/documents`, `GET /api/v1/documents/{id}`, `DELETE /api/v1/documents/{id}`
- `GET /api/v1/documents/{id}/file` (serves ready PDFs; Range support still to do)

Not implemented yet: text extraction, OCR, chunking, indexing, pages endpoint, conversations, SSE chat, comparisons.

## Run

```bash
python -m venv .venv
source .venv/bin/activate        # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
fastapi dev app/main.py
```

Environment variables:

- `DATA_DIR` — where `app.db` and uploaded files go (default `data/`)
- `CORS_ORIGINS` — comma-separated frontend origins (default `http://localhost:5173`)

## Test

```bash
pytest
```
