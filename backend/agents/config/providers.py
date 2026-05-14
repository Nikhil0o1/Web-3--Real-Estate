"""LLM provider abstraction — OpenAI, Anthropic, routing, and safe stub fallback."""
from __future__ import annotations

import json
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Callable

import httpx

from backend.agents.config.settings import AISettings, get_ai_settings


@dataclass
class LLMCompletionResult:
    text: str
    provider: str
    model: str
    latency_ms: int
    usage: dict[str, Any] = field(default_factory=dict)
    fallback_used: bool = False
    error: str | None = None


class BaseLLMProvider(ABC):
    """Swappable model backend (OpenAI, Anthropic, local OpenAI-compatible, etc.)."""

    name: str

    def __init__(self, settings: AISettings) -> None:
        self._settings = settings

    @abstractmethod
    def is_configured(self) -> bool:
        """Whether this provider can accept traffic (keys / base URL present)."""

    @abstractmethod
    async def stream_completion(
        self,
        *,
        model: str,
        messages: list[dict[str, Any]],
        **kwargs: Any,
    ) -> AsyncIterator[str]:
        """Token / chunk stream (optional; completion path is preferred for JSON)."""
        yield  # pragma: no cover

    async def complete_chat(
        self,
        *,
        model: str,
        messages: list[dict[str, Any]],
        max_tokens: int,
        temperature: float,
        timeout_s: float,
        json_mode: bool = False,
    ) -> LLMCompletionResult:
        """Non-streaming completion — default unsupported (stub)."""
        _ = (model, messages, max_tokens, temperature, timeout_s, json_mode)
        return LLMCompletionResult(
            text="",
            provider=self.name,
            model=model,
            latency_ms=0,
            error="COMPLETION_NOT_IMPLEMENTED",
        )


class StubLLMProvider(BaseLLMProvider):
    """Safe default when no vendor credentials are configured."""

    name = "stub"

    def is_configured(self) -> bool:
        return True

    async def stream_completion(
        self,
        *,
        model: str,
        messages: list[dict[str, Any]],
        **kwargs: Any,
    ) -> AsyncIterator[str]:
        _ = (model, messages, kwargs)
        yield ""

    async def complete_chat(
        self,
        *,
        model: str,
        messages: list[dict[str, Any]],
        max_tokens: int,
        temperature: float,
        timeout_s: float,
        json_mode: bool = False,
    ) -> LLMCompletionResult:
        _ = (model, messages, max_tokens, temperature, timeout_s, json_mode)
        return LLMCompletionResult(text="", provider=self.name, model=model, latency_ms=0, error="stub")


class OpenAICompletionProvider(BaseLLMProvider):
    name = "openai"

    def is_configured(self) -> bool:
        return bool(self._settings.openai_api_key)

    async def stream_completion(
        self,
        *,
        model: str,
        messages: list[dict[str, Any]],
        **kwargs: Any,
    ) -> AsyncIterator[str]:
        res = await self.complete_chat(
            model=model,
            messages=messages,
            max_tokens=int(kwargs.get("max_tokens", 256)),
            temperature=float(kwargs.get("temperature", 0.2)),
            timeout_s=float(kwargs.get("timeout_s", self._settings.request_timeout_s)),
            json_mode=False,
        )
        if res.text:
            yield res.text

    async def complete_chat(
        self,
        *,
        model: str,
        messages: list[dict[str, Any]],
        max_tokens: int,
        temperature: float,
        timeout_s: float,
        json_mode: bool = False,
    ) -> LLMCompletionResult:
        if not self.is_configured():
            return LLMCompletionResult(
                text="", provider=self.name, model=model, latency_ms=0, error="OPENAI_NOT_CONFIGURED"
            )
        url = f"{self._settings.openai_base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self._settings.openai_api_key}",
            "Content-Type": "application/json",
        }
        body: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        t0 = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(timeout_s)) as client:
                r = await client.post(url, headers=headers, json=body)
                r.raise_for_status()
                data = r.json()
        except Exception as exc:  # noqa: BLE001
            ms = int((time.perf_counter() - t0) * 1000)
            return LLMCompletionResult(
                text="", provider=self.name, model=model, latency_ms=ms, error=str(exc)[:500]
            )
        ms = int((time.perf_counter() - t0) * 1000)
        try:
            choice = (data.get("choices") or [{}])[0]
            msg = choice.get("message") or {}
            content = str(msg.get("content") or "")
            usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
        except Exception:  # noqa: BLE001
            content = ""
            usage = {}
        return LLMCompletionResult(text=content, provider=self.name, model=model, latency_ms=ms, usage=usage)


