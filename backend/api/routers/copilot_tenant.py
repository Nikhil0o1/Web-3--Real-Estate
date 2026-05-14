"""Tenant AI Copilot — conversational orchestration (Phase 5)."""
from __future__ import annotations

from typing import Any, AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse

from backend.agents.config.settings import get_ai_settings
from backend.agents.context.session import context_from_auth_user
from backend.agents.memory.postgres import PostgresAgentMemoryStore
from backend.agents.observability.logging import new_trace_id
from backend.agents.orchestrator.service import get_orchestration_service
from backend.agents.schemas.copilot import (
    InvestorCopilotChatRequest,
    InvestorCopilotChatResponse,
    InvestorCopilotStructuredResponse,
)
from backend.agents.streaming.emitter import format_sse
from backend.agents.streaming.buffer_helper import buffer_sse
from backend.api.deps import get_db, require_tenant
from backend.services.auth import AuthUser, canonical_role

router = APIRouter(prefix="/copilot/tenant", tags=["tenant-copilot"])


def _thread_owned(db, *, thread_id: int, user_id: int) -> bool:
    cur = db.cursor()
    try:
        cur.execute(
            "SELECT 1 FROM agent_orchestration_threads WHERE id = %s AND user_id = %s",
            (thread_id, user_id),
        )
        return cur.fetchone() is not None
    finally:
        cur.close()


@router.post("/chat", response_model=InvestorCopilotChatResponse)
async def tenant_copilot_chat(
    body: InvestorCopilotChatRequest,
    user: AuthUser = Depends(require_tenant),
    db=Depends(get_db),
):
    if not get_ai_settings().orchestration_enabled:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Orchestration disabled")
    trace = new_trace_id()
    ctx = context_from_auth_user(user, trace_id=trace)
    store = PostgresAgentMemoryStore(db)
    role = canonical_role(user.role)
    if body.thread_id is not None:
        if not _thread_owned(db, thread_id=body.thread_id, user_id=int(user.id)):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")
        tid = int(body.thread_id)
    else:
        title = body.title or (body.message[:120] + ("…" if len(body.message) > 120 else ""))
        tid = store.create_thread(
            user_id=int(user.id),
            wallet_address=str(user.wallet_address),
            platform_role=role,
            title=title,
            metadata={"source": "tenant_copilot", "trace_id": trace},
        )
    store.append_message(thread_id=tid, author="user", content=body.message, event_payload={"trace_id": trace})
    tail = store.list_messages(thread_id=tid, limit=40)
    raw = await get_orchestration_service().tenant_copilot_turn(
        ctx,
        db,
        user_message=body.message,
        memory_thread_id=tid,
        memory_tail=tail,
    )
    if raw.get("disabled"):
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Orchestration disabled")
    structured_dict = raw.get("structured_response") or {}
    try:
        structured = InvestorCopilotStructuredResponse.model_validate(structured_dict)
    except Exception:
        structured = InvestorCopilotStructuredResponse(
            message="The copilot could not assemble a structured response for this turn.",
            reasoning_summary="",
            warnings=["STRUCTURED_RESPONSE_INVALID"],
            intent="tenant_overview",
        )
    store.append_message(
        thread_id=tid,
        author="assistant",
        content=structured.message,
        event_payload={
            "kind": "tenant_copilot",
            "trace_id": trace,
            "intent": structured.intent,
            "tool_count": len(structured.tool_results),
            "has_prepared_tx": bool(structured.prepared_transactions),
        },
    )
    return InvestorCopilotChatResponse(trace_id=trace, thread_id=tid, structured=structured)


