"""LangGraph workflow state machine for conversational UI automation.

The graph resolves a deterministic endpoint-driven workflow template, captures
field values, validates progression, and returns typed frontend actions. It does
not browse, click the DOM, or replace existing product business logic.
"""
from __future__ import annotations

import time
from typing import Any

from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph

from backend.agents.orchestration.postgres_checkpoint import PostgresCheckpointSaver
from backend.agents.schemas.workflow_state import ConversationalWorkflowState
from backend.agents.workflows.templates import (
    field_to_action,
    focus_action,
    get_workflow_template,
    materialize_actions,
    resolve_workflow_template,
    validate_field,
    extract_field_values,
)


def _trace(state: ConversationalWorkflowState, entry: dict[str, Any]) -> list[dict[str, Any]]:
    trace = list(state.get("execution_trace") or [])
    trace.append(entry)
    return trace


def _required_missing(template, fields: dict[str, Any]) -> list[str]:
    return [key for key in template.required_keys if fields.get(key) in (None, "")]


def _ready(template, fields: dict[str, Any], missing: list[str], errors: dict[str, str]) -> bool:
    if missing or errors:
        return False
    if template.ready_requires_any:
        return any(fields.get(key) not in (None, "") for key in template.ready_requires_any)
    return True


async def resolve_template_node(state: ConversationalWorkflowState, *, config: RunnableConfig) -> dict:
    _ = config
    t0 = time.perf_counter()
    incoming = dict(state.get("incoming_state") or {})
    message = str(state.get("user_message") or "")
    role = str(state.get("platform_role") or "")
    current_workflow_id = incoming.get("workflow_id")

    template = get_workflow_template(str(current_workflow_id)) if current_workflow_id else None
    newly_started = False
    if template is None:
        template = resolve_workflow_template(message, role)
        newly_started = template is not None

    if template is None:
        return {
            "status": "unknown",
            "response_message": (
                "I can help with deterministic workflows like creating a property, "
                "investing, paying rent, or claiming rewards."
            ),
            "execution_trace": _trace(
                state,
                {
                    "step_type": "resolve_template",
                    "ok": False,
                    "error": "NO_WORKFLOW_MATCH",
                    "duration_ms": int((time.perf_counter() - t0) * 1000),
                },
            ),
        }

    if role not in template.roles:
        return {
            "workflow_id": template.workflow_id,
            "label": template.label,
            "endpoint": template.endpoint,
            "method": template.method,
            "status": "forbidden",
            "response_message": f"{template.label} is not available from the {role or 'current'} dashboard.",
            "execution_trace": _trace(
                state,
                {
                    "step_type": "resolve_template",
                    "ok": False,
                    "error": "ROLE_FORBIDDEN",
                    "duration_ms": int((time.perf_counter() - t0) * 1000),
                    "detail": {"workflow_id": template.workflow_id, "role": role},
                },
            ),
        }

    return {
        "workflow_id": template.workflow_id,
        "label": template.label,
        "endpoint": template.endpoint,
        "method": template.method,
        "metamask_required": template.metamask_required,
        "success_behavior": template.success_behavior,
        "actions": materialize_actions(template.start_actions, dict(incoming.get("fields") or {})) if newly_started else [],
        "execution_trace": _trace(
            state,
            {
                "step_type": "resolve_template",
                "ok": True,
                "error": None,
                "duration_ms": int((time.perf_counter() - t0) * 1000),
                "detail": {"workflow_id": template.workflow_id, "newly_started": newly_started},
            },
        ),
    }


async def capture_fields_node(state: ConversationalWorkflowState, *, config: RunnableConfig) -> dict:
    _ = config
    t0 = time.perf_counter()
    template = get_workflow_template(state.get("workflow_id"))
    if template is None or state.get("status") in {"unknown", "forbidden"}:
        return {}

    incoming = dict(state.get("incoming_state") or {})
    existing_fields = dict(incoming.get("fields") or {})
    active_field = incoming.get("active_field")
    allow_active_capture = bool(incoming.get("workflow_id") == template.workflow_id)
    extracted = extract_field_values(
        template,
        str(state.get("user_message") or ""),
        active_field=str(active_field) if active_field else None,
        allow_active_capture=allow_active_capture,
    )
    if template.field("property_id") and "property_id" not in extracted:
        resolved_property_id = _resolve_property_id_from_message(
            config.get("configurable", {}).get("orchestration_db"),
            str(state.get("user_message") or ""),
        )
        if resolved_property_id is not None:
            extracted["property_id"] = str(resolved_property_id)

    fields = dict(existing_fields)
    errors: dict[str, str] = {}
    actions = list(state.get("actions") or [])
    for key, raw in extracted.items():
        field = template.field(key)
        if not field:
            continue
        ok, error, normalized = validate_field(field, raw)
        if not ok:
            errors[key] = error or "Invalid value."
            continue
        fields[key] = normalized
        action = field_to_action(field, normalized)
        if action:
            actions.append(action)

    # Re-validate existing values so stale client state cannot mark a workflow ready.
    for key, value in list(fields.items()):
        field = template.field(key)
        if not field:
            continue
        ok, error, normalized = validate_field(field, value)
        if ok:
            fields[key] = normalized
        else:
            fields.pop(key, None)
            errors[key] = error or "Invalid value."

    missing = _required_missing(template, fields)
    next_field_key = missing[0] if missing else None
    next_field = template.field(next_field_key) if next_field_key else None
    if next_field:
        focus = focus_action(next_field)
        if focus:
            actions.append(focus)

    # When a property id arrives after the first turn, materialize any modal open
    # action that was waiting for that id.
    if "property_id" in extracted:
        actions.extend(materialize_actions(template.start_actions, fields))

    return {
        "fields": fields,
        "validation_errors": errors,
        "missing_fields": missing,
        "active_field": next_field_key,
        "actions": actions,
        "execution_trace": _trace(
            state,
            {
                "step_type": "capture_fields",
                "ok": not errors,
                "error": "; ".join(errors.values()) or None,
                "duration_ms": int((time.perf_counter() - t0) * 1000),
                "detail": {"captured": sorted(extracted.keys()), "missing": missing},
            },
        ),
    }


