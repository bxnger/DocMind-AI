import time
from collections import deque

from app.errors import AppError

MAX_TRACKED_KEYS = 20_000


class RateLimiter:
    """At most `max_calls` per key in any `per_seconds` window, so one client cannot use up another's allowance."""

    def __init__(self, max_calls: int, per_seconds: float = 60.0) -> None:
        self.max_calls = max_calls
        self.per_seconds = per_seconds
        self.calls: dict[str, deque[float]] = {}

    def check(self, key: str) -> None:
        now = time.monotonic()
        if len(self.calls) > MAX_TRACKED_KEYS:
            self.calls = {k: v for k, v in self.calls.items() if v and now - v[-1] < self.per_seconds}
        calls = self.calls.setdefault(key, deque())
        while calls and now - calls[0] >= self.per_seconds:
            calls.popleft()
        if len(calls) >= self.max_calls:
            wait = int(self.per_seconds - (now - calls[0])) + 1
            raise AppError(429, "RATE_LIMITED", "Too many requests, try again in a moment", retryable=True, retry_after=wait)
        calls.append(now)
