"""Reads one uploaded file in its own process: python -m app.worker '<json job>'.

A hostile file can use up this process and nothing else. It gets no secrets, because the parent passes a clean
environment and this module never imports app.config.
"""

import json
import sys
from dataclasses import asdict
from pathlib import Path

try:
    import resource
except ImportError:  # Windows, for development only
    resource = None

from app.extraction import ExtractionError, docx_blocks, read_document


def apply_limits(memory_mb: int, seconds: int) -> None:
    """Enforced by the kernel where it can. The parent also watches the process and kills it."""
    if resource is None:
        return
    size = memory_mb * 2 * 1024 * 1024  # address space runs well above resident memory
    for limit, value in ((resource.RLIMIT_AS, size), (resource.RLIMIT_CPU, seconds), (resource.RLIMIT_FSIZE, 512 * 1024 * 1024), (resource.RLIMIT_CORE, 0)):
        try:
            resource.setrlimit(limit, (value, value))
        except (ValueError, OSError):
            pass  # macOS refuses some of these; the parent's watch still applies


def run(job: dict) -> dict:
    path = Path(job["path"])
    try:
        segments, ocr_used = read_document(
            path, job["kind"], job["maxPages"], job["maxOcrPages"], on_ocr=lambda: Path(job["output"] + ".ocr").touch()
        )
        blocks = docx_blocks(path) if job["kind"] == "docx" else None
    except ExtractionError as exc:
        return {"error": {"code": exc.code, "message": exc.message}}
    return {"segments": [asdict(segment) for segment in segments], "ocrUsed": ocr_used, "blocks": blocks}


def main() -> int:
    job = json.loads(sys.argv[1])
    apply_limits(job["memoryMb"], job["seconds"])
    result = run(job)
    temporary = job["output"] + ".tmp"
    with open(temporary, "w", encoding="utf-8") as out:
        json.dump(result, out, ensure_ascii=False)
    Path(temporary).replace(job["output"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
