# Deploying DOCMIND AI

**Status: the backend is not safe to expose publicly yet.** The API has no authentication or ownership checks. Do not give it a public address until the "Before release" list below is done.

## Architecture

| Part | Host | Notes |
|---|---|---|
| Frontend | Vercel, project root `frontend/` | Static files. No secrets. |
| Backend | One always-on Python service with a persistent disk (a VM, or a container host with a volume) | Not serverless: SQLite, uploads and background processing need one long-running process and a durable disk. |
| Telegram bot | A second process beside the backend | Long polling. Needs no public address. |

Run exactly one backend process and one instance: the rate limiter, answer cache and background processing live in memory, and SQLite is on local disk.

## Frontend on Vercel

`vercel.json` sets the build, the SPA fallback and the security headers.

1. Create a project from the repository, with **Root Directory** `frontend`.
2. Set the variables in the Vercel dashboard, for Production and Preview:
   - `VITE_API_BASE_URL`: backend origin, `https://` only, without `/api/v1`
   - `VITE_TELEGRAM_BOT_URL`: optional. Empty hides the link.
3. Deploy. Node 22 or newer. The build runs `npm run build`.

Every `VITE_*` value is public, because it ends up in the JavaScript. Never put a key or token there. The production build stops if `VITE_API_BASE_URL` is missing, not https, or local, or if a `VITE_*` name looks like a secret.

To try a production bundle on your own computer:

```
DOCMIND_ALLOW_LOCAL_API=1 VITE_API_BASE_URL=http://127.0.0.1:8000 npm run build
```

The Content-Security-Policy in `vercel.json` allows `connect-src https:`, so a local http API works only without those headers. If the inline theme script in `index.html` changes, update its hash in `vercel.json`: a unit test fails until you do.

## Backend

Build:

```
cd backend
python -m venv .venv && .venv/bin/pip install -r requirements.txt
```

Start, behind an HTTPS reverse proxy that also limits request body size:

```
DATA_DIR=/persistent/docmind .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

For OCR, install Tesseract with the `kaz`, `rus` and `eng` data on the host. Check it through `ocr` in `GET /api/v1/capabilities`.

Set these in the host's secret store, never in Git or in Vercel:

| Name | Purpose |
|---|---|
| `LLM_PROVIDER` | `groq` |
| `GROQ_API_KEY` | Secret |
| `GROQ_MODEL` | Optional |
| `DATA_DIR` | Path on the persistent disk |
| `CORS_ORIGINS` | Exact frontend origin, comma separated. No wildcard. |
| `TELEGRAM_BOT_TOKEN` | Secret, bot process only |
| `BACKEND_URL` | Backend address, bot process only |
| `TELEGRAM_ALLOWED_CHATS` | Set for the demo. Empty lets everybody use the bot. |

Set a spending or usage limit in the Groq console too: the backend has no daily budget.

## Before release

- [ ] Authentication and per-owner checks on every document, conversation and comparison route
- [ ] Guests cannot delete shared demo data
- [ ] Per-client rate limits on chat, upload, comparison and facts, plus a daily AI budget
- [ ] Processing limits: time, memory, decompressed DOCX size, disk quota
- [ ] `/docs` and `/openapi.json` off in production
- [ ] Telegram bot isolated per chat, or closed with `TELEGRAM_ALLOWED_CHATS`

## Checks after deploying

1. `GET /api/v1/health` returns `{"status":"ok"}`.
2. `GET /api/v1/capabilities` shows the expected version and OCR state.
3. A request with an `Origin` that is not allowed gets no `access-control-allow-origin` header.
4. A request without credentials to `/api/v1/documents` is refused. **This fails today.**
5. In the browser: refresh a `/documents/<id>` link, upload, ask, open a citation, and check the console for CSP errors.

## Rollback

- Frontend: promote the previous deployment in Vercel. It takes effect at once.
- Backend: stop the service, snapshot `DATA_DIR`, start the previous commit. Back up `DATA_DIR` before every backend deploy.
- Key leak or abuse: rotate the key at the provider, then remove the backend's public route. The frontend then shows its offline message.

## Backup demo

Keep a local run ready on the presenting laptop, with demo documents already uploaded and answers warmed by `backend/demo/warmup.py`. Keep a screen recording of the main flow in case the network fails. The sample document and demo search work in the browser without AI, as long as the frontend itself loads.

## Access is not authorization

Vercel, host and GitHub logins decide who can change the deployment. They do nothing for visitors. Only checks inside the API decide who can read or delete data, and hiding a button in the frontend is not such a check.
