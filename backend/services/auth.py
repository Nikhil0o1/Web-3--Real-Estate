"""Web3 wallet authentication service.

Production-grade Sign-In-With-Ethereum (SIWE-flavoured) flow:

1. Client requests a nonce for a wallet address.
2. We persist the nonce with a short TTL (replay-protected).
3. Client asks MetaMask to ``personal_sign`` a deterministic message that
   embeds the nonce, the domain, the chain id, and an issued-at timestamp.
4. Client posts ``(wallet_address, signature, nonce)`` back to ``/auth/verify``.
5. We recover the signer from the signature using ``eth_account`` and compare
   it (case-insensitively) against the claimed wallet address. We also mark
   the nonce as ``used`` so the same signature cannot be replayed.
6. We resolve / create the user row, stamp ``last_login``, and issue a JWT
   bound to ``(wallet_address, role, jti)``. ``jti`` is tracked in
   ``auth_sessions`` so we can revoke individual tokens.

This module is intentionally side-effect free aside from DB writes; the FastAPI
router layer (`backend/api/routers/auth.py`) owns request/response shapes.
"""
from __future__ import annotations

import hashlib
import logging
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from eth_account import Account
from eth_account.messages import encode_defunct

from backend.config.settings import (
    AUTH_JWT_ALGORITHM,
    AUTH_JWT_ISSUER,
    AUTH_JWT_SECRET,
    AUTH_NONCE_TTL_SECONDS,
    AUTH_SESSION_TTL_HOURS,
    CHAIN_ID,
    DEPLOY_ENV,
)

LOGGER = logging.getLogger(__name__)

VALID_ROLES = {"property_owner", "investor", "tenant"}


def canonical_role(role: str | None) -> str:
    """Map legacy DB/JWT values to the current role model.

    Rows created before the ``property_owner`` rename may still store ``admin``.
    """
    if role is None:
        return ""
    r = str(role).strip().lower()
    if r == "admin":
        return "property_owner"
    return r


# ──────────────────────────────────────────────────────────────────────────────
# JWT secret resolution
# ──────────────────────────────────────────────────────────────────────────────

def _resolve_jwt_secret() -> str:
    """Return a JWT signing secret.

    In production ``AUTH_JWT_SECRET`` (or ``JWT_SECRET`` in ``.env``) MUST be
    configured (validated in ``settings.validate_required_settings()``).
    fallback so the API boots without manual setup, but the secret is
    process-local (NOT shareable across machines).
    """
    if AUTH_JWT_SECRET:
        return AUTH_JWT_SECRET
    if DEPLOY_ENV == "production":
        raise RuntimeError("AUTH_JWT_SECRET or JWT_SECRET is required in production")
    LOGGER.warning(
        "AUTH_JWT_SECRET is empty — using ephemeral dev fallback. "
        "Set AUTH_JWT_SECRET in .env for stable sessions across restarts."
    )
    # Deterministic per-process secret so we don't crash, but rotate per boot.
    return hashlib.sha256(f"dev-fallback-{uuid.uuid4()}".encode()).hexdigest()


_JWT_SECRET = _resolve_jwt_secret()


# ──────────────────────────────────────────────────────────────────────────────
# Address helpers
# ──────────────────────────────────────────────────────────────────────────────

def normalize_address(addr: str) -> str:
    return (addr or "").strip().lower()


def is_valid_eth_address(addr: str) -> bool:
    a = (addr or "").strip()
    if not a.startswith("0x") or len(a) != 42:
        return False
    try:
        int(a, 16)
        return True
    except ValueError:
        return False


# ──────────────────────────────────────────────────────────────────────────────
# Nonce / message helpers
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class IssuedNonce:
    nonce: str
    message: str
    expires_at: datetime


