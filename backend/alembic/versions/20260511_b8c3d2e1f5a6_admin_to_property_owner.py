"""Rename admin role to property_owner

Implements semi-decentralized role model:
- Removes centralized admin restrictions
- Renames existing 'admin' roles to 'property_owner'
- Updates auth_sessions role references

Revision ID: b8c3d2e1f5a6
Revises: a7b2c1d8e3f4
Create Date: 2026-05-11 17:00:00.000000
"""
from alembic import op


revision = "b8c3d2e1f5a6"
down_revision = "a7b2c1d8e3f4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Migrate users with role='admin' to role='property_owner'
    op.execute("UPDATE users SET role = 'property_owner' WHERE role = 'admin'")
    
    # Update any existing auth_sessions that reference 'admin' role
    op.execute("UPDATE auth_sessions SET role = 'property_owner' WHERE role = 'admin'")


def downgrade() -> None:
    # Revert property_owner back to admin
    op.execute("UPDATE users SET role = 'admin' WHERE role = 'property_owner'")
    op.execute("UPDATE auth_sessions SET role = 'admin' WHERE role = 'property_owner'")
