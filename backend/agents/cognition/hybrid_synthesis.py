"""Frontier-model narrative layer on top of deterministic copilot outputs."""
from __future__ import annotations

import time
from typing import Any, Literal

from langchain_core.runnables import RunnableConfig

from backend.agents.cognition.governance import (
    extract_json_object,
    sanitize_user_message,
    trim_jsonable_facts,
    validate_copilot_synthesis_payload,
)
from backend.agents.config.providers import LLMCompletionResult, get_completion_router
from backend.agents.config.settings import get_ai_settings

CopilotRoleName = Literal["investor", "property_owner", "tenant"]


def _stream_emit(config: RunnableConfig, payload: dict[str, Any]) -> None:
    try:
        from langgraph.config import get_stream_writer

        w = get_stream_writer()
        w({"kind": "cognition", **payload})
    except Exception:
        return


async def hybrid_enhance_copilot_narrative(
    *,
    role: CopilotRoleName,
    config: RunnableConfig,
    user_message: str,
    intent: str,
    template_message: str,
    template_reasoning: str,
    facts_bundle: dict[str, Any],
    trace_id: str | None = None,
    user_id: int | None = None,
) -> tuple[str, str, list[str], list[dict[str, Any]]]:
    """Return (message, reasoning, extra_warnings, trace_entries).

    On any failure, returns the template pair with governance warnings.
    """
    settings = get_ai_settings()
    trace: list[dict[str, Any]] = []
    warnings: list[str] = []

    if not settings.ai_llm_synthesis_enabled:
        trace.append(
            {
                "step_type": "llm_synthesis",
                "ok": True,
                "error": None,
                "duration_ms": 0,
                "tool_name": None,
                "detail": {"skipped": True, "reason": "AI_LLM_SYNTHESIS_DISABLED"},
            }
        )
        return template_message, template_reasoning, warnings, trace

    router = get_completion_router()
    if not router.any_configured():
        trace.append(
            {
                "step_type": "llm_synthesis",
                "ok": True,
                "error": None,
                "duration_ms": 0,
                "tool_name": None,
                "detail": {"skipped": True, "reason": "NO_LLM_CONFIGURED"},
            }
        )
        return template_message, template_reasoning, warnings, trace

    facts_json = trim_jsonable_facts(facts_bundle, max_chars=settings.max_facts_json_chars)
    safe_user = sanitize_user_message(user_message)

    system = (
        f"You are the {role} copilot for a non-custodial Web3 real estate platform.\n"
        "Rules (mandatory):\n"
        "- The FACTS_JSON block is the only source of quantitative truth. Never invent yields, "
        "balances, ROI, rewards, prices, or on-chain outcomes.\n"
        "- If a figure is not present in FACTS_JSON, say it is unknown rather than guessing.\n"
        "- You only produce natural-language explanation and guidance. "
        "You cannot sign transactions or bypass MetaMask.\n"
        "- The product may navigate the UI (tabs, dialogs) automatically for in-app requests; "
        "do not refuse with claims like 'I cannot open that page' when the user is asking to "
        "use screens inside this app—summarise FACTS_JSON and describe what they should see next.\n"
        "- Stay within the user's role; do not advise actions outside that role.\n"
        "Output: a single JSON object with keys message (string) and reasoning_summary (string).\n"
        "message = user-facing concise answer; reasoning_summary = short chain-of-thought for audit logs."
    )
    user_block = (
        f"USER_MESSAGE:\n{safe_user}\n\nINTENT:\n{intent}\n\n"
        f"FACTS_JSON:\n{facts_json}\n\n"
        "TEMPLATE_FALLBACK_MESSAGE:\n"
        f"{template_message}\n\n"
        "TEMPLATE_FALLBACK_REASONING:\n"
        f"{template_reasoning}\n\n"
        "Improve the template using FACTS_JSON. Keep numbers only if they appear in FACTS_JSON."
    )
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_block},
    ]

    attempts: list[dict[str, Any]] = []

    def on_attempt(provider: str, model: str, res: LLMCompletionResult) -> None:
        attempts.append(
            {
                "provider": provider,
                "model": model,
                "latency_ms": res.latency_ms,
                "error": res.error,
                "fallback_used": res.fallback_used,
                "usage": res.usage,
            }
        )

    _stream_emit(config, {"phase": "start", "snippet": "Invoking frontier model for synthesis…"})
    t0 = time.perf_counter()
    result = await router.complete_with_failover(
        messages=messages,
        max_tokens=settings.max_llm_output_tokens,
        temperature=settings.llm_temperature,
        json_mode=True,
        on_attempt=on_attempt,
    )
    total_ms = int((time.perf_counter() - t0) * 1000)

    try:
        from backend.agents.governance.store import record_governance_event, record_metric_sample

        usage = result.usage if isinstance(result.usage, dict) else {}
        pt = int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0)
        ct = int(usage.get("completion_tokens") or usage.get("output_tokens") or 0)
        record_metric_sample(
            metric_key="llm.synthesis.complete",
            dimensions={
                "provider": result.provider,
                "model": result.model,
                "role": role,
            },
            value={
                "latency_ms": total_ms,
                "fallback_used": bool(result.fallback_used),
                "ok": bool(result.text) and not result.error,
                "error": (result.error or "")[:240] if result.error else None,
                "prompt_tokens": pt,
                "completion_tokens": ct,
            },
        )
        if result.fallback_used and result.text and not result.error:
            record_governance_event(
                event_type="provider.failover",
                severity="warning",
                user_id=user_id,
                trace_id=trace_id,
                source="llm_synthesis",
                payload={
                    "provider": result.provider,
                    "model": result.model,
                    "role": role,
                    "latency_ms": total_ms,
                },
            )
        if result.error or not result.text:
            record_governance_event(
                event_type="llm.synthesis.failed",
                severity="warning",
                user_id=user_id,
                trace_id=trace_id,
                source="llm_synthesis",
                payload={"provider": result.provider, "model": result.model, "error": result.error},
            )
    except Exception:
        pass

    trace.append(
        {
            "step_type": "llm_provider",
            "ok": bool(result.text) and not result.error,
            "error": result.error,
            "duration_ms": total_ms,
            "tool_name": None,
            "detail": {
                "provider": result.provider,
                "model": result.model,
                "fallback_used": result.fallback_used,
                "usage": result.usage,
                "attempts": attempts,
            },
        }
    )

    if not result.text or result.error:
        warnings.append("LLM_SYNTHESIS_FAILED_USING_TEMPLATE")
        _stream_emit(config, {"phase": "degraded", "snippet": "Synthesis degraded to deterministic template."})
        return template_message, template_reasoning, warnings, trace

    parsed = extract_json_object(result.text)
    if not parsed:
        warnings.append("LLM_SYNTHESIS_JSON_PARSE_FAILED")
        _stream_emit(config, {"phase": "degraded", "snippet": "Model output was not valid JSON; using template."})
        return template_message, template_reasoning, warnings, trace

    validated = validate_copilot_synthesis_payload(parsed)
    if not validated:
        warnings.append("LLM_SYNTHESIS_SCHEMA_INVALID")
        return template_message, template_reasoning, warnings, trace

    msg, reasoning = validated
    _stream_emit(config, {"phase": "complete", "snippet": "Frontier synthesis complete."})
    return msg, reasoning, warnings, trace
