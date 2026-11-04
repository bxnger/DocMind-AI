"""Diagnoses Gemini access with the official SDK. Run it in your own terminal, where the key lives.

    export GEMINI_API_KEY=...
    python eval/gemini_diagnose.py [model ...]

Lists the models this key can call generateContent on, then sends a tiny request to the configured model
(GEMINI_MODEL, default gemini-2.5-flash-lite) and to any models named on the command line. Never prints the key.
"""

import os
import sys

from google import genai
from google.genai import errors, types

from app.config import Settings
from app.llm_gemini import classify_not_found

PREFERRED = ("gemini-2.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-2.5-flash")


def try_model(client: genai.Client, model: str) -> bool:
    try:
        response = client.models.generate_content(
            model=model,
            contents="Reply with the single word: ok",
            config=types.GenerateContentConfig(max_output_tokens=16),
        )
        print(f"  OK   {model}: {(response.text or '').strip()[:40]!r}")
        return True
    except errors.APIError as exc:
        extra = f" ({classify_not_found(exc)} not found)" if exc.code == 404 else ""
        print(f"  FAIL {model}: HTTP {exc.code} {exc.status}{extra}")
        if exc.code == 429:
            print("       The key works but its quota is used up or this model has no free quota.")
        return False


def main() -> int:
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        print("GEMINI_API_KEY is not set in this terminal.")
        return 2
    print(f"SDK google-genai, key present ({len(key)} characters), API version v1beta")
    client = genai.Client(api_key=key)

    print("\nModels available to this key for generateContent:")
    try:
        names = sorted(
            m.name.removeprefix("models/")
            for m in client.models.list()
            if m.name and "generateContent" in (m.supported_actions or [])
        )
    except errors.APIError as exc:
        print(f"  Could not list models: HTTP {exc.code} {exc.status}. 400/403 usually means a bad or restricted key.")
        return 1
    for name in names:
        print(f"  {name}")

    configured = Settings().gemini_model
    print(f"\nConfigured model: {configured} ({'listed' if configured in names else 'NOT in the list above'})")
    print("\nTest requests:")
    results = {model: try_model(client, model) for model in dict.fromkeys([configured, *sys.argv[1:]])}
    if not results[configured]:
        candidates = [m for m in PREFERRED if m in names and m != configured]
        for model in candidates:
            results[model] = try_model(client, model)
        working = [m for m, ok in results.items() if ok and m != configured]
        if working:
            print(f"\nSuggestion: export GEMINI_MODEL={working[0]}   (then restart the backend)")
        else:
            print("\nNo candidate worked. Compare the list above with https://ai.google.dev/gemini-api/docs/models")
    return 0 if results[configured] else 1


if __name__ == "__main__":
    sys.exit(main())