def build_signing_message(
    *,
    wallet_address: str,
    nonce: str,
    domain: str,
    issued_at: datetime,
) -> str:
    """Build the deterministic message the wallet will sign.

    Resembles the SIWE format but kept minimal so MetaMask renders it cleanly
    (every line shows in the signing dialog). The wallet address is included
    in the body so the signature is bound to a specific account.
    """
    issued_iso = issued_at.replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return (
        f"{domain} wants you to sign in with your Ethereum account:\n"
        f"{wallet_address}\n\n"
        f"Sign this message to authenticate with EstateChain. "
        f"This request will not trigger a blockchain transaction or cost any gas.\n\n"
        f"URI: https://{domain}\n"
        f"Chain ID: {CHAIN_ID}\n"
        f"Nonce: {nonce}\n"
        f"Issued At: {issued_iso}"
    )


def generate_nonce() -> str:
    """Generate a high-entropy URL-safe nonce."""
    return secrets.token_urlsafe(32)


def issue_nonce(db, wallet_address: str, *, domain: str = "estatechain.local") -> IssuedNonce:
    """Persist a fresh nonce for ``wallet_address`` and return the SIWE message.

    Old expired / used nonces for the same wallet are opportunistically purged
    to keep the table small.
    """
    if not is_valid_eth_address(wallet_address):
        raise ValueError("Invalid wallet address")

    wallet_lc = normalize_address(wallet_address)
    nonce = generate_nonce()
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(seconds=AUTH_NONCE_TTL_SECONDS)
    message = build_signing_message(
        wallet_address=wallet_lc,
        nonce=nonce,
        domain=domain,
        issued_at=now,
    )

    cursor = db.cursor()
    try:
        cursor.execute(
            "DELETE FROM auth_nonces WHERE LOWER(wallet_address) = %s "
            "AND (expires_at < NOW() OR used_at IS NOT NULL)",
            (wallet_lc,),
        )
        cursor.execute(
            "INSERT INTO auth_nonces (wallet_address, nonce, message, issued_at, expires_at) "
            "VALUES (%s, %s, %s, %s, %s)",
            (wallet_lc, nonce, message, now, expires_at),
        )
        db.commit()
    finally:
        cursor.close()

    return IssuedNonce(nonce=nonce, message=message, expires_at=expires_at)


# ──────────────────────────────────────────────────────────────────────────────
# Signature verification
# ──────────────────────────────────────────────────────────────────────────────

class AuthError(Exception):
    """Generic authentication failure."""


def _consume_nonce(db, wallet_address: str, nonce: str) -> dict:
    """Look up a pending nonce for the given wallet and atomically mark it used.

    Returns the stored signing message verbatim so the verifier can recover
    the signer without re-formatting timestamps (avoiding ISO/timezone drift).
    """
    wallet_lc = normalize_address(wallet_address)
    cursor = db.cursor()
    try:
        cursor.execute(
            "SELECT id, message, expires_at, used_at "
            "FROM auth_nonces "
            "WHERE LOWER(wallet_address) = %s AND nonce = %s "
            "FOR UPDATE",
            (wallet_lc, nonce),
        )
        row = cursor.fetchone()
        if not row:
            raise AuthError("Unknown or expired nonce")
        nonce_id, message, expires_at, used_at = row[0], row[1], row[2], row[3]
        if used_at is not None:
            raise AuthError("Nonce already used")
        # psycopg2 returns naive datetimes for TIMESTAMP (no tz). We treat them as UTC.
        expires_naive = expires_at if expires_at.tzinfo is None else expires_at.astimezone(timezone.utc).replace(tzinfo=None)
        if expires_naive < datetime.utcnow():
            raise AuthError("Nonce expired")
        cursor.execute(
            "UPDATE auth_nonces SET used_at = CURRENT_TIMESTAMP WHERE id = %s",
            (nonce_id,),
        )
        db.commit()
        return {"nonce_id": nonce_id, "message": message}
    except AuthError:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        cursor.close()


def recover_signer(message: str, signature: str) -> str:
    """Recover the signer address from an EIP-191 ``personal_sign`` signature."""
    encoded = encode_defunct(text=message)
    try:
        return Account.recover_message(encoded, signature=signature)
    except Exception as exc:
        raise AuthError(f"Signature recovery failed: {exc}") from exc


