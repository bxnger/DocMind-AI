import re

from app.extraction import Segment

MAX_CHARS = 500
SENTENCE_END = re.compile(r"(?<=[.!?])\s+")


def split_segment(text: str) -> list[str]:
    """Split into chunks of at most MAX_CHARS, cutting at sentence ends.

    Chunks are exact substrings of `text`: sentences are re-joined with the single
    space that normalisation already left between them.
    """
    chunks: list[str] = []
    current = ""
    for sentence in SENTENCE_END.split(text):
        while len(sentence) > MAX_CHARS:
            if current:
                chunks.append(current)
                current = ""
            chunks.append(sentence[:MAX_CHARS])
            sentence = sentence[MAX_CHARS:]
        if not sentence:
            continue
        candidate = f"{current} {sentence}" if current else sentence
        if len(candidate) > MAX_CHARS:
            chunks.append(current)
            current = sentence
        else:
            current = candidate
    if current:
        chunks.append(current)
    return chunks


def build_chunks(segments: list[Segment]) -> list[tuple[int, str]]:
    """Returns (segment index, chunk text). A chunk never spans two segments."""
    return [
        (seq, chunk)
        for seq, segment in enumerate(segments)
        for chunk in split_segment(segment.text)
    ]