class AnthropicCompletionProvider(BaseLLMProvider):
    name = "anthropic"

    def is_configured(self) -> bool:
        return bool(self._settings.anthropic_api_key)

    async def stream_completion(
        self,
        *,
        model: str,
        messages: list[dict[str, Any]],
        **kwargs: Any,
    ) -> AsyncIterator[str]:
        res = await self.complete_chat(
            model=model,
            messages=messages,
            max_tokens=int(kwargs.get("max_tokens", 256)),
            temperature=float(kwargs.get("temperature", 0.2)),
            timeout_s=float(kwargs.get("timeout_s", self._settings.request_timeout_s)),
            json_mode=bool(kwargs.get("json_mode", False)),
        )
        if res.text:
            yield res.text

    async def complete_chat(
        self,
        *,
        model: str,
        messages: list[dict[str, Any]],
        max_tokens: int,
        temperature: float,
        timeout_s: float,
        json_mode: bool = False,
    ) -> LLMCompletionResult:
        if not self.is_configured():
            return LLMCompletionResult(
                text="", provider=self.name, model=model, latency_ms=0, error="ANTHROPIC_NOT_CONFIGURED"
            )
        system_parts: list[str] = []
        anth_msgs: list[dict[str, Any]] = []
        for m in messages:
            role = str(m.get("role") or "user")
            content = m.get("content")
            text = content if isinstance(content, str) else json.dumps(content, default=str)
            if role == "system":
                system_parts.append(text)
                continue
            ar = "user" if role in ("user", "tool") else "assistant"
            anth_msgs.append({"role": ar, "content": [{"type": "text", "text": text}]})
        system = "\n\n".join(system_parts) if system_parts else "You are a helpful assistant."
        if json_mode:
            system += (
                "\n\nRespond with a single JSON object only (no markdown), "
                'keys: "message" (string) and "reasoning_summary" (string).'
            )
        url = "https://api.anthropic.com/v1/messages"
        headers = {
            "x-api-key": self._settings.anthropic_api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        body = {
            "model": model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "system": system,
            "messages": anth_msgs,
        }
        t0 = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(timeout_s)) as client:
                r = await client.post(url, headers=headers, json=body)
                r.raise_for_status()
                data = r.json()
        except Exception as exc:  # noqa: BLE001
            ms = int((time.perf_counter() - t0) * 1000)
            return LLMCompletionResult(
                text="", provider=self.name, model=model, latency_ms=ms, error=str(exc)[:500]
            )
        ms = int((time.perf_counter() - t0) * 1000)
        blocks = data.get("content") or []
        parts: list[str] = []
        for b in blocks:
            if isinstance(b, dict) and b.get("type") == "text":
                parts.append(str(b.get("text") or ""))
        text = "".join(parts)
        usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
        return LLMCompletionResult(text=text, provider=self.name, model=model, latency_ms=ms, usage=usage)


