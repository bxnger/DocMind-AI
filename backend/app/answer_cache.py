"""Remembers verified answers, so a repeated question is instant and never hits the model's rate limit.

Only answers that passed citation verification are stored. A document id is never reused, so a cached
answer cannot outlive its document: after a delete nothing asks for that key again.
"""

import re
from collections import OrderedDict
from dataclasses import dataclass

MAX_ENTRIES = 200
REPLAY_PIECE_CHARS = 24


def cache_key(document_ids: list[str], question: str, language: str | None, history: list[tuple[str, str]]) -> tuple:
    normalized = re.sub(r"\s+", " ", question).strip().lower()
    return (tuple(sorted(document_ids)), normalized, language or "", tuple(history))


@dataclass(frozen=True)
class CachedAnswer:
    text: str
    sources: list[dict]

    def pieces(self) -> list[str]:
        """The text in small parts, so the client sees it appear as it would from the model."""
        return [self.text[i : i + REPLAY_PIECE_CHARS] for i in range(0, len(self.text), REPLAY_PIECE_CHARS)]


class AnswerCache:
    def __init__(self, max_entries: int = MAX_ENTRIES) -> None:
        self.max_entries = max_entries
        self._items: OrderedDict[tuple, CachedAnswer] = OrderedDict()

    def get(self, key: tuple) -> CachedAnswer | None:
        item = self._items.get(key)
        if item is not None:
            self._items.move_to_end(key)
        return item

    def put(self, key: tuple, text: str, sources: list[dict]) -> None:
        self._items[key] = CachedAnswer(text, sources)
        self._items.move_to_end(key)
        while len(self._items) > self.max_entries:
            self._items.popitem(last=False)
