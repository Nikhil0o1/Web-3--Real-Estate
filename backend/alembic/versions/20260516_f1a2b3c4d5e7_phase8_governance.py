"""Phase 8 — institutional governance: settings, metrics, unified events.

Revision ID: f1a2b3c4d5e7
Revises: e7f8a9b0c1d2
"""
from alembic import op

revision = "f1a2b3c4d5e7"
down_revision = "e7f8a9b0c1d2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS governance_settings (
            setting_key VARCHAR(128) PRIMARY KEY,
            value_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_by_user_id INT NULL REFERENCES users(id) ON DELETE SET NULL
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS governance_metric_samples (
            id BIGSERIAL PRIMARY KEY,
            metric_key VARCHAR(160) NOT NULL,
            dimensions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            value_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_gov_metrics_key_time ON governance_metric_samples (metric_key, recorded_at DESC)"
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS governance_events (
            id BIGSERIAL PRIMARY KEY,
            event_type VARCHAR(96) NOT NULL,
            severity VARCHAR(24) NOT NULL DEFAULT 'info',
            user_id INT NULL REFERENCES users(id) ON DELETE SET NULL,
            actor_user_id INT NULL REFERENCES users(id) ON DELETE SET NULL,
            trace_id TEXT NULL,
            source VARCHAR(64) NOT NULL DEFAULT 'platform',
            payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_gov_events_created ON governance_events (created_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_gov_events_type ON governance_events (event_type, created_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS governance_events")
    op.execute("DROP TABLE IF EXISTS governance_metric_samples")
    op.execute("DROP TABLE IF EXISTS governance_settings")
