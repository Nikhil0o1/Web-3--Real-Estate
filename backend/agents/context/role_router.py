"""Route orchestration to graph profiles by role + surface (scaffolding for multi-agent)."""
from __future__ import annotations

# Future: investor_copilot, property_owner_ops, tenant_support, etc.
_PROFILE_PREFIX = "foundation"


def resolve_graph_profile(platform_role: str, dashboard_surface: str | None) -> str:
    """Return a stable graph profile key. Phase 1 uses a single foundation graph per role."""
    role = (platform_role or "unknown").strip().lower()
    surface = (dashboard_surface or "default").strip().lower()[:64]
    return f"{_PROFILE_PREFIX}:{role}:{surface}"


def tool_categories_for_role(platform_role: str) -> list[str]:
    """Hints for which tool groups are typically relevant (routing / Phase 3 prompts)."""
    role = (platform_role or "").strip().lower()
    if role == "investor":
        return ["marketplace", "investor", "yield", "transactions", "tx_prepare", "rewards"]
    if role == "property_owner":
        return ["property_owner", "operations", "pricing", "forecast", "investor", "transactions", "marketplace"]
    if role == "tenant":
        return ["tenant", "payments", "affordability", "forecast", "reminder", "marketplace", "transactions"]
    return ["orchestration"]
