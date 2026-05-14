"""Phase 7 — autonomous monitoring agents, watchlists, intelligence events.

Revision ID: e7f8a9b0c1d2
Revises: d1e2f3a4b5c6
Create Date: 2026-05-15
"""
from alembic import op

revision = "e7f8a9b0c1d2"
down_revision = "d1e2f3a4b5c6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ai_watchlists (
            id SERIAL PRIMARY KEY,
            user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            platform_role VARCHAR(32) NOT NULL,
            name VARCHAR(160) NOT NULL,
            rules_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_ai_watchlists_user ON ai_watchlists (user_id, active)"
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ai_intelligence_events (
            id SERIAL PRIMARY KEY,
            user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            platform_role VARCHAR(32) NOT NULL,
            agent VARCHAR(96) NOT NULL,
            severity VARCHAR(24) NOT NULL DEFAULT 'info',
            category VARCHAR(64) NOT NULL,
            title VARCHAR(255) NOT NULL,
            body TEXT NOT NULL DEFAULT '',
            metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            draft_payload_json JSONB NULL,
            dedupe_key VARCHAR(200) NOT NULL,
            read_at TIMESTAMP NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (user_id, dedupe_key)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_ai_intel_user_created ON ai_intelligence_events (user_id, created_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_ai_intel_user_unread ON ai_intelligence_events (user_id) WHERE read_at IS NULL"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS ai_intelligence_events")
    op.execute("DROP TABLE IF EXISTS ai_watchlists")
