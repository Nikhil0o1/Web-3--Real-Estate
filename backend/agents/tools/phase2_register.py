"""Register all Phase-2 intelligence tools."""
from __future__ import annotations

from backend.agents.tools import intelligence_investor as inv
from backend.agents.tools import intelligence_marketplace as mp
from backend.agents.tools import intelligence_property_owner as po
from backend.agents.tools import intelligence_tenant as tn
from backend.agents.tools import intelligence_transactions as tx
from backend.agents.tools import intelligence_tx_prep as tp
from backend.agents.tools import intelligence_yield as yd


def register_phase2_tools(registry) -> None:
    mp.register_marketplace_tools(registry)
    inv.register_investor_tools(registry)
    tx.register_transaction_tools(registry)
    yd.register_yield_tools(registry)
    tp.register_tx_prepare_tools(registry)
    tn.register_tenant_tools(registry)
    po.register_property_owner_tools(registry)