class MultiProviderCompletionRouter:
    """Primary → optional fallback with per-provider retries and timeouts."""

    def __init__(self, settings: AISettings) -> None:
        self._settings = settings
        self._openai = OpenAICompletionProvider(settings)
        self._anthropic = AnthropicCompletionProvider(settings)

    def _chain_from_governance(self, gov: dict[str, str]) -> list[tuple[str, BaseLLMProvider, str]]:
        """Build chain from DB governance override when vendors are configured."""
        out: list[tuple[str, BaseLLMProvider, str]] = []
        primary = (gov.get("primary") or "").strip().lower()
        fallback = (gov.get("fallback") or "").strip().lower()

        def push(label: str, name: str) -> None:
            if name == "openai" and self._openai.is_configured():
                out.append((label, self._openai, self._settings.default_model))
            elif name == "anthropic" and self._anthropic.is_configured():
                out.append((label, self._anthropic, self._settings.anthropic_default_model))

        push("gov_primary", primary)
        if fallback and fallback != primary:
            push("gov_fallback", fallback)

        deduped: list[tuple[str, BaseLLMProvider, str]] = []
        seen: set[int] = set()
        for tup in out:
            pid = id(tup[1])
            if pid in seen:
                continue
            seen.add(pid)
            deduped.append(tup)
        return deduped

    def chain(self) -> list[tuple[str, BaseLLMProvider, str]]:
        """Ordered (label, provider, model) tuples."""
        try:
            from backend.agents.governance.store import load_provider_routing_override

            gov = load_provider_routing_override()
            if gov:
                built = self._chain_from_governance(gov)
                if built:
                    return built
        except Exception:
            pass

        out: list[tuple[str, BaseLLMProvider, str]] = []
        primary = self._settings.provider
        if primary == "openai" and self._openai.is_configured():
            out.append(("primary_openai", self._openai, self._settings.default_model))
        elif primary == "anthropic" and self._anthropic.is_configured():
            out.append(("primary_anthropic", self._anthropic, self._settings.anthropic_default_model))
        fb = (self._settings.fallback_provider or "").strip().lower()
        fm = self._settings.fallback_model
        if fb == "anthropic" and self._anthropic.is_configured():
            if not out or out[0][1] is not self._anthropic:
                out.append(("fallback_anthropic", self._anthropic, fm or self._settings.anthropic_default_model))
        elif fb == "openai" and self._openai.is_configured():
            if not out or out[0][1] is not self._openai:
                out.append(("fallback_openai", self._openai, fm or self._settings.default_model))
        # If primary was misconfigured, try the other vendor as implicit secondary
        if not out and self._openai.is_configured():
            out.append(("implicit_openai", self._openai, self._settings.default_model))
        if not out and self._anthropic.is_configured():
            out.append(("implicit_anthropic", self._anthropic, self._settings.anthropic_default_model))
        return out

    def any_configured(self) -> bool:
        return bool(self.chain())

    async def complete_with_failover(
        self,
        *,
        messages: list[dict[str, Any]],
        max_tokens: int,
        temperature: float,
        json_mode: bool,
        on_attempt: Callable[[str, str, LLMCompletionResult], None] | None = None,
    ) -> LLMCompletionResult:
        chain = self.chain()
        if not chain:
            return LLMCompletionResult(
                text="",
                provider="none",
                model="",
                latency_ms=0,
                error="NO_LLM_CONFIGURED",
            )
        timeout = min(self._settings.request_timeout_s, 180.0)
        last_err: str | None = None
        for idx, (_label, prov, model) in enumerate(chain):
            retries = max(1, int(self._settings.llm_max_retries_per_provider))
            for attempt in range(retries):
                res = await prov.complete_chat(
                    model=model,
                    messages=messages,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    timeout_s=timeout,
                    json_mode=json_mode,
                )
                res.fallback_used = idx > 0
                if on_attempt:
                    on_attempt(prov.name, model, res)
                if res.text and not res.error:
                    return res
                last_err = res.error or "empty_response"
        return LLMCompletionResult(
            text="",
            provider=chain[-1][1].name,
            model=chain[-1][2],
            latency_ms=0,
            error=last_err or "LLM_FAILED",
            fallback_used=len(chain) > 1,
        )


_router: MultiProviderCompletionRouter | None = None


def invalidate_completion_router() -> None:
    """Drop cached router so governance/provider env changes take effect."""
    global _router
    _router = None


def get_completion_router() -> MultiProviderCompletionRouter:
    global _router
    if _router is None:
        _router = MultiProviderCompletionRouter(get_ai_settings())
    return _router


def resolve_llm_provider(settings: AISettings) -> BaseLLMProvider:
    """Backward-compatible provider handle for health / streaming stub interface."""
    if OpenAICompletionProvider(settings).is_configured():
        return OpenAICompletionProvider(settings)
    if AnthropicCompletionProvider(settings).is_configured():
        return AnthropicCompletionProvider(settings)
    return StubLLMProvider(settings)
