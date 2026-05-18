import logging

from psycopg2 import connect, sql

from backend.db.connection import get_connection
from backend.config.settings import get_admin_database_url, get_database_name

LOGGER = logging.getLogger(__name__)


def _ensure_column(cursor, table_name: str, column_name: str, definition: str) -> None:
    cursor.execute(f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS {column_name} {definition}")


def _try_ensure_unique_index(cursor, index_sql: str, description: str) -> None:
    """Attempt to create a unique index; if it fails (e.g. pre-existing duplicate rows),
    log a warning and continue — the outer transaction is preserved via SAVEPOINT.

    Duplicate cleanup must be performed separately (see scripts/dedupe_investor_rent_payouts.sql).
    """
    savepoint = "sp_unique_index"
    cursor.execute(f"SAVEPOINT {savepoint}")
    try:
        cursor.execute(index_sql)
        cursor.execute(f"RELEASE SAVEPOINT {savepoint}")
    except Exception as exc:
        cursor.execute(f"ROLLBACK TO SAVEPOINT {savepoint}")
        cursor.execute(f"RELEASE SAVEPOINT {savepoint}")
        LOGGER.warning(
            "Skipping unique index creation (%s): %s. "
            "Run the dedupe script and retry on next startup.",
            description, exc,
        )


def _ensure_database_exists() -> None:
    database_name = get_database_name()
    admin_conn = connect(get_admin_database_url())
    admin_conn.autocommit = True
    admin_cursor = admin_conn.cursor()
    try:
        admin_cursor.execute("SELECT 1 FROM pg_database WHERE datname = %s", (database_name,))
        if admin_cursor.fetchone() is None:
            admin_cursor.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database_name)))
    finally:
        admin_cursor.close()
        admin_conn.close()


