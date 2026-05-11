"""Wallet authentication endpoints.

Routes:
- ``POST /auth/nonce``     issue a SIWE-style signing challenge
- ``POST /auth/verify``    verify signed nonce + issue session JWT
- ``POST /auth/register``  register a new wallet → role
- ``GET  /auth/me``        return the authenticated wallet + role
- ``POST /auth/logout``    revoke the current session

All other (business) endpoints remain functionally unchanged. Authorization is
applied at the router layer via the ``backend.api.deps`` helpers.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, Field

from backend.api.deps import get_current_user, get_db
from backend.config.settings import is_admin_wallet
from backend.services.auth import (
    AuthError,
    AuthUser,
    get_user_by_wallet,
    is_valid_eth_address,
    issue_nonce,
    issue_session,
    normalize_address,
    register_user,
    revoke_session,
    touch_last_login,
    verify_signature,
)

LOGGER = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])


# ── request / response shapes ──────────────────────────────────────────────

class NonceRequest(BaseModel):
    wallet_address: str = Field(..., min_length=42, max_length=42)


class NonceResponse(BaseModel):
    nonce: str
    message: str
    expires_at: str


class VerifyRequest(BaseModel):
    wallet_address: str = Field(..., min_length=42, max_length=42)
    signature: str = Field(..., min_length=4)
    nonce: str = Field(..., min_length=8)


class VerifyResponse(BaseModel):
    token: str
    expires_at: str
    user: dict
    is_new_user: bool


class RegisterRequest(BaseModel):
    wallet_address: str = Field(..., min_length=42, max_length=42)
    signature: str = Field(..., min_length=4)
    nonce: str = Field(..., min_length=8)
    role: str
    email: Optional[str] = None


class MeResponse(BaseModel):
    wallet_address: str
    role: str
    email: Optional[str] = None
    kyc_status: str
    active: bool
    is_admin_wallet: bool


# ── helpers ────────────────────────────────────────────────────────────────

def _user_to_public_dict(user: AuthUser) -> dict:
    return {
        "id": user.id,
        "wallet_address": user.wallet_address,
        "role": user.role,
        "email": user.email,
        "kyc_status": user.kyc_status,
        "active": user.active,
    }


def _client_meta(request: Request) -> tuple[str, str]:
    ua = (request.headers.get("user-agent") or "")[:255]
    ip = request.client.host if request.client else ""
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        # Take the leftmost address (original client)
        ip = fwd.split(",")[0].strip() or ip
    return ua, ip[:64]


# ── routes ─────────────────────────────────────────────────────────────────

@router.post("/nonce", response_model=NonceResponse)
def post_nonce(payload: NonceRequest, db=Depends(get_db)):
    if not is_valid_eth_address(payload.wallet_address):
        raise HTTPException(status_code=400, detail="Invalid wallet address")
    try:
        issued = issue_nonce(db, payload.wallet_address)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        LOGGER.exception("issue_nonce failed")
        raise HTTPException(status_code=500, detail="Failed to issue nonce") from exc
    return NonceResponse(
        nonce=issued.nonce,
        message=issued.message,
        expires_at=issued.expires_at.isoformat(),
    )


@router.post("/verify", response_model=VerifyResponse)
def post_verify(payload: VerifyRequest, request: Request, db=Depends(get_db)):
    try:
        recovered = verify_signature(
            db,
            wallet_address=payload.wallet_address,
            signature=payload.signature,
            nonce=payload.nonce,
        )
    except AuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    user = get_user_by_wallet(db, recovered)
    if user is None:
        # Wallet is verified but not yet registered. The caller must hit
        # /auth/register next with the SAME signed payload — we issue a short
        # registration token via a fresh nonce on the next round trip.
        return VerifyResponse(
            token="",
            expires_at="",
            user={"wallet_address": recovered, "registered": False},
            is_new_user=True,
        )
    if not user.active:
        raise HTTPException(status_code=403, detail="Account disabled")

    ua, ip = _client_meta(request)
    try:
        session = issue_session(
            db,
            wallet_address=user.wallet_address,
            role=user.role,
            user_agent=ua,
            ip_address=ip,
        )
        touch_last_login(db, user.wallet_address)
    except AuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return VerifyResponse(
        token=session.token,
        expires_at=session.expires_at.isoformat(),
        user=_user_to_public_dict(user),
        is_new_user=False,
    )


@router.post("/register", response_model=VerifyResponse, status_code=status.HTTP_201_CREATED)
def post_register(payload: RegisterRequest, request: Request, db=Depends(get_db)):
    try:
        recovered = verify_signature(
            db,
            wallet_address=payload.wallet_address,
            signature=payload.signature,
            nonce=payload.nonce,
        )
    except AuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    role = (payload.role or "").strip().lower()
    try:
        user = register_user(db, wallet_address=recovered, role=role, email=payload.email)
    except AuthError as exc:
        # Differentiate 403 (admin gate) vs 409 (already exists) vs 400 (bad input)
        msg = str(exc)
        if "not authorized for the admin role" in msg:
            raise HTTPException(status_code=403, detail=msg) from exc
        if "already registered" in msg:
            raise HTTPException(status_code=409, detail=msg) from exc
        raise HTTPException(status_code=400, detail=msg) from exc

    ua, ip = _client_meta(request)
    session = issue_session(
        db,
        wallet_address=user.wallet_address,
        role=user.role,
        user_agent=ua,
        ip_address=ip,
    )
    return VerifyResponse(
        token=session.token,
        expires_at=session.expires_at.isoformat(),
        user=_user_to_public_dict(user),
        is_new_user=True,
    )


@router.get("/me", response_model=MeResponse)
def get_me(user: AuthUser = Depends(get_current_user)):
    return MeResponse(
        wallet_address=user.wallet_address,
        role=user.role,
        email=user.email,
        kyc_status=user.kyc_status,
        active=user.active,
        is_admin_wallet=is_admin_wallet(user.wallet_address),
    )


@router.post("/logout")
def post_logout(
    db=Depends(get_db),
    authorization: Optional[str] = Header(None),
):
    """Revoke the currently presented session token.

    We never fail logout — if the token is malformed/expired we just no-op so
    the client can clear local state cleanly.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        return {"status": "ok"}
    token = authorization.split(" ", 1)[1].strip()
    try:
        from backend.services.auth import decode_session  # local import to avoid cycle on cold start
        claims = decode_session(token)
        jti = claims.get("jti")
        if jti:
            revoke_session(db, jti)
    except Exception:
        pass
    return {"status": "ok"}


# Exposed convenience: lookup whether a wallet is already registered (used by
# the frontend to skip an unnecessary nonce/signature round trip on first
# visit). Cheap and read-only; no PII leakage beyond presence + role.
@router.get("/lookup/{wallet_address}")
def lookup_wallet(wallet_address: str, db=Depends(get_db)):
    if not is_valid_eth_address(wallet_address):
        raise HTTPException(status_code=400, detail="Invalid wallet address")
    user = get_user_by_wallet(db, normalize_address(wallet_address))
    return {
        "wallet_address": normalize_address(wallet_address),
        "registered": user is not None,
        "role": user.role if user else None,
        "is_admin_wallet": is_admin_wallet(wallet_address),
    }
