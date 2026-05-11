"""Wallet authentication tables + user columns

Adds production-grade Web3 wallet auth primitives:
- users: ``active``, ``created_at``, ``last_login`` columns
- ``auth_nonces``: short-lived signing challenges (replay protection)
- ``auth_sessions``: issued JWT registry (revocation + audit)
- case-insensitive uniqueness index on ``users.wallet_address``

The previous business logic (investments, rent, distributions, indexing) is
untouched.

Revision ID: a7b2c1d8e3f4
Revises: 57676a1ae8e9
Create Date: 2026-05-11 12:45:00.000000
"""
from alembic import op


revision = "a7b2c1d8e3f4"
down_revision = "57676a1ae8e9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── users: add auth-related columns ──
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE")
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP"
    )
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP NULL")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wallet_lower ON users (LOWER(wallet_address))"
    )

    # ── auth_nonces ──
    op.execute(
        "CREATE TABLE IF NOT EXISTS auth_nonces ("
        "id SERIAL PRIMARY KEY, "
        "wallet_address VARCHAR(42) NOT NULL, "
        "nonce VARCHAR(128) NOT NULL UNIQUE, "
        "message TEXT NOT NULL, "
        "issued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, "
        "expires_at TIMESTAMP NOT NULL, "
        "used_at TIMESTAMP NULL"
        ")"
    )
    op.execute("ALTER TABLE auth_nonces ADD COLUMN IF NOT EXISTS message TEXT NOT NULL DEFAULT ''")
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_auth_nonces_wallet ON auth_nonces (LOWER(wallet_address))"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_auth_nonces_expires ON auth_nonces (expires_at)"
    )

    # ── auth_sessions ──
    op.execute(
        "CREATE TABLE IF NOT EXISTS auth_sessions ("
        "id SERIAL PRIMARY KEY, "
        "jti VARCHAR(64) NOT NULL UNIQUE, "
        "wallet_address VARCHAR(42) NOT NULL, "
        "role VARCHAR(20) NOT NULL, "
        "issued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, "
        "expires_at TIMESTAMP NOT NULL, "
        "revoked_at TIMESTAMP NULL, "
        "user_agent VARCHAR(255) NULL, "
        "ip_address VARCHAR(64) NULL"
        ")"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_auth_sessions_wallet ON auth_sessions (LOWER(wallet_address))"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions (expires_at)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS auth_sessions")
    op.execute("DROP TABLE IF EXISTS auth_nonces")
    op.execute("DROP INDEX IF EXISTS idx_users_wallet_lower")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS last_login")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS created_at")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS active")
