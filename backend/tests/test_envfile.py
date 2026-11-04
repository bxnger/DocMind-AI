"""backend/.env is read without extra dependencies, never overrides real variables, and never leaks values."""

from app.envfile import load_env_file, parse_env


def test_parse_handles_comments_quotes_export_and_blank_values():
    text = "\n".join(
        [
            "# comment",
            'GEMINI_API_KEY="abc 123"',
            "export LLM_PROVIDER=gemini   # trailing comment",
            "GEMINI_MODEL='gemini-3.5-flash'",
            "EMPTY=",
            "not a pair",
        ]
    )
    assert parse_env(text) == {
        "GEMINI_API_KEY": "abc 123",
        "LLM_PROVIDER": "gemini",
        "GEMINI_MODEL": "gemini-3.5-flash",
        "EMPTY": "",
    }


def test_file_fills_only_missing_or_empty_variables(tmp_path):
    path = tmp_path / ".env"
    path.write_text("A=from_file\nB=from_file\nC=from_file\nD=\n", encoding="utf-8")
    environ = {"A": "real", "C": ""}
    loaded = load_env_file(path, environ)
    assert environ == {"A": "real", "B": "from_file", "C": "from_file"}
    assert sorted(loaded) == ["B", "C"]  # names only: values are never returned or logged


def test_missing_file_is_fine_and_bom_is_tolerated(tmp_path):
    assert load_env_file(tmp_path / "nope.env", {}) == []
    path = tmp_path / ".env"
    path.write_bytes(b"\xef\xbb\xbfKEY=value\n")
    environ: dict[str, str] = {}
    load_env_file(path, environ)
    assert environ == {"KEY": "value"}
