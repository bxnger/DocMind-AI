# DOCMIND AI

Document assistant: upload a PDF or DOCX, ask questions, and check every answer against the original page.
Built for the Innovation AI Hackathon 2026 (AIChatBots track).

| Folder | What it is |
|---|---|
| [`backend/`](backend/README.md) | FastAPI service: extraction, search, Claude or Gemini answers over SSE, citations, comparisons |
| [`frontend/`](frontend/README.md) | React + Vite + TypeScript app |
| [`docs/`](docs/) | Project material, for example the hackathon rules |

The HTTP contract between the two is [`backend/docs/api-contract.md`](backend/docs/api-contract.md).
Change it in its own commit and agree on it before either side depends on the change.

## Run locally

Needs Python 3.12+ (developed on 3.14) and Node 22+. The app runs on **http://localhost:5173** and the API on
**http://127.0.0.1:8011**. Open the app as `localhost`, not `127.0.0.1`: the backend's CORS default allows only that.

### 1. Backend (port 8011)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env              # then edit .env: set LLM_PROVIDER and the matching API key
set -a; source .env; set +a       # load it into this terminal
fastapi dev app/main.py --port 8011
```

Check it: `curl http://127.0.0.1:8011/api/v1/health` returns `{"status":"ok"}`. The first log lines say which provider and
model are in use and whether a key is set (`key=set` or `key=MISSING`, never the key itself).
Without a key everything but chat works, and the frontend offers a clearly labelled demo search that is not AI.

### 2. Frontend (port 5173)

```bash
cd frontend
cp .env.example .env              # VITE_API_BASE_URL=http://127.0.0.1:8011
npm install
npm run dev
```

## Checks

```bash
cd backend && source .venv/bin/activate && pytest
cd frontend && npm run typecheck && npm run lint && npm test && npm run build
```

## Secrets

API keys live only in `backend/.env`, which Git ignores. Never paste a key into code, an issue, a PR or a chat.
`frontend/.env` holds only the API address. If a key is ever committed, revoke it at the provider first, then clean up.
Local databases and uploaded documents (`backend/data/`) are ignored too.

Working together: see [CONTRIBUTING.md](CONTRIBUTING.md).
