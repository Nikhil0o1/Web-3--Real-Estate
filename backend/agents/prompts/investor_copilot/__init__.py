"""Investor copilot prompt assembly (modular snippets, no giant hardcoded blobs)."""

from backend.agents.prompts.investor_copilot.system import build_investor_copilot_system_prompt

__all__ = ["build_investor_copilot_system_prompt"]
