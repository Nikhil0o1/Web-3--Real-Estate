"""LLM agent loop — LangGraph StateGraph with tool calling, Postgres persistence,
human-in-the-loop interrupts, LangSmith tracing, retry with backoff, and parallel
tool execution.

Graph structure:
    call_model ──(tool_calls?)──► [conditional]
                                    │
                    high-stakes? ──► human_approval ──► END
                                    │
                    low-stakes  ──► call_tools ──► call_model
                                    │
                    no tools    ──► END
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any, Literal

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from backend.ai.config import get_settings
from backend.ai.prompts import system_prompt_for_role
from backend.ai.schemas import AgentAction, ChatMessage, ChatResponse, InterruptResponse
from backend.ai.tools import dispatch, openai_tool_schemas
from backend.services.auth import AuthUser, canonical_role

LOGGER = logging.getLogger(__name__)

# Tools that trigger MetaMask transactions — require explicit user confirmation.
_HIGH_STAKES_TOOLS = frozenset({
    "start_invest",
    "start_pay_rent",
    "start_claim_rewards",
    "start_create_property",
})


class AIDisabledError(RuntimeError):
    """Raised when AI features are requested but not configured."""


# ──────────────────────────────────────────────────────────────
# State definition
# ──────────────────────────────────────────────────────────────
class AgentState(dict):
    """LangGraph state — a thin dict so we don't need typed dicts for compatibility."""

    @property
    def messages(self) -> list[BaseMessage]:
        return self.get("messages", [])

    @messages.setter
    def messages(self, value: list[BaseMessage]) -> None:
        self["messages"] = value

    @property
    def actions(self) -> list[AgentAction]:
        return self.get("actions", [])

    @actions.setter
    def actions(self, value: list[AgentAction]) -> None:
        self["actions"] = value

    @property
    def interrupt(self) -> dict | None:
        return self.get("interrupt")

    @interrupt.setter
    def interrupt(self, value: dict | None) -> None:
        self["interrupt"] = value

    @property
    def approval(self) -> str | None:
        return self.get("approval")

    @approval.setter
    def approval(self, value: str | None) -> None:
        self["approval"] = value


# ──────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────

def _setup_langsmith() -> None:
    """Configure LangSmith tracing if enabled."""
    s = get_settings()
    if s.langsmith_tracing and s.langsmith_api_key:
        os.environ["LANGCHAIN_TRACING_V2"] = "true"
        os.environ["LANGCHAIN_API_KEY"] = s.langsmith_api_key
        os.environ["LANGCHAIN_PROJECT"] = s.langsmith_project
        LOGGER.debug("LangSmith tracing enabled (project=%s).", s.langsmith_project)


def _build_model() -> ChatOpenAI:
    s = get_settings()
    if not s.enabled or not s.openai_api_key:
        raise AIDisabledError("AI is disabled. Set OPENAI_API_KEY to enable it.")
    _setup_langsmith()
    return ChatOpenAI(
        model=s.chat_model,
        temperature=s.temperature,
        max_tokens=s.max_output_tokens,
        openai_api_key=s.openai_api_key,
        openai_api_base=s.openai_base_url,
        streaming=True,
    )


def _build_tools(role: str) -> list:
    """Return OpenAI-compatible tool schemas for the role."""
    return openai_tool_schemas(role)


async def _dispatch_with_retry(name: str, args: dict, user: AuthUser, db: Any) -> Any:
    """Execute a tool with exponential backoff (max 3 attempts)."""
    max_attempts = 3
    base_delay = 1.0
    for attempt in range(1, max_attempts + 1):
        try:
            return await dispatch(name, args, user, db)
        except Exception as exc:  # noqa: BLE001
            LOGGER.warning("Tool %s attempt %s/%s failed: %s", name, attempt, max_attempts, exc)
            if attempt == max_attempts:
                raise
            await asyncio.sleep(base_delay * (2 ** (attempt - 1)))
    return None  # unreachable


