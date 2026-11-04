import re

from app.extraction import normalize


def is_verbatim(quote: str, source: str) -> bool:
    """True when `quote` appears in `source` after whitespace normalisation."""
    needle = normalize(quote)
    return bool(needle) and needle in normalize(source)


# Numbers are the same in every language, so they are the one claim detail that can be checked against
# the source without a model: "15 000", "15,000" and "15000" are the same value.
_NUMBER = re.compile(r"\d{1,3}(?:[ \u00a0,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?")
_MARKER = re.compile(r"\[\d+(?:\s*[,;]\s*\d+)*\]")


def numbers_in(text: str) -> set[str]:
    values = set()
    for match in _NUMBER.findall(_MARKER.sub(" ", text)):
        value = re.sub(r"[ \u00a0]", "", match)
        if re.fullmatch(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?", value):
            value = value.replace(",", "")  # thousands separator
        values.add(value.replace(",", "."))  # decimal comma
    return values


def unsupported_numbers(claim: str, evidence: str) -> list[str]:
    """Numbers stated in `claim` that do not appear in `evidence`. Empty when every number is supported.

    This does not check that the evidence *means* what the claim says, only that the figures and
    dates the claim states are really in the cited text.
    """
    return sorted(numbers_in(claim) - numbers_in(evidence))
