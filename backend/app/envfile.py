"""Loads backend/.env into the process environment, so the key does not have to be exported by hand.

Real environment variables always win over the file. Values are never logged.
"""

import os
from collections.abc import MutableMapping
from pathlib import Path

DEFAULT_PATH = Path(__file__).resolve().parent.parent / ".env"


def parse_env(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, _, value = line.partition("=")
        name = name.strip().removeprefix("export ").strip()
        value = value.strip()
        if value[:1] in "\"'" and value.endswith(value[:1]) and len(value) >= 2:
            value = value[1:-1]
        elif " #" in value:
            value = value.split(" #", 1)[0].rstrip()  # a trailing comment on an unquoted value
        if name:
            values[name] = value
    return values


def load_env_file(path: Path = DEFAULT_PATH, environ: MutableMapping[str, str] | None = None) -> list[str]:
    """Sets the names found in the file that are not already set to a non-empty value. Returns those names."""
    environ = os.environ if environ is None else environ
    try:
        text = path.read_text(encoding="utf-8-sig")
    except OSError:
        return []
    loaded = []
    for name, value in parse_env(text).items():
        if value and not environ.get(name):
            environ[name] = value
            loaded.append(name)
    return loaded
