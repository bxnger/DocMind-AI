"""Checks Groq access: lists the models the key can use and sends one tiny request. Never prints the key.

    python eval/groq_diagnose.py [model ...]

Put GROQ_API_KEY in backend/.env first. Tries GROQ_MODEL (default qwen/qwen3.8-27b) and any model named on the
command line, then suggests one that worked. Model names change: copy a working one into GROQ_MODEL.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import os  # noqa: E402

import httpx  # noqa: E402

from app.config import Settings  # noqa: E402  (loads backend/.env)

BASE = "https://api.groq.com/openai/v1"


def main() -> int:
    key = os.environ.get("GROQ_API_KEY")
    if not key:
        print("GROQ_API_KEY is not set. Put it in backend/.env (never in code or chat).")
        return 1
    headers = {"Authorization": f"Bearer {key}"}
    print(f"key present ({len(key)} characters)")
    models: list[str] = []
    with httpx.Client(timeout=20) as client:
        response = client.get(f"{BASE}/models", headers=headers)
        if response.status_code == 200:
            models = sorted(item["id"] for item in response.json().get("data", []))
            print("\nModels available to this key:")
            for name in models:
                print(f"  {name}")
        else:
            print(f"\nCould not list models: HTTP {response.status_code}")
        wanted = [Settings().groq_model, *sys.argv[1:]]
        print("\nTest requests:")
        worked = []
        for model in dict.fromkeys(wanted):
            reply = client.post(
                f"{BASE}/chat/completions",
                headers=headers,
                json={"model": model, "messages": [{"role": "user", "content": "Reply with the single word: ok"}], "max_tokens": 16},
            )
            if reply.status_code == 200:
                text = (reply.json()["choices"][0]["message"]["content"] or "").strip()[:40]
                print(f"  OK   {model}: {text!r}")
                worked.append(model)
            else:
                print(f"  FAIL {model}: HTTP {reply.status_code}")
        if worked:
            print(f"\nSuggestion: GROQ_MODEL={worked[0]} in backend/.env")
            return 0
        print("\nNo model worked. Pick a name from the list above and pass it as an argument.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
