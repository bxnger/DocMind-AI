"""What the bot does with a Telegram update. No network code of its own: it uses TelegramAPI and BackendClient."""

import html
import json
import logging
import os
import threading
import time
from collections import deque
from pathlib import Path

from bot.backend_client import Answer, BackendClient, BackendUnavailable
from bot.render import render_page
from bot.telegram_api import TelegramAPI, TelegramError
from bot.texts import TEXTS, language_of, t

logger = logging.getLogger("bot")

MAX_FILE_BYTES = 20 * 1024 * 1024  # the Bot API cannot send bots larger files, and the backend limit is the same
MAX_DOCS_PER_CHAT = 10
MESSAGE_LIMIT = 4000  # Telegram allows 4096 characters
QUOTE_LIMIT = 220
CAPTION_LIMIT = 900
FACTS_SHOWN = 15
DIFFS_SHOWN = 8
SUGGESTIONS_SHOWN = 3
EXTENSIONS = (".pdf", ".docx")
FACT_ICONS = {"deadline": "⏰", "date": "📅", "duration": "⏳", "amount": "💰", "percent": "％"}
DIFF_ICONS = {"changed": "✏️", "added": "➕", "removed": "➖"}


def short(text: str, limit: int) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def split_message(text: str, limit: int = MESSAGE_LIMIT) -> list[str]:
    """Pieces of at most `limit` characters, cut at line breaks where possible."""
    parts: list[str] = []
    current = ""
    for line in text.split("\n"):
        while len(line) > limit:
            if current:
                parts.append(current)
                current = ""
            parts.append(line[:limit])
            line = line[limit:]
        candidate = f"{current}\n{line}" if current else line
        if len(candidate) > limit:
            parts.append(current)
            current = line
        else:
            current = candidate
    if current:
        parts.append(current)
    return parts


