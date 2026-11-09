"""Barcodes and QR codes: decoded by code (zxing-cpp), checked by code. No model is asked, nothing is guessed.

- EAN-13, EAN-8, UPC-A: the check digit is verified. A number is only a number: it is looked up in the sources we have
  (a "Штрихкод" column of the user's price lists; the shops publish no barcodes), never turned into a part number.
- QR: a link (opened only when it points at a shop on the list), a GTIN, a part number, or plain text.

The photo is never stored: it lives in memory for the one request.
"""

import io
import re
from urllib.parse import urlsplit

from app.codes import SUFFIX, clean_code, code_base
from app.errors import AppError

MAX_TEXT = 500
LINEAR_FORMATS = {"EAN13": "EAN13", "EAN8": "EAN8", "UPCA": "UPCA"}


def barcode_reader_installed() -> bool:
    try:
        import zxingcpp  # noqa: F401
        from PIL import Image  # noqa: F401
    except ImportError:
        return False
    return True


def gtin_valid(digits: str) -> bool:
    """GS1 check digit (mod 10, weights 3 and 1 from the right) for GTIN-8/12/13/14."""
    if not re.fullmatch(r"\d{8}|\d{12,14}", digits):
        return False
    body, check = digits[:-1], int(digits[-1])
    total = sum(int(d) * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(body)))
    return (10 - total % 10) % 10 == check


def gtin_key(digits: str) -> str:
    """One form for comparing: GTIN-14 with leading zeros (UPC-A 036000291452 == EAN-13 0036000291452)."""
    return digits.zfill(14)


def decode_image(data: bytes) -> list[dict]:
    """[{format, value}] of every EAN-13 / EAN-8 / UPC-A / QR code on the photo."""
    try:
        import zxingcpp
        from PIL import Image, UnidentifiedImageError
    except ImportError as exc:
        raise AppError(503, "BARCODES_UNAVAILABLE", "Barcode reading is not installed on this server") from exc
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise AppError(415, "UNSUPPORTED_IMAGE", "Send a JPEG, PNG or WebP photo") from exc
    if image.width * image.height > 40_000_000:
        raise AppError(413, "IMAGE_TOO_LARGE", "The photo has too many pixels")
    wanted = zxingcpp.BarcodeFormat.EAN13 | zxingcpp.BarcodeFormat.EAN8 | zxingcpp.BarcodeFormat.UPCA | zxingcpp.BarcodeFormat.QRCode
    found = []
    for barcode in zxingcpp.read_barcodes(image.convert("L"), formats=wanted):
        name = getattr(barcode.format, "name", str(barcode.format)).replace("-", "").replace(" ", "").upper()
        value = barcode.text
        if name == "QRCODE":
            name = "QR"
        elif name == "EAN13" and value.startswith("0") and len(value) == 13:
            name, value = "UPCA", value[1:]  # the reader reports UPC-A as EAN-13 with a leading zero
        found.append({"format": name, "value": value[:MAX_TEXT]})
    return found


def classify(value: str, format: str) -> dict:
    """What a decoded (or typed) value is: kind gtin | url | partNumber | text, and whether a GTIN's check digit holds."""
    text = value.strip()[:MAX_TEXT]
    code = {"format": format, "value": text, "valid": None, "kind": "text"}
    if format in LINEAR_FORMATS or re.fullmatch(r"\d{8}|\d{12,14}", text):
        code.update(kind="gtin", valid=gtin_valid(text))
        return code
    if re.match(r"https?://", text, re.IGNORECASE):
        parts = urlsplit(text)
        code.update(kind="url", valid=bool(parts.hostname))
        return code
    if is_part_number(text):
        code.update(kind="partNumber", valid=True, value=clean_code(text))
    return code


def is_part_number(text: str) -> bool:
    """"6205-2RS", "NU 210 ECP": short, has a designation with digits, no sentence around it."""
    return len(text) <= 40 and len(text.split()) <= 4 and bool(code_base(text)) and bool(re.search(r"\d{3}", text))


def find_part_number(text: str) -> str | None:
    """The first part number in a free text ("подшипник 6205-2RS SKF" -> "6205-2RS", "NU 210 ECP" -> "NU 210 ECP"),
    so a search by name with a part number in it is a search by that part number."""
    words = [word.strip(",;:()[]«»\"'") for word in text.split()]
    for index, word in enumerate(words):
        if not (re.search(r"\d{3}", word) and code_base(word) and len(word) <= 30):
            continue
        parts = [word]
        if index and re.fullmatch(r"[A-Z]{1,4}", words[index - 1]):
            parts.insert(0, words[index - 1])
        for following in words[index + 1:index + 3]:
            if re.fullmatch(SUFFIX, following):
                parts.append(following)
            else:
                break
        return clean_code(" ".join(parts))
    return None
