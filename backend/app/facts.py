"""Key facts of a document: dates, deadlines, amounts and percentages, each with its exact sentence and page.

Found with patterns, no model, so every fact is a real quote that can be opened and highlighted.
"""

import re

from app.chunking import SENTENCE_END
from app.citations import is_verbatim

MAX_FACTS = 60

MONTHS = (
    r"январ\w*|феврал\w*|март\w*|апрел\w*|ма[йя]\w*|июн\w*|июл\w*|август\w*|сентябр\w*|октябр\w*|ноябр\w*|декабр\w*"
    r"|january|february|march|april|may|june|july|august|september|october|november|december"
    r"|қаңтар\w*|ақпан\w*|наурыз\w*|сәуір\w*|мамыр\w*|маусым\w*|шілде\w*|тамыз\w*|қыркүйек\w*|қазан\w*|қараша\w*|желтоқсан\w*"
)
DATE = re.compile(
    rf"\b\d{{1,2}}[./]\d{{1,2}}[./]\d{{2,4}}\b"  # 05.11.2026
    rf"|\b\d{{4}}-\d{{2}}-\d{{2}}\b"  # 2026-11-05
    rf"|\b\d{{1,2}}\s+(?:{MONTHS})(?:\s+\d{{4}})?"  # 5 ноября 2026, 5 November
    rf"|\b(?:{MONTHS})\s+\d{{1,2}}(?:,\s*\d{{4}})?",  # November 5, 2026
    re.IGNORECASE,
)
CURRENCY = r"(?:₸|тг\.?|тенге|kzt|tenge|руб\w*|rub|usd|\$|€|eur\w*|доллар\w*|долл\.?|евро)"
AMOUNT = re.compile(
    rf"(?:\d[\d\s]*(?:[.,]\d+)?\s*{CURRENCY})|(?:[$€₸]\s*\d[\d\s,.]*)",
    re.IGNORECASE,
)
UNITS = r"(?:рабоч\w*\s+|календарн\w*\s+|working\s+|business\s+|жұмыс\s+)?(?:дн\w*|недел\w*|месяц\w*|час\w*|days?|weeks?|months?|hours?|күн\w*|апта\w*|ай\w*|сағат\w*)"
DURATION = re.compile(
    rf"(?:в\s+течение|не\s+более|не\s+менее|в\s+срок\s+до|within|for\s+up\s+to|at\s+least)\s+\d+\s+{UNITS}"
    rf"|\d+\s+{UNITS}\s+ішінде",  # Kazakh puts "within" after the number
    re.IGNORECASE,
)
PERCENT = re.compile(r"\b\d+(?:[.,]\d+)?\s*%")
DEADLINE_WORDS = re.compile(
    r"до\s|не\s+позднее|не\s+позже|крайн\w*\s+срок|срок\w*\s+(?:до|подачи|оплаты|сдачи)|дедлайн|deadline|by\s|until|no\s+later|due|дейін|мерзім|ең\s+кеш",
    re.IGNORECASE,
)

TEMPLATES = {
    "ru": {"deadline": "Какие сроки и дедлайны указаны в документе?", "amount": "Какие суммы указаны в документе?",
           "percent": "Какие проценты указаны в документе?", "date": "Какие даты упоминаются в документе?",
           "summary": "О чём этот документ?", "duration": "В какие сроки нужно что-то сделать?"},
    "en": {"deadline": "What deadlines does the document state?", "amount": "What amounts are mentioned?",
           "percent": "What percentages are mentioned?", "date": "Which dates does the document mention?",
           "summary": "What is this document about?", "duration": "How much time is allowed for each step?"},
    "kk": {"deadline": "Құжатта қандай мерзімдер көрсетілген?", "amount": "Құжатта қандай сомалар көрсетілген?",
           "percent": "Құжатта қандай пайыздар көрсетілген?", "date": "Құжатта қандай күндер аталған?",
           "summary": "Бұл құжат не туралы?", "duration": "Әр қадамға қанша уақыт беріледі?"},
}


def sentence_facts(sentence: str) -> list[tuple[str, str]]:
    """(kind, value) pairs found in one sentence. A date in a sentence about terms is a deadline."""
    found: list[tuple[str, str]] = []
    dates = [m.group(0).strip() for m in DATE.finditer(sentence)]
    kind = "deadline" if dates and DEADLINE_WORDS.search(sentence) else "date"
    found += [(kind, value) for value in dates]
    found += [("amount", " ".join(m.group(0).split())) for m in AMOUNT.finditer(sentence)]
    found += [("duration", " ".join(m.group(0).split())) for m in DURATION.finditer(sentence)]
    found += [("percent", " ".join(m.group(0).split())) for m in PERCENT.finditer(sentence)]
    return found


def extract_facts(segments: list[dict]) -> list[dict]:
    facts: list[dict] = []
    seen: set[tuple[str, str, str]] = set()
    for segment in segments:
        for sentence in SENTENCE_END.split(segment["text"]):
            sentence = sentence.strip()
            if not sentence or len(sentence) > 500 or not is_verbatim(sentence, segment["text"]):
                continue
            for kind, value in sentence_facts(sentence):
                key = (kind, value.lower(), sentence)
                if key in seen:
                    continue
                seen.add(key)
                facts.append(
                    {"kind": kind, "value": value, "quote": sentence, "page": segment["page"], "location": segment["location"]}
                )
                if len(facts) >= MAX_FACTS:
                    return facts
    return facts


def suggested_questions(facts: list[dict], language: str | None) -> list[str]:
    texts = TEMPLATES.get(language if language in TEMPLATES else "en", TEMPLATES["en"])
    kinds = {fact["kind"] for fact in facts}
    order = ["summary"] + [kind for kind in ("deadline", "duration", "amount", "percent", "date") if kind in kinds]
    if "deadline" in kinds:
        order = [kind for kind in order if kind != "date"]
    return [texts[kind] for kind in order]
