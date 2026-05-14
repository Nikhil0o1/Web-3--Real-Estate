"""AI orchestration foundation tables (threads, messages, context KV).

Revision ID: c4d5e6f7a8b9
Revises: b8c3d2e1f5a6
Create Date: 2026-05-14
"""
import sqlalchemy as sa
from alembic import op


revision = "c4d5e6f7a8b9"
down_revision = "b8c3d2e1f5a6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_orchestration_threads",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("wallet_address", sa.String(length=42), nullable=False),
        sa.Column("platform_role", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=True),
        sa.Column("metadata", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
    )
    op.create_index("idx_agent_threads_user", "agent_orchestration_threads", ["user_id"])
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_agent_threads_wallet "
        "ON agent_orchestration_threads (LOWER(wallet_address))"
    )

    op.create_table(
        "agent_orchestration_messages",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "thread_id",
            sa.Integer(),
            sa.ForeignKey("agent_orchestration_threads.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("author", sa.String(length=32), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("event_payload", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("seq", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
    )
    op.create_index(
        "idx_agent_messages_thread_seq",
        "agent_orchestration_messages",
        ["thread_id", "seq"],
    )

    op.create_table(
        "agent_context_kv",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("namespace", sa.String(length=64), nullable=False, server_default="default"),
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("user_id", "namespace", "key"),
    )


def downgrade() -> None:
    op.drop_table("agent_context_kv")
    op.drop_table("agent_orchestration_messages")
    op.drop_table("agent_orchestration_threads")
