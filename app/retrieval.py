import math
import re
from collections import Counter

TOKEN = re.compile(r"\w+")
K1 = 1.5
B = 0.75
STEM_LENGTH = 5


VERB_PREFIXES = ("пере", "при", "под", "про", "раз", "за", "по", "на", "вы", "от", "об", "до", "со")
MIN_LENGTH_FOR_PREFIX_STRIP = 9


def stem(word: str) -> str:
    # Long Russian words lose a common prefix, so "зарегистрироваться" meets "регистрация".
    if len(word) >= MIN_LENGTH_FOR_PREFIX_STRIP:
        for prefix in VERB_PREFIXES:
            if word.startswith(prefix):
                word = word[len(prefix):]
                break
    # Cutting to the first 5 letters is a crude stemmer, but it matches the endings of
    # Russian, Kazakh and English alike ("регистрация" / "регистрации").
    return word[:STEM_LENGTH]


def tokenize(text: str) -> list[str]:
    return [stem(word) for word in TOKEN.findall(text.lower())]


def rank(query: str, texts: list[str], top_k: int) -> list[tuple[int, float]]:
    """BM25 over `texts`. Returns (index, score) for texts with score > 0, best first."""
    if not texts:
        return []
    docs = [Counter(tokenize(text)) for text in texts]
    lengths = [sum(doc.values()) for doc in docs]
    average_length = (sum(lengths) / len(lengths)) or 1
    query_terms = set(tokenize(query))
    document_frequency = Counter(term for doc in docs for term in query_terms if term in doc)
    count = len(docs)

    scored: list[tuple[int, float]] = []
    for index, doc in enumerate(docs):
        score = 0.0
        for term in query_terms:
            frequency = doc.get(term, 0)
            if not frequency:
                continue
            df = document_frequency[term]
            idf = math.log(1 + (count - df + 0.5) / (df + 0.5))
            norm = frequency + K1 * (1 - B + B * lengths[index] / average_length)
            score += idf * frequency * (K1 + 1) / norm
        if score > 0:
            scored.append((index, score))
    scored.sort(key=lambda pair: pair[1], reverse=True)
    return scored[:top_k]
