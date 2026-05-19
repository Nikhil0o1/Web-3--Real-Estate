"use client";

import { api } from "@/lib/api";
import type { AIChatRequest, AIChatResponse, AIVoiceStatus } from "./types";

export async function aiChat(body: AIChatRequest): Promise<AIChatResponse> {
  return api.post<AIChatResponse>("/api/ai/chat", body);
}

export async function aiVoiceStatus(): Promise<AIVoiceStatus> {
  return api.get<AIVoiceStatus>("/api/ai/status");
}