def _ensure_indexes(cursor) -> None:
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_tenant_wallet ON tenants (wallet_address)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_tr_tenant ON tenant_rentals (tenant_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_tr_property ON tenant_rentals (property_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_rp_tenant ON rent_payments (tenant_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_rp_property ON rent_payments (property_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_rp_date ON rent_payments (payment_date)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_rd_property ON rent_distributions (property_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_irp_investor ON investor_rent_payouts (investor_wallet)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_irp_property ON investor_rent_payouts (property_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_irp_dist ON investor_rent_payouts (distribution_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_irp_claim_status ON investor_rent_payouts (claim_status)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_irp_claim_tx_hash ON investor_rent_payouts (claim_tx_hash)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_properties_active ON properties (is_active)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_properties_owner_wallet ON properties (LOWER(owner_wallet))")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_rp_cycle ON rent_payments (tenant_id, property_id, rent_year, rent_month)")
    cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_investments_deposit_tx_hash ON investments (deposit_tx_hash) WHERE deposit_tx_hash IS NOT NULL")
    cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_rent_distributions_tx_hash ON rent_distributions (distribution_tx_hash)")
    cursor.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_rent_payments_tenant_property_cycle "
        "ON rent_payments (tenant_id, property_id, rent_year, rent_month) "
        "WHERE payment_status = 'confirmed' AND rent_year IS NOT NULL AND rent_month IS NOT NULL"
    )
    cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_blockchain_event_log_tx_log ON blockchain_event_log (tx_hash, log_index)")
    cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_blockchain_sync_state_name ON blockchain_sync_state (index_name)")
    # One SecurityToken contract per property.
    cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_properties_token_address_unique ON properties (token_address) WHERE token_address IS NOT NULL AND token_address <> ''")
    # Legacy per-property distributor (retired in Phase A; kept here for historical rows).
    cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_properties_distributor_address_unique ON properties (distributor_address) WHERE distributor_address IS NOT NULL AND distributor_address <> ''")
    # Phase B: one payout row per (distribution, investor). Idempotent replay safety.
    _try_ensure_unique_index(
        cursor,
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_investor_rent_payouts_dist_investor "
        "ON investor_rent_payouts (distribution_id, investor_wallet)",
        "investor_rent_payouts(distribution_id, investor_wallet)"
    )


def _ensure_updated_at_trigger(cursor) -> None:
    cursor.execute(
        """
        CREATE OR REPLACE FUNCTION set_investments_updated_at()
        RETURNS trigger AS $$
        BEGIN
            NEW.updated_at = CURRENT_TIMESTAMP;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    cursor.execute("DROP TRIGGER IF EXISTS trg_investments_updated_at ON investments")
    cursor.execute(
        """
        CREATE TRIGGER trg_investments_updated_at
        BEFORE UPDATE ON investments
        FOR EACH ROW
        EXECUTE FUNCTION set_investments_updated_at();
        """
    )


def init_db() -> None:
    _ensure_database_exists()

    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS users ("
            "id SERIAL PRIMARY KEY, "
            "wallet_address VARCHAR(42) NOT NULL UNIQUE, "
            "email VARCHAR(255) NULL UNIQUE, "
            "kyc_status VARCHAR(20) NOT NULL DEFAULT 'pending', "
            "role VARCHAR(20) NOT NULL DEFAULT 'investor', "
            "active BOOLEAN NOT NULL DEFAULT TRUE, "
            "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, "
            "last_login TIMESTAMP NULL"
            ")"
        )
        _ensure_column(cursor, "users", "email", "VARCHAR(255) NULL UNIQUE")
        _ensure_column(cursor, "users", "kyc_status", "VARCHAR(20) NOT NULL DEFAULT 'pending'")
        _ensure_column(cursor, "users", "role", "VARCHAR(20) NOT NULL DEFAULT 'investor'")
        _ensure_column(cursor, "users", "active", "BOOLEAN NOT NULL DEFAULT TRUE")
        _ensure_column(cursor, "users", "created_at", "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP")
        _ensure_column(cursor, "users", "last_login", "TIMESTAMP NULL")
        cursor.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wallet_lower "
            "ON users (LOWER(wallet_address))"
        )

        cursor.execute(
            "CREATE TABLE IF NOT EXISTS properties ("
            "id SERIAL PRIMARY KEY, "
            "name VARCHAR(255) NOT NULL, "
            "location VARCHAR(255) NOT NULL, "
            "total_value DECIMAL(24,2) NOT NULL, "
            "token_supply DECIMAL(36,0) NOT NULL, "
            "token_symbol VARCHAR(12) NOT NULL, "
            "owner_wallet VARCHAR(42) NULL, "
            "sale_address VARCHAR(42) NULL, "
            "token_price_base VARCHAR(78) NULL, "
            "token_address VARCHAR(42) NULL, "
            "distributor_address VARCHAR(42) NULL, "
            "nft_token_id INT NULL, "
            "nft_contract_address VARCHAR(42) NULL, "
            "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
            ")"
        )
        _ensure_column(cursor, "properties", "sale_address", "VARCHAR(42) NULL")
        # token_price_base: sale price per token denominated in wei (string to preserve precision).
        _ensure_column(cursor, "properties", "token_price_base", "VARCHAR(78) NULL")
        _ensure_column(cursor, "properties", "token_address", "VARCHAR(42) NULL")
        # distributor_address: legacy per-property RentalYieldDistributor, retired. Kept for backward-compat.
        _ensure_column(cursor, "properties", "distributor_address", "VARCHAR(42) NULL")
        _ensure_column(cursor, "properties", "nft_token_id", "INT NULL")
        _ensure_column(cursor, "properties", "nft_contract_address", "VARCHAR(42) NULL")
        _ensure_column(cursor, "properties", "images", "JSONB NOT NULL DEFAULT '[]'::jsonb")
        _ensure_column(cursor, "properties", "is_active", "BOOLEAN NOT NULL DEFAULT TRUE")
        _ensure_column(cursor, "properties", "created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
        _ensure_column(cursor, "properties", "owner_wallet", "VARCHAR(42) NULL")

        cursor.execute(
            "CREATE TABLE IF NOT EXISTS kyc_status ("
            "user_id INT PRIMARY KEY, "
            "verified BOOLEAN NOT NULL DEFAULT FALSE, "
            "country CHAR(2) NULL, "
            "CONSTRAINT fk_kyc_user FOREIGN KEY (user_id) REFERENCES users(id) "
            "ON DELETE CASCADE"
            ")"
        )
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS token_ownerships ("
            "user_id INT NOT NULL, "
            "property_id INT NOT NULL, "
            "token_amount DECIMAL(36,0) NOT NULL DEFAULT 0, "
            "PRIMARY KEY (user_id, property_id), "
            "CONSTRAINT fk_to_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, "
            "CONSTRAINT fk_to_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE"
            ")"
        )
        _ensure_column(cursor, "token_ownerships", "token_amount", "DECIMAL(36,0) NOT NULL DEFAULT 0")

        cursor.execute(
            "CREATE TABLE IF NOT EXISTS transactions ("
            "id SERIAL PRIMARY KEY, "
            "tx_hash VARCHAR(66) NOT NULL UNIQUE, "
            "type VARCHAR(50) NOT NULL, "
            "amount DECIMAL(36,0) NOT NULL, "
            "timestamp TIMESTAMP NOT NULL, "
            "property_id INT NULL, "
            "wallet_address VARCHAR(42) NULL, "
            "block_number INT NULL, "
            "CONSTRAINT fk_tx_property FOREIGN KEY (property_id) REFERENCES properties(id) "
            "ON DELETE SET NULL"
            ")"
        )
        _ensure_column(cursor, "transactions", "wallet_address", "VARCHAR(42) NULL")
        _ensure_column(cursor, "transactions", "block_number", "INT NULL")
        _ensure_column(cursor, "transactions", "gas_fee", "VARCHAR(78) NULL")
        _ensure_column(cursor, "transactions", "amount_spent", "VARCHAR(78) NULL")
        _ensure_column(cursor, "transactions", "remaining_balance", "VARCHAR(78) NULL")

        cursor.execute(
            "CREATE TABLE IF NOT EXISTS investments ("
            "id SERIAL PRIMARY KEY, "
            "property_id INT NOT NULL, "
            "investor_wallet VARCHAR(42) NOT NULL, "
            "token_amount_base DECIMAL(36,0) NOT NULL, "
            "eth_amount_wei DECIMAL(36,0) NOT NULL, "
            "escrow_deal_id INT NULL, "
            "deposit_tx_hash VARCHAR(66) NULL, "
            "status VARCHAR(20) NOT NULL DEFAULT 'awaiting_deposit', "
            "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, "
            "updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, "
            "CONSTRAINT fk_inv_property FOREIGN KEY (property_id) REFERENCES properties(id) "
            "ON DELETE CASCADE"
            ")"
        )
        _ensure_column(cursor, "investments", "investor_wallet", "VARCHAR(42) NOT NULL")
        _ensure_column(cursor, "investments", "token_amount_base", "DECIMAL(36,0) NOT NULL")
        _ensure_column(cursor, "investments", "eth_amount_wei", "DECIMAL(36,0) NOT NULL")
        _ensure_column(cursor, "investments", "escrow_deal_id", "INT NULL")
        _ensure_column(cursor, "investments", "deposit_tx_hash", "VARCHAR(66) NULL")
        _ensure_column(cursor, "investments", "status", "VARCHAR(20) NOT NULL DEFAULT 'awaiting_deposit'")
        _ensure_column(cursor, "investments", "created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
        _ensure_column(cursor, "investments", "updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")

        _ensure_column(cursor, "properties", "monthly_rent_wei", "VARCHAR(78) NULL")

        cursor.execute(
            "CREATE TABLE IF NOT EXISTS tenants ("
            "id SERIAL PRIMARY KEY, "
            "wallet_address VARCHAR(42) NOT NULL UNIQUE, "
            "full_name VARCHAR(255) NULL, "
            "email VARCHAR(255) NULL, "
            "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
            ")"
        )

        cursor.execute(
            "CREATE TABLE IF NOT EXISTS tenant_rentals ("
            "id SERIAL PRIMARY KEY, "
            "tenant_id INT NOT NULL, "
            "property_id INT NOT NULL, "
            "rental_start_date DATE NULL, "
            "rental_end_date DATE NULL, "
            "monthly_rent VARCHAR(78) NOT NULL, "
            "status VARCHAR(20) NOT NULL DEFAULT 'active', "
            "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, "
            "CONSTRAINT fk_tr_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE, "
            "CONSTRAINT fk_tr_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE"
            ")"
        )

        cursor.execute(
            "CREATE TABLE IF NOT EXISTS rent_payments ("
            "id SERIAL PRIMARY KEY, "
            "tenant_id INT NOT NULL, "
            "property_id INT NOT NULL, "
            "amount_wei VARCHAR(78) NOT NULL, "
            "amount_eth VARCHAR(78) NOT NULL, "
            "tx_hash VARCHAR(66) NOT NULL UNIQUE, "
            "block_number INT NULL, "
            "payment_date TIMESTAMP NOT NULL, "
            "payment_status VARCHAR(20) NOT NULL DEFAULT 'confirmed', "
            "CONSTRAINT fk_rp_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE, "
            "CONSTRAINT fk_rp_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE"
            ")"
        )
        _ensure_column(cursor, "rent_payments", "rent_month", "INT NULL")
        _ensure_column(cursor, "rent_payments", "rent_year", "INT NULL")
        cursor.execute(
            "UPDATE rent_payments SET rent_month = EXTRACT(MONTH FROM payment_date)::INT "
            "WHERE rent_month IS NULL AND payment_date IS NOT NULL"
        )
        cursor.execute(
            "UPDATE rent_payments SET rent_year = EXTRACT(YEAR FROM payment_date)::INT "
            "WHERE rent_year IS NULL AND payment_date IS NOT NULL"
        )

        cursor.execute(
            "CREATE TABLE IF NOT EXISTS rent_distributions ("
            "id SERIAL PRIMARY KEY, "
            "property_id INT NOT NULL, "
            "rent_payment_id INT NOT NULL, "
            "total_rent_collected VARCHAR(78) NOT NULL, "
            "total_distributed VARCHAR(78) NOT NULL, "
            "investor_count INT NOT NULL DEFAULT 0, "
            "distribution_tx_hash VARCHAR(66) NOT NULL, "
            "distributed_at TIMESTAMP NOT NULL, "
            "CONSTRAINT fk_rd_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE, "
            "CONSTRAINT fk_rd_payment FOREIGN KEY (rent_payment_id) REFERENCES rent_payments(id) ON DELETE CASCADE"
            ")"
        )

        cursor.execute(
            "CREATE TABLE IF NOT EXISTS investor_rent_payouts ("
            "id SERIAL PRIMARY KEY, "
            "distribution_id INT NOT NULL, "
            "investor_wallet VARCHAR(42) NOT NULL, "
            "property_id INT NOT NULL, "
            "ownership_percentage DECIMAL(10,4) NOT NULL, "
            "payout_amount_wei VARCHAR(78) NOT NULL, "
            "payout_amount_eth VARCHAR(78) NOT NULL, "
            "tx_hash VARCHAR(66) NOT NULL, "
            "distributed_at TIMESTAMP NOT NULL, "
            "claim_status VARCHAR(20) NOT NULL DEFAULT 'claimable', "
            "claim_tx_hash VARCHAR(66) NULL, "
            "claimed_at TIMESTAMP NULL, "
            "CONSTRAINT fk_irp_dist FOREIGN KEY (distribution_id) REFERENCES rent_distributions(id) ON DELETE CASCADE, "
            "CONSTRAINT fk_irp_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE"
            ")"
        )
        _ensure_column(cursor, "investor_rent_payouts", "claim_status", "VARCHAR(20) NOT NULL DEFAULT 'claimable'")
        _ensure_column(cursor, "investor_rent_payouts", "claim_tx_hash", "VARCHAR(66) NULL")
        _ensure_column(cursor, "investor_rent_payouts", "claimed_at", "TIMESTAMP NULL")

        cursor.execute(
            "CREATE TABLE IF NOT EXISTS blockchain_sync_state ("
            "index_name VARCHAR(64) PRIMARY KEY, "
            "last_block INT NOT NULL DEFAULT 0, "
            "updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP"
            ")"
        )

        cursor.execute(
            "CREATE TABLE IF NOT EXISTS blockchain_event_log ("
            "id SERIAL PRIMARY KEY, "
            "tx_hash VARCHAR(66) NOT NULL, "
            "log_index INT NOT NULL, "
            "block_number INT NOT NULL, "
            "contract_address VARCHAR(42) NOT NULL, "
            "event_name VARCHAR(128) NOT NULL, "
            "processed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, "
            "UNIQUE (tx_hash, log_index)"
            ")"
        )

        # ── Wallet authentication: nonce challenges ──
        cursor.execute(
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
        _ensure_column(cursor, "auth_nonces", "message", "TEXT NOT NULL DEFAULT ''")
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_auth_nonces_wallet "
            "ON auth_nonces (LOWER(wallet_address))"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_auth_nonces_expires "
            "ON auth_nonces (expires_at)"
        )

        # ── Wallet authentication: issued sessions (JWT jti registry) ──
        cursor.execute(
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
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_auth_sessions_wallet "
            "ON auth_sessions (LOWER(wallet_address))"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires "
            "ON auth_sessions (expires_at)"
        )

        # ── AI orchestration foundation (Phase 1 — threads / messages / KV) ──
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS agent_orchestration_threads ("
            "id SERIAL PRIMARY KEY, "
            "user_id INT NOT NULL, "
            "wallet_address VARCHAR(42) NOT NULL, "
            "platform_role VARCHAR(32) NOT NULL, "
            "title VARCHAR(255) NULL, "
            "metadata TEXT NOT NULL DEFAULT '{}', "
            "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, "
            "updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, "
            "CONSTRAINT fk_agent_threads_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"
            ")"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_agent_threads_user ON agent_orchestration_threads (user_id)"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_agent_threads_wallet "
            "ON agent_orchestration_threads (LOWER(wallet_address))"
        )
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS agent_orchestration_messages ("
            "id SERIAL PRIMARY KEY, "
            "thread_id INT NOT NULL, "
            "author VARCHAR(32) NOT NULL, "
            "content TEXT NOT NULL, "
            "event_payload TEXT NOT NULL DEFAULT '{}', "
            "seq INT NOT NULL DEFAULT 0, "
            "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, "
            "CONSTRAINT fk_agent_messages_thread FOREIGN KEY (thread_id) "
            "REFERENCES agent_orchestration_threads(id) ON DELETE CASCADE"
            ")"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_agent_messages_thread_seq "
            "ON agent_orchestration_messages (thread_id, seq)"
        )
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS agent_lg_checkpoints ("
            "thread_id TEXT NOT NULL, "
            "checkpoint_ns TEXT NOT NULL DEFAULT '', "
            "checkpoint_id TEXT NOT NULL, "
            "parent_checkpoint_id TEXT, "
            "type TEXT, "
            "checkpoint BYTEA NOT NULL, "
            "metadata JSONB NOT NULL DEFAULT '{}'::jsonb, "
            "PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)"
            ")"
        )
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS agent_lg_writes ("
            "thread_id TEXT NOT NULL, "
            "checkpoint_ns TEXT NOT NULL DEFAULT '', "
            "checkpoint_id TEXT NOT NULL, "
            "task_id TEXT NOT NULL, "
            "idx INT NOT NULL, "
            "channel TEXT NOT NULL, "
            "type TEXT, "
            "value BYTEA, "
            "PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)"
            ")"
        )
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS agent_orchestration_runs ("
            "id SERIAL PRIMARY KEY, "
            "trace_id TEXT NOT NULL, "
            "graph_thread_id TEXT NOT NULL, "
            "memory_thread_id INT NULL, "
            "user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE, "
            "execution_mode VARCHAR(32) NOT NULL, "
            "graph_profile VARCHAR(128) NOT NULL, "
            "status VARCHAR(32) NOT NULL, "
            "error TEXT NULL, "
            "policies_json JSONB NOT NULL DEFAULT '{}'::jsonb, "
            "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP"
            ")"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_agent_orch_runs_trace ON agent_orchestration_runs (trace_id)"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_agent_orch_runs_gthread ON agent_orchestration_runs (graph_thread_id)"
        )
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS agent_orchestration_steps ("
            "id SERIAL PRIMARY KEY, "
            "run_id INT NOT NULL REFERENCES agent_orchestration_runs(id) ON DELETE CASCADE, "
            "step_index INT NOT NULL, "
            "step_type VARCHAR(64) NOT NULL, "
            "tool_name TEXT NULL, "
            "capability TEXT NULL, "
            "ok BOOLEAN NOT NULL, "
            "error TEXT NULL, "
            "duration_ms INT NULL, "
            "detail_json JSONB NOT NULL DEFAULT '{}'::jsonb, "
            "UNIQUE(run_id, step_index)"
            ")"
        )
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS agent_context_kv ("
            "user_id INT NOT NULL, "
            "namespace VARCHAR(64) NOT NULL DEFAULT 'default', "
            "key VARCHAR(128) NOT NULL, "
            "value TEXT NOT NULL, "
            "updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, "
            "PRIMARY KEY (user_id, namespace, key), "
            "CONSTRAINT fk_agent_kv_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"
            ")"
        )

        # ── Phase 7 — autonomous monitoring + watchlists + intelligence feed ──
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS ai_watchlists ("
            "id SERIAL PRIMARY KEY, "
            "user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE, "
            "platform_role VARCHAR(32) NOT NULL, "
            "name VARCHAR(160) NOT NULL, "
            "rules_json JSONB NOT NULL DEFAULT '{}'::jsonb, "
            "active BOOLEAN NOT NULL DEFAULT TRUE, "
            "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, "
            "updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP"
            ")"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_ai_watchlists_user ON ai_watchlists (user_id, active)"
        )
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS ai_intelligence_events ("
            "id SERIAL PRIMARY KEY, "
            "user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE, "
            "platform_role VARCHAR(32) NOT NULL, "
            "agent VARCHAR(96) NOT NULL, "
            "severity VARCHAR(24) NOT NULL DEFAULT 'info', "
            "category VARCHAR(64) NOT NULL, "
            "title VARCHAR(255) NOT NULL, "
            "body TEXT NOT NULL DEFAULT '', "
            "metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb, "
            "draft_payload_json JSONB NULL, "
            "dedupe_key VARCHAR(200) NOT NULL, "
            "read_at TIMESTAMP NULL, "
            "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, "
            "UNIQUE (user_id, dedupe_key)"
            ")"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_ai_intel_user_created ON ai_intelligence_events (user_id, created_at DESC)"
        )

        cursor.execute(
            "CREATE TABLE IF NOT EXISTS governance_settings ("
            "setting_key VARCHAR(128) PRIMARY KEY, "
            "value_json JSONB NOT NULL DEFAULT '{}'::jsonb, "
            "updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, "
            "updated_by_user_id INT NULL REFERENCES users(id) ON DELETE SET NULL"
            ")"
        )
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS governance_metric_samples ("
            "id BIGSERIAL PRIMARY KEY, "
            "metric_key VARCHAR(160) NOT NULL, "
            "dimensions_json JSONB NOT NULL DEFAULT '{}'::jsonb, "
            "value_json JSONB NOT NULL DEFAULT '{}'::jsonb, "
            "recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP"
            ")"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_gov_metrics_key_time ON governance_metric_samples (metric_key, recorded_at DESC)"
        )
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS governance_events ("
            "id BIGSERIAL PRIMARY KEY, "
            "event_type VARCHAR(96) NOT NULL, "
            "severity VARCHAR(24) NOT NULL DEFAULT 'info', "
            "user_id INT NULL REFERENCES users(id) ON DELETE SET NULL, "
            "actor_user_id INT NULL REFERENCES users(id) ON DELETE SET NULL, "
            "trace_id TEXT NULL, "
            "source VARCHAR(64) NOT NULL DEFAULT 'platform', "
            "payload_json JSONB NOT NULL DEFAULT '{}'::jsonb, "
            "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP"
            ")"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_gov_events_created ON governance_events (created_at DESC)"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_gov_events_type ON governance_events (event_type, created_at DESC)"
        )

        _ensure_indexes(cursor)
        _ensure_updated_at_trigger(cursor)

        conn.commit()
    finally:
        cursor.close()
        conn.close()