def verify_signature(
    db,
    *,
    wallet_address: str,
    signature: str,
    nonce: str,
) -> str:
    """Verify ``signature`` covers the persisted nonce-bearing message.

    Returns the recovered (lowercased) wallet address on success.
    Raises ``AuthError`` on any failure.
    """
    if not is_valid_eth_address(wallet_address):
        raise AuthError("Invalid wallet address")
    if not signature or not nonce:
        raise AuthError("Missing signature or nonce")

    record = _consume_nonce(db, wallet_address, nonce)
    message = record["message"]
    if not message:
        # Legacy nonce row without a stored message — refuse rather than guess.
        raise AuthError("Nonce no longer valid; please request a fresh one")

    recovered = recover_signer(message, signature)
    if normalize_address(recovered) != normalize_address(wallet_address):
        raise AuthError("Signature does not match wallet address")
    return normalize_address(recovered)


# ──────────────────────────────────────────────────────────────────────────────
# User / role resolution
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class AuthUser:
    id: int
    wallet_address: str
    role: str
    email: Optional[str]
    kyc_status: str
    active: bool


def get_user_by_wallet(db, wallet_address: str) -> Optional[AuthUser]:
    wallet_lc = normalize_address(wallet_address)
    cursor = db.cursor()
    try:
        cursor.execute(
            "SELECT id, wallet_address, role, email, kyc_status, active "
            "FROM users WHERE LOWER(wallet_address) = %s",
            (wallet_lc,),
        )
        row = cursor.fetchone()
        if not row:
            return None
        user_id = int(row[0])
        wallet_addr = row[1]
        raw_role = row[2]
        # Persist role rename once so DB matches the new model (avoids 400 on /auth/verify).
        if isinstance(raw_role, str) and raw_role.strip().lower() == "admin":
            cursor.execute(
                "UPDATE users SET role = %s WHERE id = %s",
                ("property_owner", user_id),
            )
            db.commit()
            raw_role = "property_owner"
        return AuthUser(
            id=user_id,
            wallet_address=wallet_addr,
            role=canonical_role(raw_role),
            email=row[3],
            kyc_status=row[4],
            active=bool(row[5]),
        )
    finally:
        cursor.close()


def register_user(db, *, wallet_address: str, role: str, email: Optional[str] = None) -> AuthUser:
    """Create a new ``users`` row for ``wallet_address`` with ``role``.

    Any verified MetaMask wallet can self-register as property_owner, investor,
    or tenant. Role selection happens once during signup and is permanently
    bound to the wallet address.
    """
    if role not in VALID_ROLES:
        raise AuthError(f"Invalid role: {role}. Must be one of: {', '.join(sorted(VALID_ROLES))}")
    if not is_valid_eth_address(wallet_address):
        raise AuthError("Invalid wallet address")

    existing = get_user_by_wallet(db, wallet_address)
    if existing:
        raise AuthError("Wallet already registered")

    wallet_lc = normalize_address(wallet_address)
    cursor = db.cursor()
    try:
        cursor.execute(
            "INSERT INTO users (wallet_address, role, email, active, created_at, last_login) "
            "VALUES (%s, %s, %s, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) "
            "RETURNING id, wallet_address, role, email, kyc_status, active",
            (wallet_lc, role, email),
        )
        row = cursor.fetchone()
        db.commit()
        return AuthUser(
            id=int(row[0]),
            wallet_address=row[1],
            role=canonical_role(row[2]),
            email=row[3],
            kyc_status=row[4],
            active=bool(row[5]),
        )
    except Exception:
        db.rollback()
        raise
    finally:
        cursor.close()


def touch_last_login(db, wallet_address: str) -> None:
    wallet_lc = normalize_address(wallet_address)
    cursor = db.cursor()
    try:
        cursor.execute(
            "UPDATE users SET last_login = CURRENT_TIMESTAMP "
            "WHERE LOWER(wallet_address) = %s",
            (wallet_lc,),
        )
        db.commit()
    finally:
        cursor.close()


# ──────────────────────────────────────────────────────────────────────────────
# JWT session tokens
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class IssuedSession:
    token: str
    jti: str
    role: str
    wallet_address: str
    expires_at: datetime


