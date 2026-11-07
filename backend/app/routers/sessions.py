import secrets
import time

from fastapi import APIRouter, Depends, Request, Response

from app.auth import Session, client_address, current_session, hash_value, limited
from app.deps import get_store
from app.store import Store

router = APIRouter(prefix="/sessions", tags=["sessions"])

PURGE_EVERY_SECONDS = 600


@router.post("", status_code=201)
def create_session(request: Request, store: Store = Depends(get_store)) -> dict:
    """A new guest. The token is shown only here; the database keeps its hash."""
    address = client_address(request)
    request.app.state.limiters["session"].check(address)
    state = request.app.state
    if time.monotonic() - state.last_purge > PURGE_EVERY_SECONDS:
        state.last_purge = time.monotonic()
        store.purge_expired_sessions()
    settings = state.settings
    token = secrets.token_urlsafe(32)
    expires = store.create_session(
        store.new_owner_id(), hash_value(token), hash_value(address), settings.session_ttl_hours, settings.max_active_sessions
    )
    return {"token": token, "expiresAt": expires}


@router.get("/current")
def session_status(request: Request, store: Store = Depends(get_store), session: Session = Depends(limited("read"))) -> dict:
    settings = request.app.state.settings
    return {
        "expiresAt": session.expires_at,
        "usage": store.session_usage(session.owner_id),
        "limits": {
            "maxDocuments": settings.session_max_documents,
            "maxBytes": settings.session_max_bytes,
            "aiRequestsPerDay": settings.ai_session_daily_limit,
        },
    }


@router.delete("/current", status_code=204, response_class=Response)
def end_session(store: Store = Depends(get_store), session: Session = Depends(current_session)) -> Response:
    """Deletes the session and everything it owns."""
    store.delete_session(session.owner_id)
    return Response(status_code=204)
