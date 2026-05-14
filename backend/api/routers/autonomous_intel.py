"""Phase 7 autonomous intelligence HTTP surface (watchlists + events)."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from starlette.responses import Response

from backend.agents.autonomous import store as ast_store
from backend.api.deps import get_current_user, get_db
from backend.services.auth import AuthUser, canonical_role

router = APIRouter(prefix="/autonomous", tags=["autonomous-agents"])


class WatchlistCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=160)
    rules: dict[str, Any] = Field(default_factory=dict)


class WatchlistRead(BaseModel):
    id: int
    platform_role: str
    name: str
    rules: dict[str, Any]
    active: bool
    created_at: str | None = None
    updated_at: str | None = None


class IntelEventRead(BaseModel):
    id: int
    agent: str
    severity: str
    category: str
    title: str
    body: str
    metadata: dict[str, Any]
    draft_payload: dict[str, Any] | None = None
    read_at: str | None = None
    created_at: str | None = None
    unread: bool = True


@router.get("/events", response_model=list[IntelEventRead])
def list_intel_events(user: AuthUser = Depends(get_current_user), db=Depends(get_db), limit: int = 40):
    cur = db.cursor(dictionary=True)
    try:
        return ast_store.list_intelligence_events(cur, user_id=int(user.id), limit=min(limit, 100))
    finally:
        cur.close()


@router.get("/events/unread-count")
def unread_intel_count(user: AuthUser = Depends(get_current_user), db=Depends(get_db)):
    cur = db.cursor(dictionary=True)
    try:
        return {"count": ast_store.count_unread(cur, user_id=int(user.id))}
    finally:
        cur.close()


@router.post("/events/{event_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_intel_read(event_id: int, user: AuthUser = Depends(get_current_user), db=Depends(get_db)):
    cur = db.cursor()
    try:
        ok = ast_store.mark_event_read(cur, user_id=int(user.id), event_id=event_id)
        if not ok:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        cur.close()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/watchlists", response_model=list[WatchlistRead])
def list_watchlists(user: AuthUser = Depends(get_current_user), db=Depends(get_db)):
    cur = db.cursor(dictionary=True)
    try:
        return ast_store.list_watchlists(cur, user_id=int(user.id))
    finally:
        cur.close()


@router.post("/watchlists", response_model=dict[str, Any], status_code=status.HTTP_201_CREATED)
def create_watchlist(body: WatchlistCreate, user: AuthUser = Depends(get_current_user), db=Depends(get_db)):
    cur = db.cursor()
    try:
        wid = ast_store.create_watchlist(
            cur,
            user_id=int(user.id),
            platform_role=canonical_role(user.role),
            name=body.name,
            rules=body.rules,
        )
        db.commit()
        return {"id": wid}
    except Exception:
        db.rollback()
        raise
    finally:
        cur.close()


@router.delete("/watchlists/{watchlist_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_watchlist(watchlist_id: int, user: AuthUser = Depends(get_current_user), db=Depends(get_db)):
    cur = db.cursor()
    try:
        ok = ast_store.delete_watchlist(cur, user_id=int(user.id), watchlist_id=watchlist_id)
        if not ok:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Watchlist not found")
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    finally:
        cur.close()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
