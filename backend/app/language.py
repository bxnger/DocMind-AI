KAZAKH_LETTERS = set("әіңғүұқөһӘІҢҒҮҰҚӨҺ")
MIN_LETTERS = 20
DOMINANT_SHARE = 0.8
KAZAKH_SHARE = 0.01


def detect_language(text: str) -> str | None:
    """Rough script-based guess: "kk", "ru", "en", "mixed", or None when there is too little text."""
    cyrillic = latin = kazakh = 0
    for char in text:
        if "а" <= char.lower() <= "я" or char in "ёЁ" or char in KAZAKH_LETTERS:
            cyrillic += 1
            if char in KAZAKH_LETTERS:
                kazakh += 1
        elif "a" <= char.lower() <= "z":
            latin += 1
    total = cyrillic + latin
    if total < MIN_LETTERS:
        return None
    if latin / total >= DOMINANT_SHARE:
        return "en"
    if cyrillic / total >= DOMINANT_SHARE:
        return "kk" if kazakh / cyrillic >= KAZAKH_SHARE else "ru"
    return "mixed"
