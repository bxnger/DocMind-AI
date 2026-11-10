# Deploying the backend for the public demo (Vercel frontend + one small server)

## Live server (done 08.11.2026)

`https://api.docmind.kz` — Hoster.kz Cloud 4-4-100 (4 vCPU, 4 GB, 100 GB NVMe, Astana), IP `89.126.199.206`, Ubuntu 24.04.
DNS: A record `api.docmind.kz` → that IP (Hoster.kz DNS hosting). Checked live after the setup: health, capabilities
(`ocr: true`), `/docs` 404, CORS (both Vercel previews, the Vercel production domain, `https://localhost`,
`capacitor://localhost` allowed; `http://localhost:5173` and foreign origins refused), http → https 308,
`run_demo.py ... tv320` and `kn80` without failures, isolation between two sessions, the real client IP behind Caddy.

- **Python 3.14 is required.** Ubuntu's 3.12 fails at start (`TypeError: 'function' object is not subscriptable` in
  `app/store.py`: the class has a method `list`, and 3.12 evaluates the annotation `list[dict]` eagerly). Python 3.14
  (lazy annotations, the version the tests run on) is installed by `uv` into `/opt/docmind/python`; the venv is
  `/opt/docmind/venv` (`/opt/docmind/venv-py312` is the failed first try, safe to delete).
- Code: `/opt/docmind/releases/<commit>` from `git archive HEAD backend`, `/opt/docmind/app` is a symlink to the current
  release. Settings and keys: `/etc/docmind/backend.env` (root:docmind 640). Data: `/var/lib/docmind`.
