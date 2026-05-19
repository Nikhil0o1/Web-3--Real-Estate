"use client";

import { create } from "zustand";
import { getApiBase } from "@/lib/api";
import { executeActions } from "./action-executor";
import {
  cancelRecording,
  isRecording,
  onSpeakingChange,
  recordAndTranscribe,
  speak,
  stopSpeaking,
} from "./voice";
import type { AIAction, AIMessage, AIState } from "./types";

function msg(role: AIMessage["role"], content: string): AIMessage {
  return { role, content };
}

export type AgentStore = {
  open: boolean;
  state: AIState;
  messages: AIMessage[];
  actions: AIAction[];
  error: string | null;
  aiSpeaking: boolean;

  setOpen: (open: boolean) => void;
  setState: (state: AIState) => void;
  clear: () => void;
  send: (
    text: string,
    router: { push: (href: string) => void },
    opts?: { fromVoice?: boolean },
  ) => Promise<void>;
  toggleVoice: (router: { push: (href: string) => void }) => Promise<void>;
  stopVoice: () => void;
};

const WELCOME =
  "Hi there! I'm EstateChain Copilot. Ask me anything about your properties, investments, or rent — or just say what you'd like me to do.";

function _authToken(): string {
  try {
    const raw = localStorage.getItem("estatechain.session.v1");
    if (!raw) return "";
    return JSON.parse(raw).token || "";
  } catch {
    return "";
  }
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  open: false,
  state: "idle",
  messages: [msg("assistant", WELCOME)],
  actions: [],
  error: null,
  aiSpeaking: false,

  setOpen(open) {
    set({ open });
  },
  setState(state) {
    set({ state });
  },
  clear() {
    stopSpeaking();
    cancelRecording();
    set({
      messages: [msg("assistant", WELCOME)],
      actions: [],
      error: null,
      state: "idle",
    });
  },

  async send(text, router, opts) {
    const clean = text.trim();
    if (!clean) return;
    const fromVoice = opts?.fromVoice ?? false;

    stopSpeaking();

    const userMessage = msg("user", clean);
    const history = [...get().messages, userMessage];
    set({
      messages: history,
      state: "thinking",
      error: null,
    });

    try {
      const base = getApiBase();
      const token = _authToken();

      const fetchRes = await fetch(`${base}/api/ai/chat/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : "",
        },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!fetchRes.ok) {
        throw new Error(`Stream failed: ${fetchRes.status}`);
      }

      const reader = fetchRes.body?.getReader();
      if (!reader) throw new Error("No response body");

      let streamingText = "";
      let assistantMessage = msg("assistant", "");
      let actions: AIAction[] = [];
      let finalReply = "";
      let streamError: string | null = null;

      set({ messages: [...history, assistantMessage], state: "idle" });

      const decoder = new TextDecoder();
      let sseBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const parts = sseBuffer.split("\n\n");
        sseBuffer = parts.pop() || "";

        for (const part of parts) {
          const dataLines = part.split("\n").filter((l) => l.startsWith("data: "));
          for (const line of dataLines) {
            const data = line.slice(6).trim();
            if (!data) continue;
            try {
              const event = JSON.parse(data);
              if (event.type === "token") {
                const delta = event.content || "";
                streamingText += delta;
                assistantMessage = { ...assistantMessage, content: streamingText };
                set({ messages: [...history, assistantMessage] });
              } else if (event.type === "complete") {
                finalReply = (event.reply || "").trim();
                if (finalReply && streamingText !== finalReply) {
                  streamingText = finalReply;
                  assistantMessage = { ...assistantMessage, content: finalReply };
                }
                actions = (event.actions || []) as AIAction[];
                set({ messages: [...history, assistantMessage], actions });
              } else if (event.type === "error") {
                streamError = event.detail || "Stream error";
              }
            } catch {
              /* skip malformed SSE JSON */
            }
          }
        }
      }

      if (streamError) throw new Error(streamError);

      if (actions.length) {
        await executeActions(actions, router);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("estatechain:ai-data-changed"));
        }
      }

      const spokenText = finalReply || streamingText;
      if (fromVoice && spokenText) {
        set({ state: "speaking" });
        try {
          await speak(spokenText);
        } catch {
          /* TTS failure is non-fatal — user still sees the text */
        }
      }
    } catch (err: any) {
      const message = err?.message || "Something went wrong. Please try again.";
      set({
        error: message,
        messages: [...get().messages, msg("assistant", message)],
        state: "error",
      });
    } finally {
      if (get().state !== "error") set({ state: "idle" });
    }
  },

  async toggleVoice(router) {
    if (isRecording()) {
      cancelRecording();
      set({ state: "idle" });
      return;
    }
    if (get().aiSpeaking) {
      stopSpeaking();
      return;
    }
    set({ state: "listening", error: null });
    let transcript = "";
    try {
      transcript = await recordAndTranscribe();
    } catch (err: any) {
      set({
        state: "error",
        error: err?.message || "Microphone failed. Check permissions.",
      });
      return;
    }
    if (!transcript) {
      set({ state: "idle" });
      return;
    }
    await get().send(transcript, router, { fromVoice: true });
  },

  stopVoice() {
    cancelRecording();
    stopSpeaking();
    if (get().state === "listening" || get().state === "speaking") {
      set({ state: "idle" });
    }
  },
}));

if (typeof window !== "undefined") {
  onSpeakingChange((speaking) => {
    useAgentStore.setState({ aiSpeaking: speaking });
  });
}
