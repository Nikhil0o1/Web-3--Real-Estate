"use client";

import { api } from "@/lib/api";
import type { AIChatRequest, AIChatResponse, AIVoiceStatus, TranscriptionResponse, TTSRequest } from "./types";

export async function aiChat(body: AIChatRequest): Promise<AIChatResponse> {
  return api.post<AIChatResponse>("/api/ai/chat", body);
}

export async function aiVoiceStatus(): Promise<AIVoiceStatus> {
  return api.get<AIVoiceStatus>("/api/ai/status");
}

export async function aiSpeak(body: TTSRequest): Promise<ArrayBuffer> {
  const base = (typeof window !== "undefined" && window.location.origin) || "";
  const res = await fetch(`${base}/api/ai/voice/speak`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${localStorage.getItem("estatechain.session.v1") ? JSON.parse(localStorage.getItem("estatechain.session.v1")!).token : ""}`,
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
