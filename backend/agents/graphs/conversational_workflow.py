"""LangGraph workflow state machine for conversational UI automation.

The graph resolves a deterministic endpoint-driven workflow template, captures
field values, validates progression, and returns typed frontend actions. It does
not browse, click the DOM, or replace existing product business logic.
"""
from __future__ import annotations

import re
import time
from typing import Any

from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph

from backend.agents.orchestration.postgres_checkpoint import PostgresCheckpointSaver
from backend.agents.schemas.workflow_state import ConversationalWorkflowState
from backend.agents.workflows.intent_router import collapse_intent_fillers
from backend.agents.workflows.templates import (
    field_to_action,
    focus_action,
    get_workflow_template,
    materialize_actions,
    resolve_workflow_template,
    validate_field,
    extract_field_values,
)


def _sanitize_user_message(text: str) -> str:
    """Normalize UX paste / STT quirks (BOM, zero-width spaces)."""
    s = str(text or "")
    for ch in ("\ufeff", "\u200b", "\u200c", "\u200d", "\u2060"):
        s = s.replace(ch, "")
    return re.sub(r"\s+", " ", s).strip()


def _is_greeting_turn(message: str) -> bool:
    """Short hello/hi so we respond socially instead of only ``unknown`` boilerplate."""
    collapsed = collapse_intent_fillers(_sanitize_user_message(message))
    if not collapsed:
        return False
    first = collapsed.split()[0]
    if first not in {"hello", "hi", "hey", "howdy", "greetings", "good"}:
        return False
    if first == "good" and not re.match(r"^good\s+(morning|afternoon|evening)\b", collapsed):
        return False
    return len(collapsed.split()) <= 5


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
    message = _sanitize_user_message(str(state.get("user_message") or ""))
    role = str(state.get("platform_role") or "").strip().lower()
    raw_wid = incoming.get("workflow_id")
    current_workflow_id = raw_wid if raw_wid not in (None, "") else None
    checkpoint_wid = state.get("workflow_id") if state.get("workflow_id") not in (None, "") else None
    in_active_session = bool(current_workflow_id or checkpoint_wid)

    template = get_workflow_template(str(current_workflow_id)) if current_workflow_id else None
    newly_started = False
    if template is None:
        template = resolve_workflow_template(message, role)
        newly_started = template is not None

    if template is None:
        if _is_greeting_turn(message) and not in_active_session:
            return {
                "status": "idle",
                "workflow_id": None,
                "label": None,
                "endpoint": None,
                "method": None,
                "metamask_required": False,
                "success_behavior": None,
                "fields": {},
                "missing_fields": [],
                "active_field": None,
                "validation_errors": {},
                "actions": [],
                "execution_actions": [],
                "question": None,
                "response_message": (
                    "Hi there! I'm your workflow assistant. "
                    "Tell me what you'd like to do — for example: create a new property, invest, pay rent, or claim rewards."
                ),
                "execution_trace": _trace(
                    state,
                    {
                        "step_type": "resolve_template",
                        "ok": False,
                        "error": "GREETING_SMALLTALK",
                        "duration_ms": int((time.perf_counter() - t0) * 1000),
                    },
                ),
            }
        # Clear stale checkpoint workflow so UI cannot show "Running" while intent failed.
        return {
            "status": "unknown",
            "workflow_id": None,
            "label": None,
            "endpoint": None,
            "method": None,
            "metamask_required": False,
            "success_behavior": None,
            "fields": {},
            "missing_fields": [],
            "active_field": None,
            "validation_errors": {},
            "actions": [],
            "execution_actions": [],
            "question": None,
            "response_message": (
                "No executable workflow matched. Try a concrete task — for example: "
                "\"create a new property\", \"invest\", \"pay rent\", or \"claim rewards\"."
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
            "workflow_id": None,
            "label": None,
            "endpoint": None,
            "method": None,
            "metamask_required": False,
            "success_behavior": None,
            "fields": {},
            "missing_fields": [],
            "active_field": None,
            "validation_errors": {},
            "actions": [],
            "execution_actions": [],
            "question": None,
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
    t0 = time.perf_counter()
    template = get_workflow_template(state.get("workflow_id"))
    if template is None or state.get("status") in {"unknown", "forbidden"}:
        return {}

    incoming = dict(state.get("incoming_state") or {})
    checkpoint_fields = dict(state.get("fields") or {})
    incoming_fields = dict(incoming.get("fields") or {})
    existing_fields = {**checkpoint_fields, **incoming_fields}

    active_field = incoming.get("active_field")
    if active_field in (None, ""):
        active_field = state.get("active_field")
    active_field = str(active_field).strip() if active_field else None

    # Prefer resolved graph workflow id — client snapshot alone was missing workflow_id after merges.
    allow_active_capture = bool(state.get("workflow_id") == template.workflow_id)
    extracted = extract_field_values(
        template,
        _sanitize_user_message(str(state.get("user_message") or "")),
        active_field=str(active_field) if active_field else None,
        allow_active_capture=allow_active_capture,
    )
    if template.field("property_id") and "property_id" not in extracted:
        resolved_property_id = _resolve_property_id_from_message(
            config.get("configurable", {}).get("orchestration_db"),
            _sanitize_user_message(str(state.get("user_message") or "")),
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


def _compact_alphanumeric(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


def _fetch_property_name(db: Any, property_id: str | int | None) -> str | None:
    if db is None or property_id in (None, ""):
        return None
    try:
        pid = int(property_id)
    except (TypeError, ValueError):
        return None
    cur = db.cursor(dictionary=True)
    try:
        cur.execute(
            "SELECT name FROM properties WHERE id = %s AND COALESCE(is_active, TRUE) = TRUE LIMIT 1",
            (pid,),
        )
        row = cur.fetchone()
        return str(row["name"]) if row and row.get("name") is not None else None
    finally:
        cur.close()


def _just_started_workflow(state: ConversationalWorkflowState) -> bool:
    trace = state.get("execution_trace") or []
    for entry in reversed(trace):
        if entry.get("step_type") == "resolve_template":
            return bool((entry.get("detail") or {}).get("newly_started"))
    return False


def _property_resolved_this_turn(state: ConversationalWorkflowState) -> bool:
    trace = state.get("execution_trace") or []
    if not trace:
        return False
    last = trace[-1]
    if last.get("step_type") != "capture_fields":
        return False
    captured = (last.get("detail") or {}).get("captured") or []
    return "property_id" in captured


def _workflow_opening_line(workflow_id: str | None) -> str | None:
    if not workflow_id:
        return None
    lines = {
        "CREATE_PROPERTY_WORKFLOW": "Opening your Properties page and the create listing form.",
        "INVEST_WORKFLOW": "Starting investment setup.",
        "PAY_RENT_WORKFLOW": "Starting rent payment.",
        "CLAIM_REWARDS_WORKFLOW": "Opening yield rewards.",
        "EDIT_PROPERTY_WORKFLOW": "Opening property edit.",
    }
    return lines.get(workflow_id)


def _prepend_voice_lead(base: str, lead: str) -> str:
    if not lead:
        return base
    return f"{lead.strip()} {base}".strip()


def _awaiting_voice_lead(state: ConversationalWorkflowState, template, fields: dict[str, Any], db: Any) -> str:
    parts: list[str] = []
    opener = _workflow_opening_line(template.workflow_id)
    if _just_started_workflow(state) and opener:
        parts.append(opener)
    if _property_resolved_this_turn(state):
        pid = fields.get("property_id")
        pname = _fetch_property_name(db, pid)
        label = f"«{pname}»" if pname else (f"#{pid}" if pid else "that listing")
        parts.append(f"I matched that to {label}.")
    return " ".join(parts).strip()


def _ready_voice_parts(template, fields: dict[str, Any], db: Any, state: ConversationalWorkflowState) -> list[str]:
    parts: list[str] = []
    if _just_started_workflow(state):
        opener = _workflow_opening_line(template.workflow_id)
        if opener:
            parts.append(opener)
    wf = template.workflow_id
    pname = _fetch_property_name(db, fields.get("property_id"))
    pid = fields.get("property_id")
    prop = f" in {pname}" if pname else (f" for property #{pid}" if pid else "")
    if wf == "INVEST_WORKFLOW":
        parts.append(f"Initiating investment{prop}.")
    elif wf == "PAY_RENT_WORKFLOW":
        parts.append(f"Recording rent payment{prop}.")
    elif wf == "CLAIM_REWARDS_WORKFLOW":
        parts.append(f"Claiming rewards{prop}.")
    elif wf == "CREATE_PROPERTY_WORKFLOW":
        parts.append("Submitting your new listing.")
    elif wf == "EDIT_PROPERTY_WORKFLOW":
        parts.append(f"Saving property updates{prop}.")
    return parts


async def plan_response_node(state: ConversationalWorkflowState, *, config: RunnableConfig) -> dict:
    t0 = time.perf_counter()
    template = get_workflow_template(state.get("workflow_id"))
    if template is None or state.get("status") in {"unknown", "forbidden"}:
        return {}

    db = config.get("configurable", {}).get("orchestration_db")
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
            "actions": actions,
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
        if template.method == "NAVIGATE" and not exec_actions:
            message = f"Opening {template.label.lower()}."
        else:
            message = (
                "Ready. I will run the existing workflow now"
                + (" and open MetaMask for your final approval." if template.metamask_required else ".")
            )
        message = _prepend_voice_lead(message, " ".join(_ready_voice_parts(template, fields, db, state)).strip())
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
        message = _prepend_voice_lead(message, _awaiting_voice_lead(state, template, fields, db))
        return {
            "status": "awaiting_fields",
            "question": message,
            "active_field": None,
            "response_message": message,
            "actions": actions,
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
    message = _prepend_voice_lead(question, _awaiting_voice_lead(state, template, fields, db))
    return {
        "status": "awaiting_fields",
        "question": message,
        "response_message": message,
        "actions": actions,
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
    """Match property name / location against transcript text.

    Speech-to-text often inserts spaces inside compound names (``Azureview`` → ``Azure view``).
    We compare both spaced normalization and digit-letter compaction so substring checks survive.
    """
    if db is None or not message.strip():
        return None
    q_norm = " ".join(message.lower().split())
    q_compact = _compact_alphanumeric(message)
    cur = db.cursor(dictionary=True)
    try:
        cur.execute(
            "SELECT id, name, location FROM properties "
            "WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY LENGTH(name) DESC LIMIT 200"
        )
        rows = cur.fetchall()
    finally:
        cur.close()
    min_compact = 4
    min_query_for_reverse = 6  # avoid matching tiny STT fragments inside long names
    for row in rows:
        raw_name = str(row.get("name") or "")
        name_norm = " ".join(raw_name.lower().split())
        name_compact = _compact_alphanumeric(raw_name)
        if len(name_norm) >= 2 and name_norm and name_norm in q_norm:
            return int(row["id"])
        if len(name_compact) >= min_compact and q_compact:
            if name_compact in q_compact:
                return int(row["id"])
            if len(q_compact) >= min_query_for_reverse and q_compact in name_compact:
                return int(row["id"])

        raw_loc = str(row.get("location") or "")
        loc_norm = " ".join(raw_loc.lower().split())
        loc_compact = _compact_alphanumeric(raw_loc)
        if len(loc_norm) >= 3 and loc_norm and loc_norm in q_norm:
            return int(row["id"])
        if len(loc_compact) >= min_compact and q_compact:
            if loc_compact in q_compact:
                return int(row["id"])
            if len(q_compact) >= min_query_for_reverse and q_compact in loc_compact:
                return int(row["id"])
    return None
