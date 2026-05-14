"""Phase 2.5 — LangGraph Postgres checkpoints + orchestration audit tables.

Revision ID: d1e2f3a4b5c6
Revises: c4d5e6f7a8b9
Create Date: 2026-05-14
"""
from alembic import op

revision = "d1e2f3a4b5c6"
down_revision = "c4d5e6f7a8b9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS agent_lg_checkpoints (
            thread_id TEXT NOT NULL,
            checkpoint_ns TEXT NOT NULL DEFAULT '',
            checkpoint_id TEXT NOT NULL,
            parent_checkpoint_id TEXT,
            type TEXT,
            checkpoint BYTEA NOT NULL,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS agent_lg_writes (
            thread_id TEXT NOT NULL,
            checkpoint_ns TEXT NOT NULL DEFAULT '',
            checkpoint_id TEXT NOT NULL,
            task_id TEXT NOT NULL,
            idx INTEGER NOT NULL,
            channel TEXT NOT NULL,
            type TEXT,
            value BYTEA,
            PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS agent_orchestration_runs (
            id SERIAL PRIMARY KEY,
            trace_id TEXT NOT NULL,
            graph_thread_id TEXT NOT NULL,
            memory_thread_id INT NULL,
            user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            execution_mode VARCHAR(32) NOT NULL,
            graph_profile VARCHAR(128) NOT NULL,
            status VARCHAR(32) NOT NULL,
            error TEXT NULL,
            policies_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_agent_orch_runs_trace ON agent_orchestration_runs (trace_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_agent_orch_runs_gthread ON agent_orchestration_runs (graph_thread_id)"
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS agent_orchestration_steps (
            id SERIAL PRIMARY KEY,
            run_id INT NOT NULL REFERENCES agent_orchestration_runs(id) ON DELETE CASCADE,
            step_index INT NOT NULL,
            step_type VARCHAR(64) NOT NULL,
            tool_name TEXT NULL,
            capability TEXT NULL,
            ok BOOLEAN NOT NULL,
            error TEXT NULL,
            duration_ms INT NULL,
            detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            UNIQUE(run_id, step_index)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS agent_orchestration_steps")
    op.execute("DROP TABLE IF EXISTS agent_orchestration_runs")
    op.execute("DROP TABLE IF EXISTS agent_lg_writes")
    op.execute("DROP TABLE IF EXISTS agent_lg_checkpoints")