async def _sse_tenant_copilot(
    *,
    body: InvestorCopilotChatRequest,
    user: AuthUser,
    db: Any,
) -> AsyncIterator[str]:
    trace = new_trace_id()
    ctx = context_from_auth_user(user, trace_id=trace)
    store = PostgresAgentMemoryStore(db)
    role = canonical_role(user.role)
    start_payload = {"phase": "start", "trace_id": trace}
    yield format_sse(start_payload, event="lifecycle")
    await buffer_sse(trace_id=trace, event="lifecycle", payload=start_payload)
    if body.thread_id is not None:
        if not _thread_owned(db, thread_id=body.thread_id, user_id=int(user.id)):
            yield format_sse({"error": "thread_not_found"}, event="error")
            yield format_sse({"phase": "end", "trace_id": trace}, event="lifecycle")
            return
        tid = int(body.thread_id)
    else:
        title = body.title or (body.message[:120] + ("…" if len(body.message) > 120 else ""))
        tid = store.create_thread(
            user_id=int(user.id),
            wallet_address=str(user.wallet_address),
            platform_role=role,
            title=title,
            metadata={"source": "tenant_copilot_stream", "trace_id": trace},
        )
    store.append_message(thread_id=tid, author="user", content=body.message, event_payload={"trace_id": trace})
    tail = store.list_messages(thread_id=tid, limit=40)
    svc = get_orchestration_service()
    final_structured: dict[str, Any] | None = None
    async for ev in svc.tenant_copilot_stream(
        ctx,
        db,
        user_message=body.message,
        memory_thread_id=tid,
        memory_tail=tail,
    ):
        yield format_sse(ev, event="orchestration")
        await buffer_sse(trace_id=trace, event="orchestration", payload=ev if isinstance(ev, dict) else {"payload": str(ev)})
        if ev.get("stream_kind") == "cognition":
            ck = ev.get("chunk")
            if isinstance(ck, dict):
                snip = str(ck.get("snippet") or "")
                ph = str(ck.get("phase") or "cognition")
                if snip:
                    prog = {"progress_line": f"{ph}: {snip}"[:500], "trace_id": trace}
                    yield format_sse(prog, event="progress")
                    await buffer_sse(trace_id=trace, event="progress", payload=prog)
            continue
        ch = ev.get("chunk")
        if isinstance(ch, dict):
            for delta in ch.values():
                if isinstance(delta, dict) and delta.get("structured_response"):
                    final_structured = delta["structured_response"]
                if isinstance(delta, dict) and delta.get("stream_progress"):
                    sp = delta["stream_progress"]
                    if isinstance(sp, list) and sp:
                        prog = {"progress_line": sp[-1], "trace_id": trace}
                        yield format_sse(prog, event="progress")
                        await buffer_sse(trace_id=trace, event="progress", payload=prog)
    if final_structured:
        try:
            structured = InvestorCopilotStructuredResponse.model_validate(final_structured)
        except Exception:
            structured = None
        if structured:
            store.append_message(
                thread_id=tid,
                author="assistant",
                content=structured.message,
                event_payload={
                    "kind": "tenant_copilot",
                    "trace_id": trace,
                    "intent": structured.intent,
                    "tool_count": len(structured.tool_results),
                    "has_prepared_tx": bool(structured.prepared_transactions),
                },
            )
            yield format_sse(structured.model_dump(mode="json"), event="final")
            await buffer_sse(trace_id=trace, event="final", payload={"ok": True, "intent": structured.intent})
    end_payload = {"phase": "end", "trace_id": trace, "thread_id": tid}
    yield format_sse(end_payload, event="lifecycle")
    await buffer_sse(trace_id=trace, event="lifecycle", payload=end_payload)


@router.post("/chat/stream")
async def tenant_copilot_chat_stream(
    body: InvestorCopilotChatRequest,
    user: AuthUser = Depends(require_tenant),
    db=Depends(get_db),
):
    if not get_ai_settings().orchestration_enabled:

        async def _off():
            yield format_sse({"disabled": True}, event="lifecycle")

        return StreamingResponse(_off(), media_type="text/event-stream")

    gen = _sse_tenant_copilot(body=body, user=user, db=db)
    return StreamingResponse(gen, media_type="text/event-stream")
