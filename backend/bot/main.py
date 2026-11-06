"""Runs the Telegram bot.

    python -m bot.main            # long polling: works from any computer with internet, no public address needed
    python -m bot.main --check    # only checks the token and the backend, then exits

Settings (backend/.env or environment variables):
    TELEGRAM_BOT_TOKEN       from @BotFather. Never put it in code, chat or Git.
    BACKEND_URL              default http://127.0.0.1:8011
    TELEGRAM_ALLOWED_CHATS   optional, comma separated chat ids; empty means everybody may use the bot
    BOT_MESSAGES_PER_MINUTE  optional, default 10 per chat
    BOT_STATE_FILE           optional, default data/bot_state.json (which document each chat has open)
"""

import argparse
import logging
import os
import signal
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx

from app.envfile import load_env_file
from bot.backend_client import BackendClient
from bot.handlers import Bot
from bot.telegram_api import TelegramAPI, TelegramError

logger = logging.getLogger("bot")
WORKERS = 6
COMMANDS = {
    "ru": [("docs", "Мои документы"), ("facts", "Даты, сроки и суммы"), ("export", "Выгрузить вопросы и ответы"), ("compare", "Сравнить два документа"), ("help", "Помощь")],
    "en": [("docs", "My documents"), ("facts", "Dates, deadlines, amounts"), ("export", "Export questions and answers"), ("compare", "Compare two documents"), ("help", "Help")],
    "kk": [("docs", "Құжаттарым"), ("facts", "Күндер, мерзімдер, сомалар"), ("export", "Сұрақ-жауаптарды шығару"), ("compare", "Екі құжатты салыстыру"), ("help", "Көмек")],
}


def build_bot(token: str, backend_url: str) -> tuple[Bot, TelegramAPI]:
    telegram = TelegramAPI(token)
    backend = BackendClient(httpx.Client(base_url=backend_url, timeout=60))
    allowed = {int(item) for item in os.environ.get("TELEGRAM_ALLOWED_CHATS", "").replace(" ", "").split(",") if item.lstrip("-").isdigit()}
    bot = Bot(
        telegram,
        backend,
        state_path=Path(os.environ.get("BOT_STATE_FILE", "data/bot_state.json")),
        allowed_chats=allowed or None,
        per_minute=int(os.environ.get("BOT_MESSAGES_PER_MINUTE", "10")),
    )
    return bot, telegram


def check(telegram: TelegramAPI, backend_url: str) -> int:
    try:
        me = telegram.get_me()
        print(f"Telegram: OK, bot @{me['username']}")
    except TelegramError as exc:
        print(f"Telegram: FAILED ({exc})")
        return 1
    try:
        response = httpx.get(f"{backend_url}/api/v1/health", timeout=10)
        print(f"Backend:  {'OK' if response.status_code == 200 else 'HTTP ' + str(response.status_code)} at {backend_url}")
        return 0 if response.status_code == 200 else 1
    except httpx.HTTPError as exc:
        print(f"Backend:  FAILED ({type(exc).__name__}) at {backend_url}. Start it first.")
        return 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    load_env_file()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)  # its request lines contain the token
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    if not token:
        print("TELEGRAM_BOT_TOKEN is not set. Get it from @BotFather and put it in backend/.env.")
        return 1
    backend_url = os.environ.get("BACKEND_URL", "http://127.0.0.1:8011").rstrip("/")
    bot, telegram = build_bot(token, backend_url)
    if args.check:
        return check(telegram, backend_url)

    try:
        me = telegram.get_me()
        for language, commands in COMMANDS.items():
            telegram.set_my_commands(commands, None if language == "ru" else language)
    except TelegramError as exc:
        print(f"Telegram refused the token or is unreachable ({exc}).")
        return 1
    print(f"Bot @{me['username']} is running. Backend: {backend_url}. Press Ctrl+C to stop.")

    stop = threading.Event()
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    locks: dict[int, threading.Lock] = {}
    offset: int | None = None
    delay = 1.0
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:

        def run(update: dict) -> None:
            chat_id = (update.get("message") or update.get("callback_query", {}).get("message") or {}).get("chat", {}).get("id", 0)
            with locks.setdefault(chat_id, threading.Lock()):  # one chat at a time keeps its messages in order
                bot.handle_update(update)

        while not stop.is_set():
            try:
                updates = telegram.get_updates(offset)
                delay = 1.0
            except TelegramError as exc:
                logger.warning("getUpdates failed: %s (retry in %.0fs)", exc, delay)
                stop.wait(exc.retry_after or delay)
                delay = min(delay * 2, 30)
                continue
            for update in updates:
                offset = update["update_id"] + 1
                pool.submit(run, update)
    print("Stopped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
