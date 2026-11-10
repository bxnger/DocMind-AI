"""Says in Telegram when the public site, the API or the bot stops (and when it is back). Runs every minute (systemd
timer docmind-monitor). Only a change of state is sent, so a long outage is one message, not one a minute.

Settings come from /etc/docmind/bot.env: TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_CHATS (the team's chats).
"""

import json
import os
import subprocess
import urllib.parse
import urllib.request
from pathlib import Path

STATE = Path("/var/lib/docmind/monitor_state.json")
CHECKS = {
    "API api.docmind.kz": "https://api.docmind.kz/api/v1/health",
    "Сайт docmind.kz": "https://www.docmind.kz/",
}


def url_ok(url: str) -> bool:
    for _attempt in range(2):  # one retry: a single slow answer is not an outage
        try:
            with urllib.request.urlopen(url, timeout=15) as response:
                if response.status == 200:
                    return True
        except Exception:
            pass
    return False


def unit_ok(name: str) -> bool:
    return subprocess.run(["systemctl", "is-active", "--quiet", name]).returncode == 0


def send(text: str) -> None:
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    for chat in filter(None, os.environ.get("TELEGRAM_ALLOWED_CHATS", "").replace(" ", "").split(",")):
        data = urllib.parse.urlencode({"chat_id": chat, "text": text}).encode()
        try:
            urllib.request.urlopen(f"https://api.telegram.org/bot{token}/sendMessage", data=data, timeout=15)
        except Exception as error:  # the token never reaches the log
            print(f"send to {chat} failed: {type(error).__name__}")


def main() -> None:
    now = {name: url_ok(url) for name, url in CHECKS.items()}
    now["Telegram-бот"] = unit_ok("docmind-bot")
    before = json.loads(STATE.read_text()) if STATE.exists() else {name: True for name in now}
    changes = [(name, ok) for name, ok in now.items() if before.get(name, True) != ok]
    if changes:
        lines = [("✅ снова работает: " if ok else "🔴 не отвечает: ") + name for name, ok in changes]
        send("DOCMIND мониторинг\n" + "\n".join(lines))
    STATE.write_text(json.dumps(now))
    print(" ".join(f"{name}={'ok' if ok else 'DOWN'}" for name, ok in now.items()))


if __name__ == "__main__":
    main()
