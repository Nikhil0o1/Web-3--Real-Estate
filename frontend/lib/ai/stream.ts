"use client";

import { getApiBase, getToken } from "@/lib/api";
import type { CopilotStreamEvent, CopilotStreamEventName, InvestorCopilotChatRequest } from "./types";

type StreamHandlers = {
  signal?: AbortSignal;
  onEvent: (event: CopilotStreamEvent) => void;
};

function parseSseFrame(frame: string): CopilotStreamEvent | null {
  const lines = frame.split(/\r?\n/);
  let eventName: CopilotStreamEventName = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      const raw = line.slice("event:".length).trim() as CopilotStreamEventName;
      eventName = raw || "message";
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }

  if (!dataLines.length) return null;
  const rawData = dataLines.join("\n");
  try {
    return { event: eventName, data: JSON.parse(rawData) };
  } catch {
    return { event: eventName, data: rawData };
  }
}

/** @param streamPath path after `/api/agents/` e.g. `copilot/investor/chat/stream` */
export async function streamCopilotChat(
  streamPath: string,
  payload: InvestorCopilotChatRequest,
  { signal, onEvent }: StreamHandlers,
) {
  const base = getApiBase();
  if (!base) throw new Error("Backend URL is not configured.");
  const token = getToken();
  const headers = new Headers({
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  });
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const path = streamPath.replace(/^\/+/, "");
  const res = await fetch(`${base}/api/agents/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Stream failed (${res.status})`);
  }
  if (!res.body) throw new Error("Streaming response body not available.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split(/\r?\n\r?\n/);
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const evt = parseSseFrame(chunk);
      if (evt) onEvent(evt);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    const evt = parseSseFrame(buffer);
    if (evt) onEvent(evt);
  }
}

export async function streamInvestorCopilotChat(
  payload: InvestorCopilotChatRequest,
  handlers: StreamHandlers,
) {
  return streamCopilotChat("copilot/investor/chat/stream", payload, handlers);
}

export function extractProgressLines(payload: unknown): string[] {
  const out: string[] = [];
  if (!payload || typeof payload !== "object") return out;
  const p = payload as Record<string, unknown>;
  if (typeof p.progress_line === "string") out.push(p.progress_line);

  const chunk = p.chunk;
  if (!chunk || typeof chunk !== "object") return out;
  for (const delta of Object.values(chunk)) {
    if (!delta || typeof delta !== "object") continue;
    const d = delta as Record<string, unknown>;
    const lines = d.stream_progress;
    if (Array.isArray(lines)) {
      for (const line of lines) {
        if (typeof line === "string") out.push(line);
      }
    }
  }
  return out;
}

export function extractStructuredResponse(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (p.event === "final" && p.data && typeof p.data === "object") return p.data;
  if (p.chunk && typeof p.chunk === "object") {
    for (const delta of Object.values(p.chunk)) {
      if (!delta || typeof delta !== "object") continue;
      const structured = (delta as Record<string, unknown>).structured_response;
      if (structured && typeof structured === "object") return structured;
    }
  }
  return null;
}
