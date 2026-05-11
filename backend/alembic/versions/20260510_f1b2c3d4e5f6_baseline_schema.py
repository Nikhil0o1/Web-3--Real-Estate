"""Baseline schema — matches Phase D production state.

All tables, columns, indexes, and triggers as defined by backend/db/schema.py
at the time of the Phase D refactor. This is a manual baseline; future
migrations should be generated via `alembic revision -m "description"`
and populated with explicit `op.execute()` statements.

Revision ID: f1b2c3d4e5f6
Revises: 
Create Date: 2026-05-10 00:00:00.000000

"""
from alembic import op

# revision identifiers, used by Alembic.
revision = "f1b2c3d4e5f6"
down_revision = None
branch_labels = None
depends_on = None


# ══════════════════════════════════════════════════════════════════════
#  UPGRADE — create tables + columns + indexes + triggers
# ══════════════════════════════════════════════════════════════════════

def upgrade() -> None:
    # ── users ──
    op.execute(
        "CREATE TABLE IF NOT EXISTS users ("
        "id SERIAL PRIMARY KEY, "
        "wallet_address VARCHAR(42) NOT NULL UNIQUE, "
        "email VARCHAR(255) NULL UNIQUE, "
        "kyc_status VARCHAR(20) NOT NULL DEFAULT 'pending', "
        "role VARCHAR(20) NOT NULL DEFAULT 'investor'"
        ")"
    )

    # ── properties ──
    op.execute(
        "CREATE TABLE IF NOT EXISTS properties ("
        "id SERIAL PRIMARY KEY, "
        "name VARCHAR(255) NOT NULL, "
        "location VARCHAR(255) NOT NULL, "
        "total_value DECIMAL(24,2) NOT NULL, "
        "token_supply DECIMAL(36,0) NOT NULL, "
        "token_symbol VARCHAR(12) NOT NULL, "
        "sale_address VARCHAR(42) NULL, "
        "token_price_base VARCHAR(78) NULL, "
        "token_address VARCHAR(42) NULL, "
        "distributor_address VARCHAR(42) NULL, "
        "nft_token_id INT NULL, "
        "nft_contract_address VARCHAR(42) NULL, "
        "monthly_rent_wei VARCHAR(78) NULL, "
        "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
        ")"
    )

    # ── kyc_status ──
    op.execute(
        "CREATE TABLE IF NOT EXISTS kyc_status ("
        "user_id INT PRIMARY KEY, "
        "verified BOOLEAN NOT NULL DEFAULT FALSE, "
        "country CHAR(2) NULL, "
        "CONSTRAINT fk_kyc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"
        ")"
    )

    # ── token_ownerships ──
    op.execute(
        "CREATE TABLE IF NOT EXISTS token_ownerships ("
        "user_id INT NOT NULL, "
        "property_id INT NOT NULL, "
        "token_amount DECIMAL(36,0) NOT NULL DEFAULT 0, "
        "PRIMARY KEY (user_id, property_id), "
        "CONSTRAINT fk_to_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, "
        "CONSTRAINT fk_to_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE"
        ")"
    )

    # ── transactions ──
    op.execute(
        "CREATE TABLE IF NOT EXISTS transactions ("
        "id SERIAL PRIMARY KEY, "
        "tx_hash VARCHAR(66) NOT NULL UNIQUE, "
        "type VARCHAR(50) NOT NULL, "
        "amount DECIMAL(36,0) NOT NULL, "
        "timestamp TIMESTAMP NOT NULL, "
        "property_id INT NULL, "
        "wallet_address VARCHAR(42) NULL, "
        "block_number INT NULL, "
        "gas_fee VARCHAR(78) NULL, "
        "amount_spent VARCHAR(78) NULL, "
        "remaining_balance VARCHAR(78) NULL, "
        "CONSTRAINT fk_tx_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL"
        ")"
    )

    # ── investments ──
    op.execute(
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
        "CONSTRAINT fk_inv_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE"
        ")"
    )

    # ── tenants ──
    op.execute(
        "CREATE TABLE IF NOT EXISTS tenants ("
        "id SERIAL PRIMARY KEY, "
        "wallet_address VARCHAR(42) NOT NULL UNIQUE, "
        "full_name VARCHAR(255) NULL, "
        "email VARCHAR(255) NULL, "
        "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
        ")"
    )

    # ── tenant_rentals ──
    op.execute(
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

    # ── rent_payments ──
    op.execute(
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

    # ── rent_distributions ──
    op.execute(
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

    # ── investor_rent_payouts ──
    op.execute(
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
        "CONSTRAINT fk_irp_dist FOREIGN KEY (distribution_id) REFERENCES rent_distributions(id) ON DELETE CASCADE, "
        "CONSTRAINT fk_irp_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE"
        ")"
    )

    # ── blockchain_sync_state ──
    op.execute(
        "CREATE TABLE IF NOT EXISTS blockchain_sync_state ("
        "index_name VARCHAR(64) PRIMARY KEY, "
        "last_block INT NOT NULL DEFAULT 0, "
        "updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP"
        ")"
    )

    # ── blockchain_event_log ──
    op.execute(
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

    # ── Indexes ──
    op.execute("CREATE INDEX IF NOT EXISTS idx_tenant_wallet ON tenants (wallet_address)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_tr_tenant ON tenant_rentals (tenant_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_tr_property ON tenant_rentals (property_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_rp_tenant ON rent_payments (tenant_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_rp_property ON rent_payments (property_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_rp_date ON rent_payments (payment_date)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_rd_property ON rent_distributions (property_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_irp_investor ON investor_rent_payouts (investor_wallet)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_irp_property ON investor_rent_payouts (property_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_irp_dist ON investor_rent_payouts (distribution_id)")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_investments_deposit_tx_hash "
        "ON investments (deposit_tx_hash) WHERE deposit_tx_hash IS NOT NULL"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_rent_distributions_tx_hash "
        "ON rent_distributions (distribution_tx_hash)"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_blockchain_event_log_tx_log "
        "ON blockchain_event_log (tx_hash, log_index)"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_blockchain_sync_state_name "
        "ON blockchain_sync_state (index_name)"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_properties_token_address_unique "
        "ON properties (token_address) WHERE token_address IS NOT NULL AND token_address <> ''"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_properties_distributor_address_unique "
        "ON properties (distributor_address) WHERE distributor_address IS NOT NULL AND distributor_address <> ''"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_investor_rent_payouts_dist_investor "
        "ON investor_rent_payouts (distribution_id, investor_wallet)"
    )

    # ── Trigger: auto-update investments.updated_at ──
    op.execute(
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
    op.execute("DROP TRIGGER IF EXISTS trg_investments_updated_at ON investments")
    op.execute(
        """
        CREATE TRIGGER trg_investments_updated_at
        BEFORE UPDATE ON investments
        FOR EACH ROW
        EXECUTE FUNCTION set_investments_updated_at();
        """
    )


# ══════════════════════════════════════════════════════════════════════
#  DOWNGRADE — drop tables in reverse dependency order
# ══════════════════════════════════════════════════════════════════════

def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS investor_rent_payouts CASCADE")
    op.execute("DROP TABLE IF EXISTS rent_distributions CASCADE")
    op.execute("DROP TABLE IF EXISTS rent_payments CASCADE")
    op.execute("DROP TABLE IF EXISTS tenant_rentals CASCADE")
    op.execute("DROP TABLE IF EXISTS tenants CASCADE")
    op.execute("DROP TABLE IF EXISTS investments CASCADE")
    op.execute("DROP TABLE IF EXISTS transactions CASCADE")
    op.execute("DROP TABLE IF EXISTS token_ownerships CASCADE")
    op.execute("DROP TABLE IF EXISTS kyc_status CASCADE")
    op.execute("DROP TABLE IF EXISTS properties CASCADE")
    op.execute("DROP TABLE IF EXISTS users CASCADE")
    op.execute("DROP TABLE IF EXISTS blockchain_event_log CASCADE")
    op.execute("DROP TABLE IF EXISTS blockchain_sync_state CASCADE")
    op.execute("DROP FUNCTION IF EXISTS set_investments_updated_at() CASCADE")