async def _call_tools(state: AgentState, user: AuthUser, db: Any) -> dict:
    """Execute all tool_calls in the last assistant message with retry."""
    last_msg = state.messages[-1]
    if not isinstance(last_msg, AIMessage):
        return {"actions": state.actions, "messages": state.messages}

    tool_calls = last_msg.tool_calls or []
    if not tool_calls:
        return {"actions": state.actions, "messages": state.messages}

    # Run independent tool calls in parallel.
    coros = []
    for call in tool_calls:
        name = call.get("name", "")
        args = call.get("args", {})
        coros.append(_dispatch_with_retry(name, args, user, db))

    results = await asyncio.gather(*coros, return_exceptions=True)

    actions: list[AgentAction] = list(state.actions)
    tool_results: list[ToolMessage] = []

    for call, result in zip(tool_calls, results):
        tid = call.get("id", "")
        name = call.get("name", "")
        if isinstance(result, Exception):
            LOGGER.exception("Tool %s failed after retries: %s", name, result)
            result = type(
                "ToolResult",
                (),
                {"ok": False, "data": None, "error": str(result), "actions": []},
            )()
        actions.extend(result.actions)
        content = json.dumps(
            {"ok": result.ok, "data": result.data, "error": result.error},
            default=str,
        )
        tool_results.append(
            ToolMessage(content=content, tool_call_id=tid, name=name)
        )

    return {"actions": actions, "messages": state.messages + tool_results}


async def _call_model(state: AgentState, role: str) -> dict:
    """Invoke the LLM with the current conversation + tool schemas."""
    model = _build_model()
    tools = _build_tools(role)
    bound = model.bind_tools(tools) if tools else model
    response = await bound.ainvoke(state.messages)
    return {"messages": state.messages + [response]}


async def _human_approval(state: AgentState, role: str) -> dict:
    """Generate a confirmation message for high-stakes tool calls without executing them."""
    last_msg = state.messages[-1]
    tool_calls = last_msg.tool_calls or [] if isinstance(last_msg, AIMessage) else []

    # Build a natural confirmation message via a quick LLM call.
    model = _build_model()
    tool_descriptions = []
    for call in tool_calls:
        name = call.get("name", "")
        args = call.get("args", {})
        tool_descriptions.append(f"- {name}({json.dumps(args, default=str)})")

    prompt = (
        "You are about to perform the following actions on behalf of the user:\n"
        + "\n".join(tool_descriptions)
        + "\n\nGenerate a brief, friendly confirmation message (1-2 sentences) asking "
        "the user to confirm. Be specific about what will happen."
    )
    confirm_msg = await model.ainvoke([HumanMessage(content=prompt)])
    confirmation = (confirm_msg.content or "Please confirm to proceed.").strip()

    # Compute pending actions (same logic as the tools would return).
    pending_actions: list[AgentAction] = []
    for call in tool_calls:
        name = call.get("name", "")
        args = call.get("args", {})
        try:
            result = await dispatch(name, args, None, None)
            pending_actions.extend(result.actions)
        except Exception:  # noqa: S110
            pass

    return {
        "interrupt": {
            "message": confirmation,
            "pending_actions": pending_actions,
        },
        "messages": state.messages,
        "actions": state.actions,
    }


def _should_continue(state: AgentState) -> Literal["call_tools", "human_approval", END]:
    """Route to tool node, approval node, or end."""
    last_msg = state.messages[-1]
    if not isinstance(last_msg, AIMessage) or not last_msg.tool_calls:
        return END

    # If user already approved this turn, execute tools.
    if state.approval == "confirmed":
        return "call_tools"

    # Check for high-stakes tool calls.
    for call in last_msg.tool_calls:
        if call.get("name", "") in _HIGH_STAKES_TOOLS:
            return "human_approval"

    return "call_tools"


