"""Keeps the store search answers for the demo parts ready, so a search on stage answers at once.

Runs on the server every 20 minutes (systemd timer docmind-warm), against the local API. The shops' pages are cached
for 30 minutes, so the prices shown are never older than that, and each shop still gets one request at a time with its
own pause (app.catalog). No AI is called.
"""

import json
import sys
import time
import urllib.request

API = "http://127.0.0.1:8000/api/v1"
# The parts of the demo documents (TV-320, KN-80) that the shops can have, and the ones from the test kit.
PARTS = ["6203", "6205-2RS", "6205", "6210-2RS", "NU 207 ECP", "6306-2Z", "6204-2Z"]


def call(method: str, path: str, body: dict | None = None, token: str | None = None) -> tuple[int, dict]:
    request = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body else None)
    request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        return error.code, {}


def main() -> int:
    status, session = call("POST", "/sessions")
    if status not in (200, 201):
        print(f"no session: {status}")
        return 1
    failed = 0
    for part in PARTS:
        started = time.monotonic()
        status, body = call("POST", "/procurement/search", {"query": part}, session["token"])
        if status == 429:  # another search is running: try once more a bit later
            time.sleep(12)
            status, body = call("POST", "/procurement/search", {"query": part}, session["token"])
        found = len(body.get("offers", [])) + len(body.get("similar", []))
        shops = [f"{s['store']}={s['status']}" for s in body.get("sources", []) if s["store"] != "price_lists"]
        print(f"{part}: {status}, {found} offers, {time.monotonic() - started:.1f} s, {' '.join(shops)}")
        failed += status != 200
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
