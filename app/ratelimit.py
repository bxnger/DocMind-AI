import time
from collections import deque

from fastapi import Request

from app.errors import AppError


class RateLimiter:
    """At most `max_calls` in any `per_seconds` window. One user, so no per-client keys."""

    def __init__(self, max_calls: int, per_seconds: float = 60.0) -> None:
        self.max_calls = max_calls
        self.per_seconds = per_seconds
        self.calls: deque[float] = deque()

    def check(self) -> None:
        now = time.monotonic()
        while self.calls and now - self.calls[0] >= self.per_seconds:
            self.calls.popleft()
        if len(self.calls) >= self.max_calls:
            raise AppError(429, "RATE_LIMITED", "Too many requests, try again in a moment", retryable=True)
        self.calls.append(now)


def limit_uploads(request: Request) -> None:
    request.app.state.upload_limiter.check()


def limit_chat(request: Request) -> None:
    request.app.state.chat_limiter.check()