- Units: `docmind-api` (uvicorn on 127.0.0.1:8000, one process) and `caddy` (Let's Encrypt certificate, auto renewal).
  Firewall `ufw`: 22, 80, 443 only; `fail2ban` for SSH. Access: SSH key `~/.ssh/docmind_vps` on Erasyl's laptop.
- Since 10.11.2026 the Telegram bot (@DOCMIND67_bot) runs here too: unit `docmind-bot`, settings `/etc/docmind/bot.env`
  (token, allowed chats, `BACKEND_URL=http://127.0.0.1:8000`, `BOT_STATE_FILE=/var/lib/docmind/bot_state.json`). Only one
  poller per token: do not start the laptop bot while this one runs.
- Since 09.11.2026: release `401d450` (store search and barcodes, `STORE_SEARCH=all`), domain `docmind.kz` / `www.docmind.kz`
  on Vercel (DNS A 76.76.21.21 at Hoster.kz; the old parking address was 89.35.125.9) and in `CORS_ORIGINS`.
- Timers (scripts in `backend/deploy/`, installed to `/opt/docmind/bin/`):
  - `docmind-warm.timer`, every 20 min: `warm_cache.py` searches the demo parts, so the store search answers at once
    on stage (pages are cached 30 min; the shops' own pauses still apply). `journalctl -u docmind-warm`.
  - `docmind-monitor.timer`, every minute: `monitor.py` checks the API, the site and the bot and writes to the team's
    Telegram chats only when one goes down or comes back. `journalctl -u docmind-monitor`.
  - Stop either: `systemctl disable --now docmind-warm.timer` (or `docmind-monitor.timer`).

Update to a new commit (from the worktree, `C=$(git rev-parse --short HEAD)`):

```
git archive --format=tar.gz -o docmind-$C.tar.gz HEAD backend
scp -i ~/.ssh/docmind_vps docmind-$C.tar.gz root@89.126.199.206:/root/
ssh -i ~/.ssh/docmind_vps root@89.126.199.206 "mkdir -p /opt/docmind/releases/$C && tar -xzf /root/docmind-$C.tar.gz -C /opt/docmind/releases/$C \
  && /opt/docmind/venv/bin/pip install -q -r /opt/docmind/releases/$C/backend/requirements.txt \
  && ln -sfn /opt/docmind/releases/$C /opt/docmind/app && systemctl restart docmind-api"
```

Rollback: point the symlink back at the previous release and `systemctl restart docmind-api`. Logs:
`journalctl -u docmind-api -f`. Switch AI off: add `AI_EMERGENCY_STOP=1` to `backend.env`, restart.

The plan below was written before the server existed; the steps above are what was actually done.
Prices and free tiers change: check them before paying.

## Why a server and not a serverless platform

- Documents and the SQLite database must survive restarts and be shared by the API and the reading worker, so the API needs a disk.
- The in-memory rate limits and the AI budget live in one process: run **one** API process (no `--workers`, one replica).
- Reading a document starts a child process (`app/worker.py`, 180 s, 768 MB limit) and OCR needs Tesseract installed: that
  rules out Vercel functions and similar short-lived runtimes.

## Recommended architecture

```
browser (Vercel, https://docmind.example)  --https-->  Caddy (443, auto TLS, 22 MB body limit)
                                                          |  127.0.0.1:8000
                                                       uvicorn app.main:app   (ONE process, systemd)
                                                          |-- worker child processes (documents)
                                                          `-- /var/lib/docmind  (app.db + files/, a persistent disk)
Telegram bot (systemd, outbound only) ---- http://127.0.0.1:8000
```

Options, cheapest first (approximate, verify):

| Option | Cost | Notes |
|---|---|---|
| Small VPS (Hetzner CX22 / similar, 2 vCPU, 4 GB) + Caddy | about 4-6 EUR/month | Best fit: full control, a real disk, OCR works. Needs a domain or a free subdomain for HTTPS. |
| Fly.io machine + volume | a few USD/month | Single machine and one volume; HTTPS included; Tesseract goes in the Dockerfile. |
| Railway / Render with a persistent disk | about 5-10 USD/month | Works if the plan has a disk; the free tiers sleep and have no disk, so they do not fit. |
| The team laptop + Cloudflare Tunnel | free | Fallback for the final only: no inbound ports, HTTPS from Cloudflare. Dies with the laptop, Wi-Fi and sleep mode. |

Memory: 2 GB is the minimum (API, a worker at up to 768 MB, OCR). Use 4 GB if two documents may be read at once (`WORKER_CONCURRENCY=2`).

## Step by step (VPS with Ubuntu 24.04)

1. Create the server, add an SSH key, enable the firewall: allow 22, 80, 443 only (`ufw`).
2. DNS: point `api.<your domain>` (an A record) at the server.
3. Install packages: `apt install python3-venv python3-pip git caddy tesseract-ocr tesseract-ocr-kaz tesseract-ocr-rus tesseract-ocr-eng`.
   Check OCR: `tesseract --list-langs` shows `kaz`, `rus`, `eng`. If PyMuPDF does not find the data, set `TESSDATA_PREFIX`
   to the folder that holds the `*.traineddata` files (`/usr/share/tesseract-ocr/5/tessdata`).
4. Code: `git clone` the repository into `/opt/docmind/app`, check out the release **tag** (not a moving branch), then
   `python3 -m venv /opt/docmind/venv && /opt/docmind/venv/bin/pip install -r backend/requirements.txt`.
5. A system user `docmind` that owns `/var/lib/docmind` (mode 700) and `/etc/docmind/backend.env` (mode 600, see below).
6. `/etc/systemd/system/docmind-api.service`:

   ```ini
   [Unit]
   Description=DOCMIND API
   After=network.target

   [Service]
   User=docmind
   WorkingDirectory=/opt/docmind/app/backend
   EnvironmentFile=/etc/docmind/backend.env
   ExecStart=/opt/docmind/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --proxy-headers --forwarded-allow-ips=127.0.0.1
   Restart=always
   RestartSec=3
   MemoryMax=3G

   [Install]
   WantedBy=multi-user.target
   ```

   Do **not** add `--workers`: the limits and the daily AI budget are counted in memory.
7. `/etc/caddy/Caddyfile` (Caddy gets and renews the certificate by itself):

   ```
   api.example.com {
       request_body {
           max_size 22MB
       }
       reverse_proxy 127.0.0.1:8000 {
           flush_interval -1      # server-sent events: do not buffer the answer stream
       }
   }
   ```

   `max_size` is a little above the 20 MB file limit plus the multipart envelope; the API refuses larger bodies too.
8. `systemctl enable --now docmind-api caddy`, then check `curl https://api.example.com/api/v1/health` and `/capabilities`
   (`ocr` must be `true`).
9. Frontend on Vercel: set `VITE_API_BASE_URL=https://api.example.com` (https only, no `/api/v1`), optionally
   `VITE_TELEGRAM_BOT_URL=https://t.me/DOCMIND67_bot`, redeploy. See `frontend/DEPLOYMENT.md`.
10. Demo documents for every visitor (optional): `sudo -u docmind env $(cat /etc/docmind/backend.env | xargs) /opt/docmind/venv/bin/python -m app.demo_docs file.pdf`.

## Environment variables (names only; values go into `/etc/docmind/backend.env`, never into Git or chat)

| Variable | Purpose |
|---|---|
| `APP_ENV=production` | refuses non-https CORS origins, turns on HSTS, hides `/docs` and `/openapi.json` |
| `CORS_ORIGINS` | exact https origins of the frontend, comma separated, no `*` (the app stops at start otherwise) |
| `TRUSTED_PROXY_IPS=127.0.0.1` | the reverse proxy: `X-Forwarded-For` is believed only from these addresses |
| `DATA_DIR=/var/lib/docmind` | database and files; this is the only state to back up |
| `LLM_PROVIDER=gemini`, `GEMINI_API_KEY` | main model; `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL` optional |
| `GROQ_API_KEY` | independent backup when Gemini is limited or down; `GROQ_MODEL` optional |
| `AI_SESSION_DAILY_LIMIT`, `AI_CLIENT_DAILY_LIMIT`, `AI_GLOBAL_DAILY_LIMIT` | AI allowance per guest, per address, for the whole server (40 / 300 / 1000 by default) |
| `AI_EMERGENCY_STOP=1` | switches the AI off at once; reading, search and the sample keep working |
| `SESSION_TTL_HOURS`, `SESSION_MAX_*`, `GLOBAL_MAX_*`, `*_LIMIT_PER_MINUTE` | quotas, see `app/config.py` |
| `TESSDATA_PREFIX` | only when OCR data is not found automatically |
| `WORKER_TIMEOUT_SECONDS`, `WORKER_MEMORY_MB`, `WORKER_CONCURRENCY`, `MAX_OCR_PAGES` | document reading limits |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_CHATS`, `BACKEND_URL`, `BOT_MESSAGES_PER_MINUTE` | the bot, see below |

Estimate the AI cost before the final: `AI_GLOBAL_DAILY_LIMIT` is the ceiling of model calls per day (cached answers are free).

## HTTPS and CORS

- The browser calls the API from the Vercel origin, so `CORS_ORIGINS` must be exactly `https://<the Vercel domain>`
  (also the custom domain, if one is added). A wrong origin shows up in the browser as "server unreachable" while
  `curl` works: first thing to check when "uploads do not work".
- Every Vercel preview deployment has its own origin: either add it on purpose or test only on the production domain.
- The token travels in the `Authorization` header, never in a URL; cookies are not used.

## Telegram bot

A second unit, same machine, outbound connections only:

```ini
[Service]
User=docmind
WorkingDirectory=/opt/docmind/app/backend
EnvironmentFile=/etc/docmind/bot.env
ExecStart=/opt/docmind/venv/bin/python -m bot.main
Restart=always
RestartSec=5
```

`bot.env` holds `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_CHATS` (the bot refuses to start with an empty list),
`BACKEND_URL=http://127.0.0.1:8000`. Only one process may poll a token: stop the laptop bot before starting this one,
or Telegram answers `Conflict: terminated by other getUpdates request` and updates are lost.
Each chat gets its own guest session; its state file survives a restart.

## Health checks and minimal monitoring

- `GET /api/v1/health` every minute from an external monitor (UptimeRobot / Better Stack free plans), alert by e-mail or Telegram.
- `GET /api/v1/capabilities` must show `ocr: true` after every deploy.
- `journalctl -u docmind-api -f` for errors; disk: `df -h /var/lib/docmind`; the API answers 503 `STORAGE_FULL` when the
  configured storage ceiling (`GLOBAL_MAX_STORAGE_MB`, 5 GB) is reached: keep it below the real free space.
- Before the final: one full pass of the QA set (`DOCMIND_QA`) against the public URL.

## Backups and recovery

- State is `DATA_DIR` only. Nightly: `sqlite3 /var/lib/docmind/app.db ".backup '/var/backups/docmind/app-$(date +%F).db'"`
  and `rsync -a /var/lib/docmind/files/ /var/backups/docmind/files/`; copy off the server (provider snapshot or `rclone`).
  Uploaded documents are guest data that expires in 72 h, so a lost disk costs little: the demo documents and the keys matter more.
- Server lost: new VPS, repeat the step list (about 20 minutes), restore `backend.env` from the team password manager,
  point DNS, optionally restore `app.db` and `files/`. Guests then get 401 `SESSION_EXPIRED`; the frontend creates a new session.
- Provider (Gemini) down: the backup provider (Groq) answers by itself. Both down: `AI_EMERGENCY_STOP=1` keeps the
  rest of the product alive, the frontend shows its demo search.

## Release and rollback

- Release = a Git tag (`release-2026-11-12`). Deploy: `git fetch --tags && git checkout <tag>`, `pip install -r requirements.txt`,
  `systemctl restart docmind-api`, check `/health` and `/capabilities`.
- Rollback = check out the previous tag, restart. The database changes only by additive migrations, so the previous
  tag opens it. Take a database copy before every deploy.
- Never change `backend.env` and the code at once: one change, one check.

## Before the first public request

- [ ] `APP_ENV=production`, `CORS_ORIGINS` exact, `TRUSTED_PROXY_IPS` set, one API process.
- [ ] Keys rotated: those pasted into chats earlier are treated as exposed. New keys only in `/etc/docmind/*.env` (mode 600).
- [ ] `/docs` and `/openapi.json` answer 404 on the public URL.
- [ ] A 21 MB file gets 413 from Caddy; a DOCX bomb gets 413 `DOCX_TOO_LARGE`; a second guest cannot read the first one's file.
- [ ] `ocr: true`; the QA scan reads `QA-2027-041`.
- [ ] Backup ran once and a restore was tried.
