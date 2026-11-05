"""Warms the caches of a RUNNING backend before the demo: uploads the demo files and asks the scripted questions once.

    python demo/warmup.py [--url http://127.0.0.1:8011] [--pause 3] [--no-verify]

The backend remembers verified answers and question translations in memory, so on stage the same questions answer in a
fraction of a second and cannot hit the provider's quota. The memory is cleared when the backend restarts: run this AFTER
the last restart and do not restart the backend afterwards.

Needs demo/*.pdf and demo/lease_v1.docx (python demo/make_demo_pdfs.py). Questions are sent without a language, exactly
like the frontend does, each in a fresh conversation. A question that hits the quota is retried after a wait.
"""
import argparse
import json
import sys
import time
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent

# What the demo asks (docs/DEMO.md). Add your own questions here.
SCRIPT: dict[str, list[str]] = {
    "lease_v1.pdf": [
        "Сколько составляет арендная плата?",
        "За сколько дней надо предупредить о расторжении?",
        "Какая площадь помещения?",
        "На какой срок заключён договор?",
        "Есть ли в здании парковка?",
    ],
    "lease_long.pdf": [
        "How much is the monthly rent?",
        "How long is the lease term?",
        "Is parking included in the lease?",
        "Шарт қанша мерзімге жасалған?",
        "Қамтамасыз ету төлемі қашан қайтарылады?",
    ],
    "lease_v1.docx": ["Сколько составляет арендная плата?", "What is the penalty for late payment?"],
    "rules_kk.pdf": ["Когда выплачивается стипендия?", "When does the exam session take place?"],
    "handbook_en.pdf": ["Who approves claims above 500 USD?", "How many days can I work remotely?"],
}
COMPARE = ("lease_v1.pdf", "lease_v2.pdf")
RETRIES = 3
RETRY_WAIT = 20


def ask(client: httpx.Client, base: str, document_id: str, question: str) -> tuple[str, float, str]:
    """(result, seconds, detail): result is answered, not_found or an error code."""
    conversation = client.post(f"{base}/conversations", json={"documentIds": [document_id]}).json()["id"]
    started = time.perf_counter()
    result, detail, event = "no answer", "", None
    with client.stream("POST", f"{base}/conversations/{conversation}/messages", json={"content": question}) as response:
        if response.status_code != 200:
            return f"HTTP {response.status_code}", time.perf_counter() - started, ""
        for line in response.iter_lines():
            if line.startswith("event: "):
                event = line[7:]
            elif line.startswith("data: "):
                data = json.loads(line[6:])
                if event == "done":
                    result, detail = data.get("answerStatus", "?"), data.get("reason", "")
                elif event == "error":
                    result = data.get("code", "ERROR")
    client.delete(f"{base}/conversations/{conversation}")
    return result, time.perf_counter() - started, detail


def ensure_documents(client: httpx.Client, base: str) -> dict[str, str]:
    existing = {item["name"]: item for item in client.get(f"{base}/documents").json()["items"] if item["status"] == "ready"}
    ids: dict[str, str] = {}
    for name in [*SCRIPT, COMPARE[1]]:
        if name in existing:
            ids[name] = existing[name]["id"]
            continue
        path = HERE / name
        if not path.exists():
            print(f"  missing {name}: run python demo/make_demo_pdfs.py")
            continue
        created = client.post(f"{base}/documents", files={"file": (name, path.read_bytes(), "application/octet-stream")}).json()
        for _ in range(60):
            state = client.get(f"{base}/documents/{created['id']}").json()
            if state["status"] != "processing":
                break
            time.sleep(1)
        print(f"  uploaded {name}: {state['status']}")
        if state["status"] == "ready":
            ids[name] = created["id"]
    return ids


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8011")
    parser.add_argument("--pause", type=float, default=3.0, help="seconds between questions, to respect the quota")
    parser.add_argument("--no-verify", action="store_true", help="skip the second pass that checks the answers are cached")
    args = parser.parse_args()
    base = args.url.rstrip("/") + "/api/v1"
    with httpx.Client(timeout=120) as client:
        try:
            client.get(f"{base}/health").raise_for_status()
        except httpx.HTTPError:
            print(f"The backend does not answer at {args.url}. Start it first.")
            return 1
        print("documents:")
        ids = ensure_documents(client, base)
        asked = answered = 0
        problems: list[str] = []
        print("\nwarming (question -> result):")
        for name, questions in SCRIPT.items():
            if name not in ids:
                continue
            for question in questions:
                for attempt in range(1, RETRIES + 1):
                    result, seconds, detail = ask(client, base, ids[name], question)
                    if result in ("answered", "not_found"):
                        break
                    print(f"  {name}: {question!r} -> {result}, waiting {RETRY_WAIT}s (attempt {attempt})")
                    time.sleep(RETRY_WAIT)
                asked += 1
                answered += result in ("answered", "not_found")
                if result not in ("answered", "not_found"):
                    problems.append(f"{name}: {question!r} -> {result}")
                print(f"  {name:<16} {result:<10} {seconds:5.1f}s  {question}{f'  [{detail}]' if detail else ''}")
                time.sleep(args.pause)
        if COMPARE[0] in ids and COMPARE[1] in ids:
            created = client.post(f"{base}/comparisons", json={"documentAId": ids[COMPARE[0]], "documentBId": ids[COMPARE[1]]}).json()
            for _ in range(60):
                state = client.get(f"{base}/comparisons/{created['id']}").json()
                if state["status"] != "processing":
                    break
                time.sleep(1)
            print(f"\ncomparison {COMPARE[0]} vs {COMPARE[1]}: {state['status']} {state.get('summary', '')}")
        if not args.no_verify:
            print("\nverifying (the same questions should now take well under a second):")
            slow = 0
            for name, questions in SCRIPT.items():
                for question in questions if name in ids else []:
                    result, seconds, _ = ask(client, base, ids[name], question)
                    cached = seconds < 1.0
                    slow += not cached
                    print(f"  {name:<16} {'cached' if cached else 'NOT CACHED':<11} {seconds:5.2f}s  {question}")
            print(f"\n{asked - len(problems)}/{asked} questions warmed; {slow} not served from the cache.")
        if problems:
            print("\nNOT WARMED (provider errors; run again in a minute):")
            print("\n".join(f"  {line}" for line in problems))
            return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