async def plan_response_node(state: ConversationalWorkflowState, *, config: RunnableConfig) -> dict:
    _ = config
    t0 = time.perf_counter()
    template = get_workflow_template(state.get("workflow_id"))
    if template is None or state.get("status") in {"unknown", "forbidden"}:
        return {}

    fields = dict(state.get("fields") or {})
    errors = dict(state.get("validation_errors") or {})
    missing = list(state.get("missing_fields") or [])
    active_key = state.get("active_field")
    active = template.field(active_key) if active_key else None
    actions = list(state.get("actions") or [])

    if errors:
        first_key = next(iter(errors.keys()))
        field = template.field(first_key)
        return {
            "status": "awaiting_fields",
            "active_field": first_key,
            "question": field.question if field else None,
            "response_message": f"{errors[first_key]} {field.question if field else 'Please try again.'}",
            "execution_actions": [],
            "execution_trace": _trace(
                state,
                {
                    "step_type": "plan_response",
                    "ok": False,
                    "error": "VALIDATION_ERROR",
                    "duration_ms": int((time.perf_counter() - t0) * 1000),
                },
            ),
        }

    is_ready = _ready(template, fields, missing, errors)
    if is_ready:
        exec_actions = materialize_actions(template.execution_actions, fields)
        message = (
            "Ready. I will run the existing workflow now"
            + (" and open MetaMask for your final approval." if template.metamask_required else ".")
        )
        return {
            "status": "ready",
            "question": None,
            "active_field": None,
            "actions": actions,
            "execution_actions": exec_actions,
            "response_message": message,
            "execution_trace": _trace(
                state,
                {
                    "step_type": "plan_response",
                    "ok": True,
                    "error": None,
                    "duration_ms": int((time.perf_counter() - t0) * 1000),
                    "detail": {"ready": True},
                },
            ),
        }

    if template.ready_requires_any and not missing:
        message = (
            "Which field should I update? You can give me a new name, location, "
            "total value, token supply, symbol, or monthly rent."
        )
        return {
            "status": "awaiting_fields",
            "question": message,
            "active_field": None,
            "response_message": message,
            "execution_actions": [],
            "execution_trace": _trace(
                state,
                {
                    "step_type": "plan_response",
                    "ok": True,
                    "error": None,
                    "duration_ms": int((time.perf_counter() - t0) * 1000),
                    "detail": {"ready": False, "needs_any_update": True},
                },
            ),
        }

    question = active.question if active else "What should I fill next?"
    return {
        "status": "awaiting_fields",
        "question": question,
        "response_message": question,
        "execution_actions": [],
        "execution_trace": _trace(
            state,
            {
                "step_type": "plan_response",
                "ok": True,
                "error": None,
                "duration_ms": int((time.perf_counter() - t0) * 1000),
                "detail": {"ready": False, "active_field": active_key},
            },
        ),
    }


_compiled = None


def build_conversational_workflow_graph():
    global _compiled
    if _compiled is None:
        builder = StateGraph(ConversationalWorkflowState)
        builder.add_node("resolve_template", resolve_template_node)
        builder.add_node("capture_fields", capture_fields_node)
        builder.add_node("plan_response", plan_response_node)
        builder.add_edge(START, "resolve_template")
        builder.add_edge("resolve_template", "capture_fields")
        builder.add_edge("capture_fields", "plan_response")
        builder.add_edge("plan_response", END)
        _compiled = builder.compile(checkpointer=PostgresCheckpointSaver())
    return _compiled


def _resolve_property_id_from_message(db: Any, message: str) -> int | None:
    if db is None or not message.strip():
        return None
    q = " ".join(message.lower().split())
    cur = db.cursor(dictionary=True)
    try:
        cur.execute(
            "SELECT id, name, location FROM properties "
            "WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY LENGTH(name) DESC LIMIT 200"
        )
        rows = cur.fetchall()
    finally:
        cur.close()
    for row in rows:
        name = " ".join(str(row.get("name") or "").lower().split())
        if name and name in q:
            return int(row["id"])
    return None