def build_agent_graph(
    role: str,
    user: AuthUser,
    db: Any,
    checkpointer: Any | None = None,
) -> CompiledStateGraph:
    """Build and compile a fresh graph instance for this request."""

    async def call_model_node(state: AgentState) -> dict:
        return await _call_model(state, role)

    async def call_tools_node(state: AgentState) -> dict:
        return await _call_tools(state, user, db)

    async def human_approval_node(state: AgentState) -> dict:
        return await _human_approval(state, role)

    builder = StateGraph(AgentState)
    builder.add_node("call_model", call_model_node)
    builder.add_node("call_tools", call_tools_node)
    builder.add_node("human_approval", human_approval_node)
    builder.add_edge(START, "call_model")
    builder.add_conditional_edges(
        "call_model",
        _should_continue,
        {"call_tools": "call_tools", "human_approval": "human_approval", END: END},
    )
    builder.add_edge("call_tools", "call_model")
    builder.add_edge("human_approval", END)

    return builder.compile(checkpointer=checkpointer)


# ──────────────────────────────────────────────────────────────
# Public entrypoints
# ──────────────────────────────────────────────────────────────

async def run_agent(
    user: AuthUser,
    history: list[ChatMessage],
    db: Any,
    *,
    thread_id: str | None = None,
    checkpointer: Any | None = None,
) -> ChatResponse:
    """Run the LangGraph agent and return the final reply + accumulated UI actions.

    If ``thread_id`` and ``checkpointer`` are provided, the conversation state
    is persisted across turns so the agent can resume mid-workflow.
    """
    settings = get_settings()
    role = canonical_role(user.role)

    system = SystemMessage(content=system_prompt_for_role(role))
    messages: list[BaseMessage] = [system]
    for m in history:
        if m.role == "system":
            continue
        if m.role == "tool":
            messages.append(
                ToolMessage(content=m.content or "", tool_call_id=m.tool_call_id or "", name=m.name or "")
            )
        elif m.role == "assistant":
            messages.append(AIMessage(content=m.content or ""))
        else:
            messages.append(HumanMessage(content=m.content or ""))

    graph = build_agent_graph(role, user, db, checkpointer=checkpointer)

    config: dict[str, Any] = {}
    if thread_id:
        config["configurable"] = {"thread_id": thread_id}

    final_state = await graph.ainvoke(AgentState(messages=messages, actions=[]), config=config or None)

    final_msg = final_state["messages"][-1]
    reply = (final_msg.content or "").strip()
    transcript = list(history)
    transcript.append(ChatMessage(role="assistant", content=reply))

    # If the graph hit human_approval, return an interrupt response.
    interrupt = final_state.get("interrupt")
    if interrupt:
        return ChatResponse(
            reply=interrupt["message"],
            actions=[],
            messages=transcript,
            role=role,
            model=settings.chat_model,
            interrupt=InterruptResponse(
                message=interrupt["message"],
                pending_actions=interrupt.get("pending_actions", []),
                thread_id=thread_id or "",
            ),
        )

    return ChatResponse(
        reply=reply,
        actions=final_state.get("actions", []),
        messages=transcript,
        role=role,
        model=settings.chat_model,
        interrupt=None,
    )


