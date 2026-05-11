"""FastAPI dependency providers.

Includes:
- ``get_db`` — request-scoped PostgreSQL connection (existing behaviour).
- ``get_current_user`` — resolves the authenticated wallet identity from
  the ``Authorization: Bearer <jwt>`` header.
- ``require_role(...)`` — factory producing a dependency that enforces a
  specific platform role (property_owner / investor / tenant).
- ``require_property_owner`` — convenience shortcut for property-owner-only endpoints.

These dependencies never touch the existing business logic of routers; they
only gate access. Endpoints that should remain public (health, config,
property catalog browsing) simply omit the dependency.
"""
from __future__ import annotations

from typing import Optional

from fastapi import Depends, Header, HTTPException, status

from backend.db.connection import get_connection
from backend.services.auth import (
    AuthError,
    AuthUser,
    resolve_authenticated_user,
)


def get_db():
    db = get_connection()
    try:
        yield db
    finally:
        db.close()


def _extract_bearer(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    parts = authorization.strip().split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1].strip()
    return token or None


def get_current_user(
    authorization: Optional[str] = Header(None),
    db=Depends(get_db),
) -> AuthUser:
    """Strict auth — raises 401 on missing/invalid token."""
    token = _extract_bearer(authorization)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or malformed Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        return resolve_authenticated_user(db, token)
    except AuthError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


def get_optional_user(
    authorization: Optional[str] = Header(None),
    db=Depends(get_db),
) -> Optional[AuthUser]:
    """Best-effort auth — returns ``None`` when no/invalid token (no 401)."""
    token = _extract_bearer(authorization)
    if not token:
        return None
    try:
        return resolve_authenticated_user(db, token)
    except AuthError:
        return None


def require_role(*allowed_roles: str):
    """Build a dependency that enforces one of ``allowed_roles``."""
    allowed = {r.lower() for r in allowed_roles}

    def _dep(user: AuthUser = Depends(get_current_user)) -> AuthUser:
        if user.role.lower() not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires one of roles: {sorted(allowed)}",
            )
        return user

    return _dep


require_property_owner = require_role("property_owner")
require_investor = require_role("investor")
require_tenant = require_role("tenant")