def issue_session(
    db,
    *,
    wallet_address: str,
    role: str,
    user_agent: Optional[str] = None,
    ip_address: Optional[str] = None,
) -> IssuedSession:
    role = canonical_role(role)
    if role not in VALID_ROLES:
        raise AuthError(f"Invalid role: {role}")

    wallet_lc = normalize_address(wallet_address)
    jti = uuid.uuid4().hex
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(hours=AUTH_SESSION_TTL_HOURS)

    payload = {
        "iss": AUTH_JWT_ISSUER,
        "sub": wallet_lc,
        "role": role,
        "jti": jti,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    token = jwt.encode(payload, _JWT_SECRET, algorithm=AUTH_JWT_ALGORITHM)

    cursor = db.cursor()
    try:
        cursor.execute(
            "INSERT INTO auth_sessions (jti, wallet_address, role, issued_at, expires_at, user_agent, ip_address) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (jti, wallet_lc, role, now, expires_at, (user_agent or "")[:255], (ip_address or "")[:64]),
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        cursor.close()

    return IssuedSession(
        token=token,
        jti=jti,
        role=role,
        wallet_address=wallet_lc,
        expires_at=expires_at,
    )


def decode_session(token: str) -> dict:
    try:
        return jwt.decode(
            token,
            _JWT_SECRET,
            algorithms=[AUTH_JWT_ALGORITHM],
            issuer=AUTH_JWT_ISSUER,
            options={"require": ["exp", "iat", "sub", "role", "jti"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise AuthError("Session expired") from exc
    except jwt.InvalidTokenError as exc:
        raise AuthError(f"Invalid session token: {exc}") from exc


def session_is_active(db, jti: str) -> bool:
    cursor = db.cursor()
    try:
        cursor.execute(
            "SELECT revoked_at, expires_at FROM auth_sessions WHERE jti = %s",
            (jti,),
        )
        row = cursor.fetchone()
        if not row:
            return False
        revoked_at, expires_at = row[0], row[1]
        if revoked_at is not None:
            return False
        # psycopg2 returns naive datetimes for TIMESTAMP; compare in naive UTC.
        expires_naive = expires_at if expires_at.tzinfo is None else expires_at.astimezone(timezone.utc).replace(tzinfo=None)
        if expires_naive < datetime.utcnow():
            return False
        return True
    finally:
        cursor.close()


def revoke_session(db, jti: str) -> None:
    cursor = db.cursor()
    try:
        cursor.execute(
            "UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP "
            "WHERE jti = %s AND revoked_at IS NULL",
            (jti,),
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        cursor.close()


def revoke_all_sessions_for_wallet(db, wallet_address: str) -> int:
    wallet_lc = normalize_address(wallet_address)
    cursor = db.cursor()
    try:
        cursor.execute(
            "UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP "
            "WHERE LOWER(wallet_address) = %s AND revoked_at IS NULL",
            (wallet_lc,),
        )
        count = cursor.rowcount
        db.commit()
        return count
    except Exception:
        db.rollback()
        raise
    finally:
        cursor.close()


def resolve_authenticated_user(db, token: str) -> AuthUser:
    """Decode + validate a session token and return the live ``AuthUser`` row."""
    claims = decode_session(token)
    jti = claims.get("jti")
    wallet_lc = normalize_address(claims.get("sub", ""))
    if not jti or not wallet_lc:
        raise AuthError("Malformed session token")
    if not session_is_active(db, jti):
        raise AuthError("Session revoked or expired")

    user = get_user_by_wallet(db, wallet_lc)
    if user is None:
        raise AuthError("User no longer exists")
    if not user.active:
        raise AuthError("User account is disabled")

    # If the role on the JWT no longer matches the DB, the JWT is stale — force re-auth.
    # Compare canonical roles so legacy JWTs with ``admin`` still match ``property_owner`` in DB.
    if canonical_role(user.role) != canonical_role(claims.get("role")):
        raise AuthError("Role changed; please sign in again")
    return user
