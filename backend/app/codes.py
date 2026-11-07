"""Part numbers: comparing them across documents, photos and price lists, and reading bearing designations.

Everything here is plain code, no model: whether two part numbers match, and the dimensions of a standard bearing,
must not depend on what an AI thinks.
"""

import re

# Cyrillic letters that look like Latin ones. OCR and people mix them up in codes like "6205-2RS" / "6205-2РС".
LOOKALIKES = str.maketrans("АВЕКМНОРСТХУаеорсху", "ABEKMHOPCTXYaeopcxy")
SEPARATORS = re.compile(r"[\s\-‐-―./_]+")


def normalize_code(code: str) -> str:
    """The comparable form of a part number: Latin capitals, no spaces, dashes, dots or slashes. "6205-2РС" -> "62052RS"."""
    return SEPARATORS.sub("", code.translate(LOOKALIKES)).upper()


_BASE = re.compile(r"^\s*([A-Z]{0,4})\s*(\d+)")


def code_base(code: str) -> str:
    """The designation without its suffixes: "6205-2RS" -> "6205", "NU 210 ECP" -> "NU210". Empty when there is none."""
    match = _BASE.match(code.translate(LOOKALIKES).upper())
    return f"{match.group(1)}{match.group(2)}" if match else ""


def code_match(document_code: str, other_code: str) -> str | None:
    """"exact" (same after normalizing), "close" (same designation, other suffixes: 6205-2RS vs 6205-2RSH),
    "partial" (one contains the other), or None."""
    a, b = normalize_code(document_code), normalize_code(other_code)
    if not a or not b:
        return None
    if a == b:
        return "exact"
    base_a, base_b = code_base(document_code), code_base(other_code)
    if base_a and base_a == base_b and len(base_a) >= 3:
        return "close"
    shorter, longer = sorted((a, b), key=len)
    if len(shorter) >= 4 and shorter in longer:
        return "partial"
    return None


# Bearings ---------------------------------------------------------------------------------------------------------

BEARING_WORD = re.compile(r"подшипн|подш\.|bearing|мойынтірек|подшип", re.IGNORECASE)
SUFFIX = r"(?:2RS1|2RSH|2RS|2RZ|2Z|ZZ|RS|Z|ECP|ECJ|EC|EK|E|K|MA|MB|M|C3|C4|TN9|P5|P6|NR|J|BE|B|AC|A|CD)"
BEARING = re.compile(
    rf"(?<![\w./-])(?:(NUP|NU|NJ|NN|NA|N|UCP|UCF|UC)\s?)?(\d{{3,5}})((?:[-\s]?{SUFFIX})*)(?![\w/])",
)
QUANTITY_AFTER = re.compile(r"^[\s,;:—–\-|()]*(?:[xх×]\s*)?(\d{1,4})\s*(?:шт|pcs|pc|дана|ед|штук)\b", re.IGNORECASE)
QUANTITY = re.compile(r"(?<![\d.,])(\d{1,4})\s*(?:шт|pcs|pc|дана|штук)\b", re.IGNORECASE)

# Bore code (last two digits) -> bore diameter, mm. ISO 15 / ISO 355 rule: 00-03 are fixed, from 04 on it is code x 5.
FIXED_BORES = {0: 10, 1: 12, 2: 15, 3: 17}
# Deep groove ball bearings, series 60 / 62 / 63: outer diameter D and width B by bore code (ISO 15 dimension series).
DEEP_GROOVE = {
    "60": {0: (26, 8), 1: (28, 8), 2: (32, 9), 3: (35, 10), 4: (42, 12), 5: (47, 12), 6: (55, 13), 7: (62, 14),
           8: (68, 15), 9: (75, 16), 10: (80, 16)},
    "62": {0: (30, 9), 1: (32, 10), 2: (35, 11), 3: (40, 12), 4: (47, 14), 5: (52, 15), 6: (62, 16), 7: (72, 17),
           8: (80, 18), 9: (85, 19), 10: (90, 20), 11: (100, 21), 12: (110, 22)},
    "63": {0: (35, 11), 1: (37, 12), 2: (42, 13), 3: (47, 14), 4: (52, 15), 5: (62, 17), 6: (72, 19), 7: (80, 21),
           8: (90, 23), 9: (100, 25), 10: (110, 27)},
}


def bore_diameter(bore_code: int) -> int | None:
    if bore_code in FIXED_BORES:
        return FIXED_BORES[bore_code]
    if 4 <= bore_code <= 96:
        return bore_code * 5
    return None


def standard_bearing_specs(designation: str) -> list[dict]:
    """Dimensions that follow from a standard bearing designation, computed here (origin "standard").
    Only what the rules give for certain: the bore for any designation, D and B for deep groove series 60/62/63."""
    base = code_base(designation)
    digits = re.sub(r"\D", "", base)
    if len(digits) < 3:
        return []
    bore = bore_diameter(int(digits[-2:]))
    if bore is None:
        return []
    specs = [{"name": "Внутренний диаметр d", "value": str(bore), "unit": "мм", "origin": "standard"}]
    series = digits[:-2]
    if base.isdigit() and series in DEEP_GROOVE and int(digits[-2:]) in DEEP_GROOVE[series]:
        outer, width = DEEP_GROOVE[series][int(digits[-2:])]
        specs.append({"name": "Наружный диаметр D", "value": str(outer), "unit": "мм", "origin": "standard"})
        specs.append({"name": "Ширина B", "value": str(width), "unit": "мм", "origin": "standard"})
    return specs


def _looks_like_amount(text: str, start: int, end: int) -> bool:
    """12 450 000, 2026 года, 1 200.50: numbers that are not designations."""
    before, after = text[max(0, start - 2):start], text[end:end + 5]
    return bool(re.match(r"^[\s  ]\d{3}\b", after) or re.search(r"\d[\s  ]$", before) or re.match(r"^\s*(?:г\.|год|жыл|₸|тг|тенге|руб|%)", after))


def find_bearings(text: str) -> list[tuple[str, int, int]]:
    """Bearing designations in `text` with their place: (designation as written, start, end).

    A bare number (6205) counts only next to a bearing word; one with a prefix or suffix (NU 210, 6205-2RS) always.
    The text is searched with Cyrillic look-alikes made Latin, so "6205-2РС" is found; the designation returned is
    the original characters, so it stays a verbatim quote.
    """
    latin = text.translate(LOOKALIKES)
    found = []
    for match in BEARING.finditer(latin):
        prefix, number, suffix = match.group(1), match.group(2), match.group(3) or ""
        start, end = match.start(), match.end()
        while end > start and text[end - 1] in " -":
            end -= 1
        if _looks_like_amount(latin, start, end):
            continue
        if not prefix and not suffix.strip(" -"):
            if len(number) < 4 or number[0] not in "1234567" or (len(number) == 4 and 1950 <= int(number) <= 2099):
                continue  # 2026 next to "bearing" is a year, not a designation
            window = text[max(0, start - 120):end + 60]  # the original letters: "подшипник" has Cyrillic о, н
            if not BEARING_WORD.search(window):
                continue
        elif not prefix and number[0] not in "1234567":
            continue
        found.append((text[start:end], start, end))
    return found


def quantity_near(text: str, end: int, alone: bool) -> int | None:
    """"6205-2RS — 2 шт": the count written right after a part, or anywhere in its sentence when it is the only part."""
    after = QUANTITY_AFTER.match(text[end:end + 30])
    if after:
        return int(after.group(1))
    if alone:
        counts = QUANTITY.findall(text)
        if len(counts) == 1:
            return int(counts[0])
    return None
