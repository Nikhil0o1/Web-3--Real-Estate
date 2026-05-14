"""Non-custodial transaction preparation tools (reuse existing prepare routes)."""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from backend.agents.context.session import OrchestrationContext
from backend.agents.tools._router_bridge import auth_user_from_orchestration, get_tool_db, sync_route_tool
from backend.agents.tools.base import ToolCapability, ToolMetadata, ToolResult, ToolSpec
from backend.api.routers.investments import prepare_investment
from backend.api.routers.rent import prepare_claim_rewards, prepare_rent_payment
from backend.api.schemas import ClaimRewardsPrepareRequest, InvestmentCreateRequest
from backend.services.auth import normalize_address

_ROLES_INV_PO = frozenset({"investor", "property_owner"})
_ROLES_TENANT_PO = frozenset({"tenant", "property_owner"})


async def _prep_invest(ctx: OrchestrationContext, arguments: dict[str, Any]) -> ToolResult:
    db = get_tool_db(ctx)
    if not db:
        return ToolResult(ok=False, error="DB_REQUIRED")
    if ctx.platform_role not in ("investor", "property_owner"):
        return ToolResult(ok=False, error="TOOL_FORBIDDEN_FOR_ROLE")
    payload = InvestmentCreateRequest(
        property_id=int(arguments["property_id"]),
        investor_wallet=normalize_address(ctx.wallet_address),
        token_amount=Decimal(str(arguments["token_amount"])),
    )
    user = auth_user_from_orchestration(ctx)
    return sync_route_tool(
        "tx.prepare_investment",
        prepare_investment,
        payload=payload,
        db=db,
        user=user,
    )


async def _prep_claim(ctx: OrchestrationContext, arguments: dict[str, Any]) -> ToolResult:
    db = get_tool_db(ctx)
    if not db:
        return ToolResult(ok=False, error="DB_REQUIRED")
    payload = ClaimRewardsPrepareRequest(
        property_id=int(arguments["property_id"]),
        investor_wallet=normalize_address(ctx.wallet_address),
    )
    user = auth_user_from_orchestration(ctx)
    return sync_route_tool(
        "tx.prepare_claim_rewards",
        prepare_claim_rewards,
        payload=payload,
        db=db,
        user=user,
    )


async def _prep_rent(ctx: OrchestrationContext, arguments: dict[str, Any]) -> ToolResult:
    db = get_tool_db(ctx)
    if not db:
        return ToolResult(ok=False, error="DB_REQUIRED")
    pid = int(arguments.get("property_id", 0))
    if pid <= 0:
        return ToolResult(ok=False, error="INVALID_PROPERTY_ID")
    return sync_route_tool(
        "tx.prepare_rent_payment",
        prepare_rent_payment,
        property_id=pid,
        db=db,
    )


def register_tx_prepare_tools(registry) -> None:
    for spec in [
        ToolSpec(
            ToolMetadata(
                "tx.prepare_investment",
                "Prepare primary-market invest calldata (wraps POST /investments/prepare). Never signs.",
                allowed_roles=_ROLES_INV_PO,
                categories=("tx_prepare", "investor"),
                capability=ToolCapability.TX_PREPARATION,
            ),
            _prep_invest,
        ),
        ToolSpec(
            ToolMetadata(
                "tx.prepare_claim_rewards",
                "Prepare claimRewards calldata (wraps POST /rewards/prepare-claim). Never signs.",
                allowed_roles=_ROLES_INV_PO,
                categories=("tx_prepare", "investor"),
                capability=ToolCapability.TX_PREPARATION,
            ),
            _prep_claim,
        ),
        ToolSpec(
            ToolMetadata(
                "tx.prepare_rent_payment",
                "Prepare payRent calldata (wraps GET /tenant/pay-rent/prepare/{id}). Never signs.",
                allowed_roles=_ROLES_TENANT_PO,
                categories=("tx_prepare", "tenant"),
                capability=ToolCapability.TX_PREPARATION,
            ),
            _prep_rent,
        ),
    ]:
        registry.register(spec)
