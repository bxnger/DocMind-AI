"""The bot's view of the DOCMIND backend (docs/api-contract.md): upload, ask, facts, compare, page file."""

import json
import time
from dataclasses import dataclass, field

import httpx


class BackendUnavailable(Exception):
    """The backend cannot be reached, or answered something that is not the contract."""


@dataclass
class Answer:
    text: str = ""
    sources: list[dict] = field(default_factory=list)
    status: str | None = None  # "answered", "not_found", or None when an error event came instead
    reason: str | None = None  # why a not_found happened (done.reason)
    error_code: str | None = None  # LLM_UNAVAILABLE, LLM_TIMEOUT, RATE_LIMITED


class SessionExpired(Exception):
    """The chat's guest session is gone, and with it the documents it owned."""


class BackendClient:
    def __init__(self, client: httpx.Client, prefix: str = "/api/v1", token: str | None = None) -> None:
        self.client = client
        self.prefix = prefix
        self.token = token

    def for_session(self, token: str) -> "BackendClient":
        """The same connection acting as one guest. Every chat has its own."""
        return BackendClient(self.client, self.prefix, token)

    def create_session(self) -> str:
        response = self._request("POST", "/sessions")
        if response.status_code != 201:
            raise BackendUnavailable(f"session refused, HTTP {response.status_code}")
        return response.json()["token"]

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.token}"} if self.token else {}

    def _url(self, path: str) -> str:
        return f"{self.prefix}{path}"

    def _request(self, method: str, path: str, **kwargs):
        try:
            response = self.client.request(method, self._url(path), headers=self._headers(), **kwargs)
        except httpx.HTTPError as exc:
            raise BackendUnavailable(type(exc).__name__) from None
        if response.status_code == 401:
            raise SessionExpired
        return response

    def upload(self, name: str, data: bytes) -> dict:
        response = self._request("POST", "/documents", files={"file": (name, data, "application/octet-stream")}, timeout=120)
        if response.status_code not in (200, 202):
            return {"status": "failed", "error": _error(response), "id": None}
        return response.json()

    def wait_ready(self, document_id: str, timeout: float = 90.0) -> dict:
        """Polls until the document leaves `processing`. Returns the last state, which may still be `processing`."""
        deadline = time.monotonic() + timeout
        while True:
            response = self._request("GET", f"/documents/{document_id}")
            if response.status_code != 200:
                return {"status": "failed", "error": _error(response), "id": document_id}
            state = response.json()
            if state["status"] != "processing" or time.monotonic() >= deadline:
                return state
            time.sleep(1.0)

    def document(self, document_id: str) -> dict | None:
        response = self._request("GET", f"/documents/{document_id}")
        return response.json() if response.status_code == 200 else None

    def delete_document(self, document_id: str) -> None:
        self._request("DELETE", f"/documents/{document_id}")

    def create_conversation(self, document_ids: list[str]) -> str | None:
        response = self._request("POST", "/conversations", json={"documentIds": document_ids})
        return response.json()["id"] if response.status_code == 201 else None

    def ask(self, conversation_id: str, question: str) -> Answer:
        """Sends the question without a language: the backend answers in the language of the question."""
        answer = Answer()
        event = None
        try:
            with self.client.stream(
                "POST", self._url(f"/conversations/{conversation_id}/messages"), json={"content": question}, headers=self._headers(), timeout=150
            ) as response:
                if response.status_code == 401:
                    raise SessionExpired
                if response.status_code != 200:
                    response.read()
                    code = _error(response).get("code", "")
                    answer.error_code = code or "LLM_UNAVAILABLE"
                    return answer
                for line in response.iter_lines():
                    if line.startswith("event: "):
                        event = line[7:]
                    elif line.startswith("data: "):
                        _apply(answer, event, json.loads(line[6:]))
        except httpx.HTTPError as exc:
            raise BackendUnavailable(type(exc).__name__) from None
        return answer

    def messages(self, conversation_id: str) -> list[dict]:
        response = self._request("GET", f"/conversations/{conversation_id}/messages")
        return response.json().get("items", []) if response.status_code == 200 else []

    def facts(self, document_id: str) -> dict | None:
        response = self._request("GET", f"/documents/{document_id}/facts")
        return response.json() if response.status_code == 200 else None

    def file(self, document_id: str) -> bytes | None:
        response = self._request("GET", f"/documents/{document_id}/file", timeout=60)
        return response.content if response.status_code == 200 else None

    def compare(self, first_id: str, second_id: str, timeout: float = 120.0) -> dict | None:
        response = self._request("POST", "/comparisons", json={"documentAId": first_id, "documentBId": second_id})
        if response.status_code not in (200, 201, 202):
            return None
        comparison_id = response.json()["id"]
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            state = self._request("GET", f"/comparisons/{comparison_id}").json()
            if state["status"] != "processing":
                return state
            time.sleep(1.0)
        return None


def _apply(answer: Answer, event: str | None, data: dict) -> None:
    if event == "token":
        answer.text += data.get("text", "")
    elif event == "sources":
        answer.sources = data.get("sources", [])
    elif event == "done":
        answer.status = data.get("answerStatus")
        answer.reason = data.get("reason")
    elif event == "error":
        answer.error_code = data.get("code", "LLM_UNAVAILABLE")


def _error(response: httpx.Response) -> dict:
    try:
        return response.json().get("error", {})
    except ValueError:
        return {}
