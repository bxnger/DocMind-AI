from app.extraction import normalize


def is_verbatim(quote: str, source: str) -> bool:
    """True when `quote` appears in `source` after whitespace normalisation."""
    needle = normalize(quote)
    return bool(needle) and needle in normalize(source)