class Bot:
    def __init__(
        self,
        telegram: TelegramAPI,
        backend: BackendClient,
        state_path: Path | None = None,
        allowed_chats: set[int] | None = None,
        per_minute: int = 10,
        clock=time.monotonic,
    ) -> None:
        self.telegram = telegram
        self.backend = backend
        self.state_path = state_path
        self.allowed_chats = allowed_chats  # None: everybody may use the bot
        self.per_minute = per_minute
        self.clock = clock
        self._lock = threading.Lock()
        self._recent: dict[int, deque] = {}
        self.state: dict[str, dict] = self._load()

    # --- state

    def _load(self) -> dict:
        if self.state_path and self.state_path.exists():
            try:
                return json.loads(self.state_path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                logger.warning("bot state file unreadable, starting empty")
        return {}

    def _save(self) -> None:
        if not self.state_path:
            return
        try:
            self.state_path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.state_path.with_suffix(".tmp")
            temporary.write_text(json.dumps(self.state, ensure_ascii=False), encoding="utf-8")
            os.replace(temporary, self.state_path)
        except OSError:
            logger.warning("bot state could not be saved")

    def chat(self, chat_id: int) -> dict:
        with self._lock:
            return self.state.setdefault(
                str(chat_id), {"docs": [], "current": None, "conversations": {}, "sources": [], "suggestions": []}
            )

    def _current(self, chat: dict) -> dict | None:
        return next((doc for doc in chat["docs"] if doc["id"] == chat["current"]), None)

    # --- entry point

    def handle_update(self, update: dict) -> None:
        """Never raises: a failed update must not stop the polling loop."""
        chat_id, language = None, "ru"
        try:
            if "callback_query" in update:
                callback = update["callback_query"]
                chat_id = callback["message"]["chat"]["id"]
                language = language_of(callback.get("from", {}).get("language_code"))
                logger.info("update button=%s lang=%s", (callback.get("data") or "?")[:1], language)
                self._handle_callback(callback, chat_id, language)
            elif "message" in update:
                message = update["message"]
                chat_id = message["chat"]["id"]
                language = language_of(message.get("from", {}).get("language_code"))
                text = message.get("text") or ""
                kind = "document" if "document" in message else "command" if text.startswith("/") else "question" if text else "other"
                logger.info("update %s lang=%s", kind if kind != "command" else text.split()[0].split("@")[0], language)
                self._handle_message(message, chat_id, language)
        except BackendUnavailable:
            self._say(chat_id, t(language, "backend_down"))
        except TelegramError as exc:
            logger.warning("telegram error: %s", exc)
        except Exception as exc:  # the log carries the type only: messages can hold document text
            logger.error("update failed (%s)", type(exc).__name__)
            self._say(chat_id, t(language, "error"))

    def _say(self, chat_id: int | None, text: str, markup: dict | None = None) -> None:
        if chat_id is None:
            return
        try:
            for index, piece in enumerate(split_message(text) or [""]):
                last = index == len(split_message(text)) - 1
                self.telegram.send_message(chat_id, piece, reply_markup=markup if last else None)
        except TelegramError as exc:
            logger.warning("send failed: %s", exc)

    def _allowed(self, chat_id: int, language: str) -> bool:
        if self.allowed_chats is not None and chat_id not in self.allowed_chats:
            self._say(chat_id, t(language, "denied"))
            return False
        recent = self._recent.setdefault(chat_id, deque())
        now = self.clock()
        while recent and now - recent[0] > 60:
            recent.popleft()
        if len(recent) >= self.per_minute:
            self._say(chat_id, t(language, "rate"))
            return False
        recent.append(now)
        return True

    # --- messages

    def _handle_message(self, message: dict, chat_id: int, language: str) -> None:
        if message["chat"].get("type") != "private":
            self._say(chat_id, t(language, "private_only"))
            return
        if not self._allowed(chat_id, language):
            return
        chat = self.chat(chat_id)
        if "document" in message:
            self._handle_document(chat, chat_id, language, message["document"])
        elif "photo" in message:
            self._say(chat_id, t(language, "send_as_file"))
        elif message.get("text"):
            text = message["text"].strip()
            if text.startswith("/"):
                command, _, argument = text.partition(" ")
                self._handle_command(chat, chat_id, language, command.split("@")[0].lower(), argument.strip())
            else:
                self._ask(chat, chat_id, language, text)

    def _handle_command(self, chat: dict, chat_id: int, language: str, command: str, argument: str) -> None:
        if command == "/start":
            self._say(chat_id, t(language, "start"))
        elif command == "/help":
            self._say(chat_id, t(language, "help"))
        elif command == "/docs":
            self._docs(chat, chat_id, language)
        elif command == "/use":
            doc = self._by_number(chat, argument)
            if doc is None:
                self._say(chat_id, t(language, "bad_number"))
                return
            chat["current"] = doc["id"]
            self._save()
            self._say(chat_id, t(language, "used", name=html.escape(doc["name"])))
        elif command == "/delete":
            self._delete(chat, chat_id, language, argument)
        elif command == "/facts":
            self._facts(chat, chat_id, language)
        elif command == "/compare":
            self._compare(chat, chat_id, language, argument)
        else:
            self._say(chat_id, t(language, "help"))

    # --- documents

    def _by_number(self, chat: dict, argument: str) -> dict | None:
        try:
            number = int(argument)
        except ValueError:
            return None
        return chat["docs"][number - 1] if 1 <= number <= len(chat["docs"]) else None

    def _docs(self, chat: dict, chat_id: int, language: str) -> None:
        if not chat["docs"]:
            self._say(chat_id, t(language, "no_docs"))
            return
        lines = [t(language, "docs_header")]
        for number, doc in enumerate(chat["docs"], start=1):
            mark = "●" if doc["id"] == chat["current"] else "○"
            lines.append(f"{mark} {number}. {html.escape(doc['name'])} ({doc['kind']})")
        self._say(chat_id, "\n".join(lines))

    def _delete(self, chat: dict, chat_id: int, language: str, argument: str) -> None:
        doc = self._by_number(chat, argument)
        if doc is None:
            self._say(chat_id, t(language, "bad_number"))
            return
        self._forget(chat, doc, delete_remote=True)
        self._say(chat_id, t(language, "deleted", name=html.escape(doc["name"])))

    def _forget(self, chat: dict, doc: dict, delete_remote: bool) -> None:
        if delete_remote:
            try:
                self.backend.delete_document(doc["id"])
            except BackendUnavailable:
                pass
        with self._lock:
            chat["docs"] = [item for item in chat["docs"] if item["id"] != doc["id"]]
            chat["conversations"].pop(doc["id"], None)
            if chat["current"] == doc["id"]:
                chat["current"] = chat["docs"][-1]["id"] if chat["docs"] else None
        self._save()

    def _handle_document(self, chat: dict, chat_id: int, language: str, document: dict) -> None:
        name = document.get("file_name") or "document"
        if not name.lower().endswith(EXTENSIONS):
            self._say(chat_id, t(language, "unsupported"))
            return
        if (document.get("file_size") or 0) > MAX_FILE_BYTES:
            self._say(chat_id, t(language, "too_big"))
            return
        self._say(chat_id, t(language, "uploading", name=html.escape(name)))
        self.telegram.send_chat_action(chat_id, "upload_document")
        try:
            data = self.telegram.download_file(self.telegram.get_file_path(document["file_id"]))
        except TelegramError as exc:
            logger.warning("file download failed: %s", exc)
            self._say(chat_id, t(language, "too_big") if exc.code == 400 else t(language, "failed"))
            return
        if len(data) > MAX_FILE_BYTES:
            self._say(chat_id, t(language, "too_big"))
            return
        created = self.backend.upload(name, data)
        if not created.get("id"):
            code = (created.get("error") or {}).get("code")
            key = {"UNSUPPORTED_TYPE": "unsupported", "FILE_TOO_LARGE": "too_big"}.get(code, "failed")
            self._say(chat_id, t(language, key))
            return
        state = self.backend.wait_ready(created["id"])
        logger.info(
            "document kind=%s status=%s pages=%s ocr=%s error=%s",
            state.get("kind"), state["status"], state.get("pageCount"), state.get("ocrUsed"), (state.get("error") or {}).get("code"),
        )
        if state["status"] == "processing":
            self._say(chat_id, t(language, "slow"))
            return
        if state["status"] != "ready":
            code = (state.get("error") or {}).get("code")
            key = f"failed_{code}" if f"failed_{code}" in TEXTS else "failed"
            self._say(chat_id, t(language, key))
            return
        doc = {"id": state["id"], "name": name, "kind": state["kind"], "ocr": bool(state.get("ocrUsed"))}
        with self._lock:
            chat["docs"].append(doc)
            chat["current"] = doc["id"]
        while len(chat["docs"]) > MAX_DOCS_PER_CHAT:
            self._forget(chat, chat["docs"][0], delete_remote=True)
        facts = self.backend.facts(doc["id"]) or {}
        suggestions = (facts.get("suggestedQuestions") or [])[:SUGGESTIONS_SHOWN]
        chat["suggestions"] = suggestions
        self._save()
        pages = t(language, "pages", n=state["pageCount"]) if state.get("pageCount") else ""
        lines = [t(language, "ready", name=html.escape(name), pages=pages)]
        if doc["ocr"]:
            lines.append(t(language, "ocr_note"))
        if suggestions:
            lines.append(t(language, "suggestions"))
        markup = {"inline_keyboard": [[{"text": short(q, 60), "callback_data": f"q:{i}"}] for i, q in enumerate(suggestions)]}
        self._say(chat_id, "\n".join(lines), markup if suggestions else None)

    # --- questions

    def _ask(self, chat: dict, chat_id: int, language: str, question: str) -> None:
        doc = self._current(chat)
        if doc is None:
            self._say(chat_id, t(language, "need_doc"))
            return
        conversation = chat["conversations"].get(doc["id"]) or self.backend.create_conversation([doc["id"]])
        if conversation is None:
            current = self.backend.document(doc["id"])
            if current is None:  # the backend lost it, for example after a reset
                self._forget(chat, doc, delete_remote=False)
                self._say(chat_id, t(language, "need_doc"))
            else:
                self._say(chat_id, t(language, "slow"))
            return
        chat["conversations"][doc["id"]] = conversation
        self.telegram.send_chat_action(chat_id, "typing")
        answer = self.backend.ask(conversation, question)
        self._reply(chat, chat_id, language, doc, answer)

    def _reply(self, chat: dict, chat_id: int, language: str, doc: dict, answer: Answer) -> None:
        # Outcome only: the question, the answer and the quotes are never logged.
        logger.info(
            "answer status=%s reason=%s error=%s sources=%d", answer.status, answer.reason, answer.error_code, len(answer.sources)
        )
        if answer.error_code:
            key = f"error_{answer.error_code}"
            self._say(chat_id, t(language, key if key in TEXTS else "error"))
            return
        if answer.status != "answered":
            key = f"not_found_{answer.reason}"
            self._say(chat_id, t(language, key if key in TEXTS else "not_found"))
            return
        lines = [html.escape(answer.text), "", t(language, "answer_sources")]
        buttons = []
        for index, source in enumerate(answer.sources):
            place = (
                f"{t(language, 'page_short')} {source['page']}"
                if source.get("page") is not None
                else f"{t(language, 'section')} {source.get('location') or '-'}"
            )
            lines.append(
                f"[{source['index']}] {html.escape(source['documentName'])}, {html.escape(str(place))}: "
                f"«{html.escape(short(source['quote'], QUOTE_LIMIT))}»"
            )
            if source.get("page") is not None and doc["kind"] == "pdf":
                buttons.append({"text": f"[{source['index']}] " + t(language, "show_page", n=source["page"]), "callback_data": f"s:{index}"})
        chat["sources"] = answer.sources
        self._save()
        markup = {"inline_keyboard": [buttons[i : i + 2] for i in range(0, len(buttons), 2)]} if buttons else None
        self._say(chat_id, "\n".join(lines), markup)

    # --- buttons

    def _handle_callback(self, callback: dict, chat_id: int, language: str) -> None:
        self.telegram.answer_callback_query(callback["id"])
        if not self._allowed(chat_id, language):
            return
        chat = self.chat(chat_id)
        kind, _, number = (callback.get("data") or "").partition(":")
        if not number.isdigit():
            return
        index = int(number)
        if kind == "q" and index < len(chat["suggestions"]):
            self._ask(chat, chat_id, language, chat["suggestions"][index])
        elif kind == "s":
            self._show_page(chat, chat_id, language, index)
        else:
            self._say(chat_id, t(language, "page_gone"))

    def _show_page(self, chat: dict, chat_id: int, language: str, index: int) -> None:
        if index >= len(chat["sources"]):
            self._say(chat_id, t(language, "page_gone"))
            return
        source = chat["sources"][index]
        pdf = self.backend.file(source["documentId"])
        if pdf is None or source.get("page") is None:
            self._say(chat_id, t(language, "page_gone"))
            return
        self.telegram.send_chat_action(chat_id, "upload_photo")
        png, highlighted = render_page(pdf, source["page"], source.get("highlights"))
        caption = f"[{source['index']}] {html.escape(source['documentName'])}, {t(language, 'page_short')} {source['page']}: «{html.escape(short(source['quote'], QUOTE_LIMIT))}»"
        if not highlighted:
            caption += "\n" + t(language, "page_caption_nohl")
        self.telegram.send_photo(chat_id, png, short(caption, CAPTION_LIMIT))

    # --- facts and comparison

    def _facts(self, chat: dict, chat_id: int, language: str) -> None:
        doc = self._current(chat)
        if doc is None:
            self._say(chat_id, t(language, "need_doc"))
            return
        facts = (self.backend.facts(doc["id"]) or {}).get("facts") or []
        if not facts:
            self._say(chat_id, t(language, "facts_none"))
            return
        lines = [t(language, "facts_header", name=html.escape(doc["name"]))]
        for fact in facts[:FACTS_SHOWN]:
            place = f"{t(language, 'page_short')} {fact['page']}" if fact.get("page") is not None else html.escape(str(fact.get("location") or ""))
            lines.append(
                f"{FACT_ICONS.get(fact['kind'], '•')} {html.escape(fact['value'])} ({place}): «{html.escape(short(fact['quote'], 120))}»"
            )
        self._say(chat_id, "\n".join(lines))

    def _compare(self, chat: dict, chat_id: int, language: str, argument: str) -> None:
        parts = argument.split()
        first = self._by_number(chat, parts[0]) if len(parts) == 2 else None
        second = self._by_number(chat, parts[1]) if len(parts) == 2 else None
        if first is None or second is None:
            self._say(chat_id, t(language, "compare_usage"))
            return
        self._say(chat_id, t(language, "compare_wait"))
        result = self.backend.compare(first["id"], second["id"])
        if not result or result.get("status") != "ready":
            self._say(chat_id, t(language, "compare_failed"))
            return
        differences = result.get("differences") or []
        if not differences:
            self._say(chat_id, t(language, "compare_none"))
            return
        lines = [html.escape(result.get("summary", "")), ""]
        for diff in differences[:DIFFS_SHOWN]:
            side_a, side_b = diff.get("a") or {}, diff.get("b") or {}
            lines.append(f"{DIFF_ICONS.get(diff['type'], '•')} {t(language, 'diff_' + diff['type'])}: {html.escape(diff.get('explanation', ''))}")
            if side_a.get("quote"):
                lines.append(f"  1: «{html.escape(short(side_a['quote'], 140))}»")
            if side_b.get("quote"):
                lines.append(f"  2: «{html.escape(short(side_b['quote'], 140))}»")
        if len(differences) > DIFFS_SHOWN:
            lines.append(f"… +{len(differences) - DIFFS_SHOWN}")
        lines += ["", t(language, "compare_note")]
        self._say(chat_id, "\n".join(lines))