async def resume_agent(
    user: AuthUser,
    db: Any,
    thread_id: str,
    approve: bool,
    checkpointer: Any | None = None,
) -> ChatResponse:
    """Resume an interrupted conversation after user confirmation or denial.

    Loads the checkpointed state, executes the pending tools (if approved),
    and returns the final LLM response.
    """
    settings = get_settings()
    role = canonical_role(user.role)

    # We reconstruct the state from the checkpoint by re-running the graph
    # with the same messages plus an approval signal.
    if not checkpointer:
        raise AIDisabledError("Checkpointer required for resume.")

    # Fetch the last checkpoint state.
    config = {"configurable": {"thread_id": thread_id}}
    checkpoint_tuple = await checkpointer.aget_tuple(config)
    if not checkpoint_tuple or not checkpoint_tuple.checkpoint:
        raise ValueError(f"Thread {thread_id} not found or expired.")

    checkpoint = checkpoint_tuple.checkpoint
    # The checkpoint stores serialized state. Reconstruct AgentState.
    # LangGraph 0.2.x checkpoint structure: {channel_values: {messages: [...], actions: [...], ...}}
    state_data = checkpoint.get("channel_values", {})
    messages = state_data.get("messages", [])
    actions = state_data.get("actions", [])

    if not approve:
        # User cancelled — let the LLM respond to the cancellation.
        messages = list(messages)
        messages.append(HumanMessage(content="The user cancelled this action. Please acknowledge and ask how else you can help."))
        model = _build_model()
        response = await model.ainvoke(messages)
        reply = (response.content or "").strip()
        return ChatResponse(
            reply=reply,
            actions=[],
            messages=[ChatMessage(role="assistant", content=reply)],
            role=role,
            model=settings.chat_model,
            interrupt=None,
        )

    # User approved — execute pending tools then get final LLM response.
    state = AgentState(messages=messages, actions=actions, approval="confirmed")
    graph = build_agent_graph(role, user, db, checkpointer=checkpointer)
    final_state = await graph.ainvoke(state, config=config or None)
    final_msg = final_state["messages"][-1]
    reply = (final_msg.content or "").strip()

    return ChatResponse(
        reply=reply,
        actions=final_state.get("actions", []),
        messages=[ChatMessage(role="assistant", content=reply)],
        role=role,
        model=settings.chat_model,
        interrupt=None,
    )


async def stream_agent(
    user: AuthUser,
    history: list[ChatMessage],
    db: Any,
    *,
    thread_id: str | None = None,
    checkpointer: Any | None = None,
):
    """Stream LangGraph events (tokens, tool calls, etc) for real-time UX.

    Yields dict events compatible with SSE / chunked JSON streaming.
    """
    settings = get_settings()
    role = canonical_role(user.role)

    system = SystemMessage(content=system_prompt_for_role(role))
    messages: list[BaseMessage] = [system]
    for m in history:
        if m.role == "system":
            continue
        if m.role == "tool":
            messages.append(
                ToolMessage(content=m.content or "", tool_call_id=m.tool_call_id or "", name=m.name or "")
            )
        elif m.role == "assistant":
            messages.append(AIMessage(content=m.content or ""))
        else:
            messages.append(HumanMessage(content=m.content or ""))

    graph = build_agent_graph(role, user, db, checkpointer=checkpointer)

    config: dict[str, Any] = {}
    if thread_id:
        config["configurable"] = {"thread_id": thread_id}

    async for event in graph.astream_events(
        AgentState(messages=messages, actions=[]),
        config=config or None,
        version="v2",
    ):
        kind = event.get("event")
        if kind == "on_chat_model_stream":
            chunk = event.get("data", {}).get("chunk")
            if chunk and chunk.content:
                yield {"type": "token", "content": chunk.content}
        elif kind == "on_tool_start":
            yield {
                "type": "tool_start",
                "name": event.get("name", ""),
                "input": event.get("data", {}).get("input"),
            }
        elif kind == "on_tool_end":
            yield {
                "type": "tool_end",
                "name": event.get("name", ""),
                "output": event.get("data", {}).get("output"),
            }
        elif kind == "on_chain_end" and event.get("name") == "LangGraph":
            final_state = event.get("data", {}).get("output", {})
            final_msg = final_state.get("messages", [None])[-1]
            reply = (final_msg.content or "").strip() if final_msg else ""
            interrupt = final_state.get("interrupt")
            payload: dict[str, Any] = {
                "type": "complete",
                "reply": reply,
                "actions": [a.model_dump() for a in final_state.get("actions", [])],
            }
            if interrupt:
                payload["interrupt"] = {
                    "message": interrupt.get("message", ""),
                    "pending_actions": [a.model_dump() for a in interrupt.get("pending_actions", [])],
                }
            yield payload
