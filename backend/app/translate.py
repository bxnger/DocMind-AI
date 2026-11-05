"""Cross-language search: a question in one language finds passages of a document in another.

Keyword search matches words, so "Сколько стоит аренда?" cannot find "The monthly rent is 450 USD". When the
language of the question differs from the language of the documents, the question is translated into the document
language (one short model call), and the search runs on the question and its translation together.

Only the *search query* is translated. The excerpts the model reads and the quotes shown to the user always come
from the original document. If the translation fails for any reason the search simply runs on the original question.
"""

import logging
import re
import time
from collections import OrderedDict

logger = logging.getLogger("app.chat")

LANGUAGE_NAMES = {"ru": "Russian", "kk": "Kazakh (Cyrillic script, not Latin transliteration)", "en": "English"}
KAZAKH_LETTERS = set("әіңғүұқөһӘІҢҒҮҰҚӨҺ")
CYRILLIC = re.compile(r"[а-яёА-ЯЁ" + "".join(sorted(KAZAKH_LETTERS)) + r"]")
LATIN = re.compile(r"[A-Za-z]")
MAX_CACHED = 500
SCRIPT_PURITY = 0.9


def translation_prompt(question: str, target_languages: list[str]) -> str:
    """The instruction sent to the model: a plain translation, one line per target language.

    Asking for an extra phrasing with synonyms was measured and was worse (see docs/EVAL.md).
    """
    return (
        f"Translate this search query into {' and '.join(target_languages)}. "
        "Reply with one translation per line and nothing else. "
        "Keep numbers, names and codes unchanged.\n\nQuery: " + question
    )


def query_language(text: str) -> str | None:
    """"kk", "ru" or "en" from the script of a short question, or None when it has no letters."""
    cyrillic = len(CYRILLIC.findall(text))
    latin = len(LATIN.findall(text))
    if not cyrillic and not latin:
        return None
    if latin > cyrillic:
        return "en"
    return "kk" if any(char in KAZAKH_LETTERS for char in text) else "ru"


def translation_targets(question_language: str | None, document_languages: list[str | None]) -> list[str]:
    """The languages to translate the question into, in a stable order. Empty when no translation is needed."""
    if question_language is None:
        return []
    wanted: set[str] = set()
    for language in document_languages:
        if language == "mixed":
            wanted.update(LANGUAGE_NAMES)
        elif language in LANGUAGE_NAMES:
            wanted.add(language)
    wanted.discard(question_language)
    return [language for language in ("en", "ru", "kk") if language in wanted]


def clean_translation(text: str, targets: list[str]) -> str:
    """Keeps the translated lines that are really written in a target language's script.

    A small model sometimes answers in Latin transliteration or mixes scripts ("Жatakhana oryn"). Such a line
    would add noise to the search, so it is dropped; if nothing is left the search uses the original question.
    """
    want_cyrillic = any(language in ("ru", "kk") for language in targets)
    want_latin = "en" in targets
    kept = []
    for line in text.splitlines():
        cyrillic, latin = len(CYRILLIC.findall(line)), len(LATIN.findall(line))
        letters = cyrillic + latin
        if not letters:
            continue
        if (want_cyrillic and cyrillic / letters >= SCRIPT_PURITY) or (want_latin and latin / letters >= SCRIPT_PURITY):
            kept.append(line.strip())
    return "\n".join(kept)


class TranslationCache:
    """Translated questions, least recently used first out. Holds question text only, never document text."""

    def __init__(self, max_entries: int = MAX_CACHED) -> None:
        self.max_entries = max_entries
        self._items: OrderedDict[tuple, str] = OrderedDict()

    @staticmethod
    def key(question: str, targets: list[str]) -> tuple:
        return (re.sub(r"\s+", " ", question).strip().lower(), tuple(targets))

    def get(self, key: tuple) -> str | None:
        value = self._items.get(key)
        if value is not None:
            self._items.move_to_end(key)
        return value

    def put(self, key: tuple, value: str) -> None:
        self._items[key] = value
        self._items.move_to_end(key)
        while len(self._items) > self.max_entries:
            self._items.popitem(last=False)


TRANSLATIONS = TranslationCache()


async def search_translation(answerer, question: str, document_languages: list[str | None]) -> tuple[str, list[str], float]:
    """(translated question, target languages, milliseconds spent). The translation is "" when none was needed or possible.

    Never raises: a provider error only means the search falls back to the original question.
    """
    targets = translation_targets(query_language(question), document_languages)
    translate = getattr(answerer, "translate_query", None)
    if not targets or translate is None:
        return "", targets, 0.0
    key = TRANSLATIONS.key(question, targets)
    cached = TRANSLATIONS.get(key)
    if cached is not None:
        return cached, targets, 0.0
    started = time.monotonic()
    try:
        translated = await translate(question, [LANGUAGE_NAMES[language] for language in targets])
    except Exception as exc:  # the search must not depend on the translation
        logger.warning("query translation failed (%s)", type(exc).__name__)
        translated = None
    elapsed = (time.monotonic() - started) * 1000
    translated = clean_translation(translated, targets) if translated else None
    if translated:
        TRANSLATIONS.put(key, translated)
    return translated or "", targets, elapsed
