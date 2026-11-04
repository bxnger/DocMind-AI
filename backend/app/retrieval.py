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


# Words that carry no topic in a question: question words, "tell me", and the words for "document" and
# "summary". A question made only of these ("What is this document about?") asks about the whole
# document, so searching for its words finds nothing.
STOPWORDS = frozenset(
    """
    a an the is are was were be been of in on at to for from by with about what which who whom whose when where
    why how does do did can could would should will this that these those it its and or not any all tell me
    please give show explain describe summarize summarise summary overview main document documents file files
    text pdf docx content contents mention mentioned there here
    и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по ее мне было вот от меня еще
    нет о из ему когда даже ну ли если уже или ни быть был него до вас там они тут где есть для мы их чем чём была
    кто этот эта это эти этом этой этого той том тем какой какая какое какие каков какова сколько почему зачем
    расскажи расскажите скажи скажите объясни опиши опишите кратко суть тема темы документ документе документа
    документы документов файл файле файла текст тексте текста содержание содержании содержит говорится написано
    упоминается речь идет идёт при про
    бұл осы сол не неге қалай қашан қайда кім қандай қанша неше туралы жайлы жөнінде және мен пен бен да де та те
    ма ме ба бе ше па пе ол құжат құжатта құжаттың құжатты құжаттағы мәтін мәтінде файл файлда айт айтып бер
    түсіндір сипаттаңыз қысқаша мазмұны мазмұн бар жоқ
    """.split()
)


def content_words(text: str) -> list[str]:
    return [word for word in TOKEN.findall(text.lower()) if word not in STOPWORDS]


def is_overview_question(question: str) -> bool:
    """True for a question made only of generic words, such as "What is this document about?"."""
    return bool(TOKEN.search(question)) and not content_words(question)


def overview_chunks(chunks: list[dict], limit: int) -> list[dict]:
    """A sample of the document for an overview question: the start, then evenly across the rest.

    Each document gets its share, so a conversation with several documents describes all of them.
    """
    if len(chunks) <= limit:
        return list(chunks)
    by_document: dict[str, list[dict]] = {}
    for chunk in chunks:
        by_document.setdefault(chunk["documentId"], []).append(chunk)
    groups = list(by_document.values())
    quota = [limit // len(groups) + (1 if index < limit % len(groups) else 0) for index in range(len(groups))]
    picked: list[dict] = []
    for group, take in zip(groups, quota):
        take = min(max(take, 1), len(group))
        step = (len(group) - 1) / (take - 1) if take > 1 else 0
        picked.extend(group[round(index * step)] for index in range(take))
    return picked[:limit]


def rank(query: str, texts: list[str], top_k: int) -> list[tuple[int, float]]:
    """BM25 over `texts`. Returns (index, score) for texts with score > 0, best first."""
    if not texts:
        return []
    docs = [Counter(tokenize(text)) for text in texts]
    lengths = [sum(doc.values()) for doc in docs]
    average_length = (sum(lengths) / len(lengths)) or 1
    query_terms = {stem(word) for word in content_words(query)}
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
