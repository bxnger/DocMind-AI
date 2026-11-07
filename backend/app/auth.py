"""Guest sessions. The server creates the owner id; nothing the client sends can name another owner."""

import hashlib
from collections.abc import Callable
from dataclasses import dataclass

from fastapi import Depends, Request

from app.deps import get_store
from app.errors import AppError
from app.store import Store


@dataclass(frozen=True)
class Session:
    owner_id: str
    client_key: str
    expires_at: str


def hash_value(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def client_address(request: Request) -> str:
    """The peer address. X-Forwarded-For counts only when the peer is our own proxy, reading from its end."""
    peer = request.client.host if request.client else "unknown"
    trusted = request.app.state.settings.trusted_proxies
    if peer not in trusted:
        return peer
    hops = [hop.strip() for hop in request.headers.get("x-forwarded-for", "").split(",") if hop.strip()]
    for hop in reversed(hops):
        if hop not in trusted:
            return hop
    return peer


def current_session(request: Request, store: Store = Depends(get_store)) -> Session:
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise AppError(401, "UNAUTHORIZED", "A guest session is required", retry_after=None)
    row = store.find_session(hash_value(token.strip()))
    if row is None:
        raise AppError(401, "SESSION_EXPIRED", "This session does not exist or has expired")
    return Session(owner_id=row["owner_id"], client_key=row["client_key"], expires_at=row["expires_at"])


def limited(name: str) -> Callable[..., Session]:
    """The session of a request, counted against that session's own allowance for `name`."""

    def dependency(request: Request, session: Session = Depends(current_session)) -> Session:
        request.app.state.limiters[name].check(session.owner_id)
        return session

    return dependency
