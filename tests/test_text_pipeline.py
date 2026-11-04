from pathlib import Path

from app.chunking import MAX_CHARS, build_chunks, split_segment
from app.citations import is_verbatim
from app.extraction import Segment, extract_docx, extract_pdf, normalize
from app.retrieval import rank
from tests.conftest import make_docx, make_pdf


def test_extract_pdf_keeps_page_numbers_starting_at_one(tmp_path: Path):
    path = tmp_path / "a.pdf"
    path.write_bytes(make_pdf(["Alpha text", "Beta text"]))
    segments = extract_pdf(path)
    assert [(s.page, s.text) for s in segments] == [(1, "Alpha text"), (2, "Beta text")]


def test_extract_docx_uses_headings_as_locations(tmp_path: Path):
    path = tmp_path / "a.docx"
    path.write_bytes(make_docx([(None, ["Intro line."]), ("Teams", ["Maximum three members."])]))
    segments = extract_docx(path)
    assert segments[0].page is None
    assert segments[0].location is None
    assert segments[1].location == "Teams"
    assert "Maximum three members." in segments[1].text


def test_normalize_collapses_whitespace():
    assert normalize("  a\n\n b\t c  ") == "a b c"


def test_split_segment_keeps_chunks_under_limit_and_verbatim():
    text = " ".join(f"Sentence number {i} is here." for i in range(200))
    chunks = split_segment(text)
    assert len(chunks) > 1
    assert all(len(chunk) <= MAX_CHARS for chunk in chunks)
    assert all(chunk in text for chunk in chunks)


def test_split_segment_handles_one_very_long_word():
    text = "x" * (MAX_CHARS * 2 + 10)
    chunks = split_segment(text)
    assert "".join(chunks) == text


def test_chunks_never_span_segments():
    segments = [Segment(1, None, "First page."), Segment(2, None, "Second page.")]
    chunks = build_chunks(segments)
    assert chunks == [(0, "First page."), (1, "Second page.")]


def test_quote_must_be_verbatim_in_source():
    source = "Teams may have at most\nthree members."
    assert is_verbatim("Teams may have at most three members.", source)
    assert not is_verbatim("Teams may have at most four members.", source)
    assert not is_verbatim("", source)


def test_rank_prefers_documents_sharing_query_terms():
    texts = ["Registration closes on the fifth of November.", "The library opens at nine."]
    hits = rank("When does registration close?", texts, top_k=5)
    assert hits[0][0] == 0
    assert all(score > 0 for _index, score in hits)


def test_rank_returns_nothing_without_overlap():
    assert rank("quantum chromodynamics", ["The library opens at nine."], top_k=5) == []


def test_prefixed_verb_meets_the_noun():
    texts = ["Регистрация команд заканчивается 5 ноября.", "Библиотека открывается в девять."]
    assert rank("До какого числа нужно зарегистрироваться?", texts, top_k=5)[0][0] == 0
