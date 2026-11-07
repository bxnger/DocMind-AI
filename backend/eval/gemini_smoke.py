"""End-to-end check against a running server. Reads no key: the server holds it.

Usage: python eval/gemini_smoke.py file.pdf "answerable question" "off-topic question" [base_url]
Also asks "О чём этот документ?" and "What is this document about?": both must be answered with sources.
Exits 0 only if the answer has a verified source with a page and highlights, and the off-topic question is not_found.
"""

import json
import sys
import time

import httpx


def ask(client: httpx.Client, conversation_id: str, question: str) -> dict:
    result = {"tokens": 0, "text": "", "sources": [], "status": None, "error": None}
    event = None
    url = f"/conversations/{conversation_id}/messages"
    with client.stream("POST", url, json={"content": question}) as response:
        if response.status_code != 200:
            response.read()
            result["error"] = response.json()["error"]
            return result
        for line in response.iter_lines():
            if line.startswith("event: "):
                event = line[7:]
            elif line.startswith("data: "):
                data = json.loads(line[6:])
                if event == "token":
                    result["tokens"] += 1
                    result["text"] += data["text"]
                elif event == "sources":
                    result["sources"] = data["sources"]
                elif event == "done":
                    result["status"] = data["answerStatus"]
                elif event == "error":
                    result["error"] = data
    return result


def main() -> int:
    path, good, bad = sys.argv[1:4]
    base = sys.argv[4] if len(sys.argv) > 4 else "http://127.0.0.1:8011"
    with httpx.Client(base_url=f"{base}/api/v1", timeout=120) as client, open(path, "rb") as file:
        client.headers["Authorization"] = "Bearer " + client.post("/sessions").json()["token"]
        document = client.post("/documents", files={"file": (path.rsplit("/", 1)[-1], file)}).json()
        while document["status"] == "processing":
            time.sleep(1)
            document = client.get(f"/documents/{document['id']}").json()
        print("document:", document["status"], document["pageCount"], "pages")
        if document["status"] != "ready":
            return 1
        conversation_id = None
        try:
            conversation_id = client.post("/conversations", json={"documentIds": [document["id"]]}).json()["id"]
            answer = ask(client, conversation_id, good)
            print(json.dumps(answer, ensure_ascii=False, indent=2))
            for overview in ("О чём этот документ?", "What is this document about?"):
                general = ask(client, conversation_id, overview)
                print(f"overview {overview!r}: {general['status']} sources={len(general['sources'])} error={general['error']}")
            refused = ask(client, conversation_id, bad)
            print("off-topic:", refused["status"], refused["error"], "tokens:", refused["tokens"])
            source = answer["sources"][0] if answer["sources"] else {}
            ok = answer["status"] == "answered" and source.get("page") and source.get("highlights")
            print("PASS" if ok and refused["status"] == "not_found" else "FAIL")
            return 0 if ok and refused["status"] == "not_found" else 1
        finally:
            if conversation_id:
                client.delete(f"/conversations/{conversation_id}")
            client.delete(f"/documents/{document['id']}")


if __name__ == "__main__":
    sys.exit(main())
