"use client";

import { api, getApiBase } from "@/lib/api";
import type { AIChatRequest, AIChatResponse, AIVoiceStatus, TranscriptionResponse, TTSRequest } from "./types";

export async function aiChat(body: AIChatRequest): Promise<AIChatResponse> {
  return api.post<AIChatResponse>("/api/ai/chat", body);
}

export async function aiVoiceStatus(): Promise<AIVoiceStatus> {
  return api.get<AIVoiceStatus>("/api/ai/status");
}

export async function aiSpeak(body: TTSRequest): Promise<ArrayBuffer> {
  const base = getApiBase();
  const token = (() => {
    try {
      const raw = localStorage.getItem("estatechain.session.v1");
      if (!raw) return "";
      return JSON.parse(raw).token || "";
    } catch {
      return "";
    }
  })();
  const res = await fetch(`${base}/api/ai/voice/speak`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token ? `Bearer ${token}` : "",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`TTS failed: ${res.status}`);
  return res.arrayBuffer();
}

export async function aiTranscribe(blob: Blob): Promise<TranscriptionResponse> {
  const fd = new FormData();
  fd.append("file", blob, "speech.webm");
  return api.postMultipart<TranscriptionResponse>("/api/ai/voice/transcribe", fd);
}
