"""AI orchestration API — infrastructure (Phase 1) + intelligence tools (Phase 2)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse

from backend.agents.config.settings import get_ai_settings
from backend.agents.context.role_router import tool_categories_for_role
from backend.agents.context.session import context_from_auth_user
from backend.agents.flows.investor_preview import (
    run_investor_intel_preview,
    run_roi_analysis_flow,
    run_tx_prep_probe_flow,
)
from backend.agents.memory.postgres import PostgresAgentMemoryStore
from backend.agents.orchestration.results import extract_last_tool_result
from backend.agents.observability.logging import get_agent_logger, log_analytics_event, new_trace_id
from backend.agents.prompts.context_builders import build_prompt_context_for_role
from backend.agents.schemas.api import (
    AgentHealthResponse,
    AgentMemoryThreadCreate,
    AgentMemoryThreadRead,
    AgentOrchestrationPingRequest,
    AgentOrchestrationPingResponse,
    AgentRoiFlowRequest,
    AgentRuntimeStatusResponse,
    AgentToolExecuteRequest,
)
from backend.agents.orchestrator.service import get_orchestration_service
from backend.agents.streaming.emitter import stream_agent_test_events, stream_orchestration_run
from backend.config.settings import REDIS_URL, STREAM_REDIS_BUFFER
from backend.infra.stream_buffer import read_stream_buffer
from backend.api.deps import get_current_user, get_db, get_optional_user
from backend.api.routers.autonomous_intel import router as autonomous_intel_router
from backend.api.routers.copilot_investor import router as copilot_investor_router
from backend.api.routers.copilot_property_owner import router as copilot_property_owner_router
from backend.api.routers.copilot_tenant import router as copilot_tenant_router
from backend.api.routers.governance_console import router as governance_console_router
from backend.services.auth import AuthUser, canonical_role

router = APIRouter(prefix="/api/agents", tags=["agents"])
router.include_router(copilot_investor_router)
router.include_router(copilot_property_owner_router)
router.include_router(copilot_tenant_router)
router.include_router(autonomous_intel_router)
router.include_router(governance_console_router)
_AGENTS_API_LOG = get_agent_logger("api.agents")


@router.get("/health", response_model=AgentHealthResponse)
def agents_health(db=Depends(get_db)):
    svc = get_orchestration_service()
    components = svc.health_components(db)
    overall = "ok" if all(v == "ok" for v in components.values()) else "degraded"
    return AgentHealthResponse(status=overall, components=components)


@router.get("/runtime/status", response_model=AgentRuntimeStatusResponse)
def agents_runtime_status(user: AuthUser | None = Depends(get_optional_user)):
    payload = get_orchestration_service().runtime_status()
    if user:
        payload["authenticated"] = True
        payload["platform_role"] = canonical_role(user.role)
    else:
        payload["authenticated"] = False
        payload["platform_role"] = None
    return AgentRuntimeStatusResponse(**payload)


@router.get("/me/context")
def agents_me_context(user: AuthUser = Depends(get_current_user)):
    trace = new_trace_id()
    ctx = context_from_auth_user(user, trace_id=trace)
    role = ctx.platform_role
    return {
        "trace_id": ctx.trace_id,
        "wallet_address": ctx.wallet_address,
        "platform_role": role,
        "user_id": ctx.user_id,
        "routing": "unified_orchestration_v2",
        "tool_category_hints": tool_categories_for_role(role),
    }


@router.post("/orchestration/ping", response_model=AgentOrchestrationPingResponse)
async def agents_orchestration_ping(
    body: AgentOrchestrationPingRequest,
    user: AuthUser = Depends(get_current_user),
    db=Depends(get_db),
):
    svc = get_orchestration_service()
    if not get_ai_settings().orchestration_enabled:
        trace = new_trace_id()
        return AgentOrchestrationPingResponse(
            trace_id=trace,
            graph_profile="disabled",
            messages=[],
            tool_results=[],
            policy_error=None,
            graph_thread_id=None,
        )
    trace = new_trace_id()
    ctx = context_from_auth_user(user, trace_id=trace, dashboard_surface=body.dashboard_surface)
    out = await svc.ping(
        ctx,
        dashboard_surface=body.dashboard_surface,
        db=db,
        graph_thread_id=body.graph_thread_id,
        memory_thread_id=body.memory_thread_id,
    )
    return AgentOrchestrationPingResponse(
        trace_id=trace,
        graph_profile=str(out.get("graph_profile", "")),
        messages=list(out.get("messages", [])),
        tool_results=list(out.get("tool_results", [])),
        policy_error=out.get("policy_error"),
        graph_thread_id=out.get("graph_thread_id"),
    )


@router.get("/stream/orchestration")
async def agents_stream_orchestration(
    user: AuthUser = Depends(get_current_user),
    db=Depends(get_db),
    graph_thread_id: str | None = None,
    memory_thread_id: int | None = None,
):
    from backend.agents.streaming.emitter import format_sse

    if not get_ai_settings().orchestration_enabled:

        async def _disabled():
            trace = new_trace_id()
            yield format_sse({"disabled": True, "trace_id": trace}, event="lifecycle")

        return StreamingResponse(_disabled(), media_type="text/event-stream")

    trace = new_trace_id()
    ctx = context_from_auth_user(user, trace_id=trace)
    gen = stream_orchestration_run(
        ctx=ctx,
        db=db,
        trace_id=trace,
        dashboard_surface=None,
        graph_thread_id=graph_thread_id,
        memory_thread_id=memory_thread_id,
    )
    return StreamingResponse(gen, media_type="text/event-stream")


@router.get("/stream/replay")
def agents_stream_replay(
    trace_id: str,
    user: AuthUser = Depends(get_current_user),
    db=Depends(get_db),
    limit: int = 200,
):
    """Return optional Redis-backed replay chunks when enabled; otherwise empty (live SSE is unchanged)."""
    tid = (trace_id or "").strip()
    if not tid:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="trace_id is required")
    cur = db.cursor()
    try:
        cur.execute(
            "SELECT id FROM agent_orchestration_runs WHERE trace_id = %s AND user_id = %s LIMIT 1",
            (tid, int(user.id)),
        )
        if not cur.fetchone():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Replay not available for this trace")
    finally:
        cur.close()
    events = read_stream_buffer(trace_id=tid, limit=limit)
    replay_on = bool(STREAM_REDIS_BUFFER and REDIS_URL)
    return {
        "trace_id": tid,
        "events": events,
        "count": len(events),
        "replay_buffer": "redis" if replay_on else "none",
    }


@router.get("/stream/ping")
async def agents_stream_ping(user: AuthUser = Depends(get_current_user)):
    trace = new_trace_id()
    gen = stream_agent_test_events(
        trace_id=trace,
        wallet=user.wallet_address,
        role=canonical_role(user.role),
    )
    return StreamingResponse(gen, media_type="text/event-stream")


@router.post("/memory/threads", response_model=dict)
def agents_create_memory_thread(
    body: AgentMemoryThreadCreate,
    user: AuthUser = Depends(get_current_user),
    db=Depends(get_db),
):
    store = PostgresAgentMemoryStore(db)
    thread_id = store.create_thread(
        user_id=user.id,
        wallet_address=user.wallet_address,
        platform_role=canonical_role(user.role),
        title=body.title,
        metadata={"source": "api.agents.memory.threads"},
    )
    return {"thread_id": thread_id}


@router.get("/memory/threads", response_model=list[AgentMemoryThreadRead])
def agents_list_memory_threads(user: AuthUser = Depends(get_current_user), db=Depends(get_db)):
    store = PostgresAgentMemoryStore(db)
    rows = store.list_threads_for_user(user_id=user.id, limit=20)
    return [AgentMemoryThreadRead(**r) for r in rows]


@router.get("/tools/registry")
def agents_tool_registry(user: AuthUser = Depends(get_current_user)):
    _ = user
    from backend.agents.tools.registry import get_tool_registry

    return {"tools": get_tool_registry().list_metadata()}


@router.get("/tools/available")
def agents_tools_available(user: AuthUser = Depends(get_current_user)):
    from backend.agents.tools.registry import get_tool_registry

    role = canonical_role(user.role)
    return {"platform_role": role, "tools": get_tool_registry().list_metadata_for_role(role)}


@router.post("/tools/execute", response_model=dict)
async def agents_tool_execute(
    body: AgentToolExecuteRequest,
    user: AuthUser = Depends(get_current_user),
    db=Depends(get_db),
):
    trace = new_trace_id()
    ctx = context_from_auth_user(user, trace_id=trace)
    log_analytics_event(
        _AGENTS_API_LOG,
        "tool_execute_request",
        trace_id=trace,
        extra={"tool": body.tool, "role": ctx.platform_role},
    )
    out = await get_orchestration_service().execute_tool_via_graph(
        ctx,
        db,
        body.tool,
        body.arguments,
        graph_thread_id=body.graph_thread_id,
        memory_thread_id=body.memory_thread_id,
    )
    res = extract_last_tool_result(out)
    return {"trace_id": trace, "ok": res.ok, "error": res.error, "data": res.data}


@router.get("/prompt-context")
def agents_prompt_context(user: AuthUser = Depends(get_current_user), db=Depends(get_db)):
    cur = db.cursor(dictionary=True)
    try:
        bundle = build_prompt_context_for_role(
            cur,
            user_id=int(user.id),
            wallet_address=str(user.wallet_address),
            platform_role=canonical_role(user.role),
        )
        return {"platform_role": canonical_role(user.role), "context": bundle}
    finally:
        cur.close()


@router.get("/flows/investor-preview")
async def agents_flow_investor_preview(user: AuthUser = Depends(get_current_user), db=Depends(get_db)):
    trace = new_trace_id()
    ctx = context_from_auth_user(user, trace_id=trace)
    log_analytics_event(_AGENTS_API_LOG, "flow_investor_preview", trace_id=trace, extra={"role": ctx.platform_role})
    return await run_investor_intel_preview(db, ctx)


@router.post("/flows/roi-preview", response_model=dict)
async def agents_flow_roi_preview(
    body: AgentRoiFlowRequest,
    user: AuthUser = Depends(get_current_user),
    db=Depends(get_db),
):
    trace = new_trace_id()
    ctx = context_from_auth_user(user, trace_id=trace)
    log_analytics_event(_AGENTS_API_LOG, "flow_roi_preview", trace_id=trace, extra={"n": len(body.property_ids)})
    return await run_roi_analysis_flow(db, ctx, body.property_ids)


@router.get("/flows/tx-prep-probe")
async def agents_flow_tx_prep_probe(user: AuthUser = Depends(get_current_user), db=Depends(get_db)):
    trace = new_trace_id()
    ctx = context_from_auth_user(user, trace_id=trace)
    return await run_tx_prep_probe_flow(db, ctx)


@router.post("/memory/threads/{thread_id}/messages")
def agents_append_memory_message(
    thread_id: int,
    db=Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Append a single audit row (foundation test); not a full chat API."""
    store = PostgresAgentMemoryStore(db)
    cur = db.cursor()
    try:
        cur.execute(
            "SELECT id FROM agent_orchestration_threads WHERE id = %s AND user_id = %s",
            (thread_id, user.id),
        )
        if not cur.fetchone():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")
    finally:
        cur.close()
    msg_id = store.append_message(
        thread_id=thread_id,
        author="system",
        content="foundation_message_stub",
        event_payload={"kind": "orchestration.test"},
    )
    return {"message_id": msg_id}
