"""Property workflow refinement.

Revision ID: g7h8i9j0k1l2
Revises: f1a2b3c4d5e7
Create Date: 2026-05-15
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "g7h8i9j0k1l2"
down_revision = "f1a2b3c4d5e7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "properties",
        sa.Column(
            "images",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column(
        "properties",
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("TRUE")),
    )
    op.create_index("idx_properties_active", "properties", ["is_active"], if_not_exists=True)

    op.add_column("rent_payments", sa.Column("rent_month", sa.Integer(), nullable=True))
    op.add_column("rent_payments", sa.Column("rent_year", sa.Integer(), nullable=True))
    op.execute(
        "UPDATE rent_payments SET rent_month = EXTRACT(MONTH FROM payment_date)::INT "
        "WHERE rent_month IS NULL AND payment_date IS NOT NULL"
    )
    op.execute(
        "UPDATE rent_payments SET rent_year = EXTRACT(YEAR FROM payment_date)::INT "
        "WHERE rent_year IS NULL AND payment_date IS NOT NULL"
    )
    op.create_index(
        "idx_rp_cycle",
        "rent_payments",
        ["tenant_id", "property_id", "rent_year", "rent_month"],
        if_not_exists=True,
    )
    op.create_index(
        "idx_rent_payments_tenant_property_cycle",
        "rent_payments",
        ["tenant_id", "property_id", "rent_year", "rent_month"],
        unique=True,
        postgresql_where=sa.text(
            "payment_status = 'confirmed' AND rent_year IS NOT NULL AND rent_month IS NOT NULL"
        ),
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_index("idx_rent_payments_tenant_property_cycle", table_name="rent_payments", if_exists=True)
    op.drop_index("idx_rp_cycle", table_name="rent_payments", if_exists=True)
    op.drop_column("rent_payments", "rent_year")
    op.drop_column("rent_payments", "rent_month")
    op.drop_index("idx_properties_active", table_name="properties", if_exists=True)
    op.drop_column("properties", "is_active")
    op.drop_column("properties", "images")
