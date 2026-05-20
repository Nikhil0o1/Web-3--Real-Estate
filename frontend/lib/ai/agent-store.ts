"use client";

import { create } from "zustand";
import { getApiBase } from "@/lib/api";
import { executeActions } from "./action-executor";
import {
  cancelRecording,
  onSpeakingChange,
  speak,
  stopSpeaking,
} from "./voice";
import type { AIAction, AIMessage, AIState } from "./types";
import { VoiceSessionManager } from "./conversation";

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
  voiceSession: VoiceSessionManager | null;
  voiceMode: boolean;
  micLevel: number;

  setOpen: (open: boolean) => void;
  setState: (state: AIState) => void;
  clear: () => void;

  send: (
    text: string,
    router: { push: (href: string) => void },
    opts?: { fromVoice?: boolean },
  ) => Promise<void>;

  enterVoiceMode: (router: { push: (href: string) => void }) => Promise<void>;
  exitVoiceMode: () => void;
};

const WELCOME =
  "Hi! I'm EstateChain Copilot. Ask about your properties, investments, or rent — or tap the voice icon for a live conversation.";

function _authToken(): string {
  try {
    const raw = localStorage.getItem("estatechain.session.v1");
    if (!raw) return "";
    return JSON.parse(raw).token || "";
  } catch {
    return "";
  }
}

function appendOrUpdateAssistant(messages: AIMessage[], delta: string): AIMessage[] {
  if (messages.length === 0 || messages[messages.length - 1].role !== "assistant") {
    return [...messages, msg("assistant", delta)];
  }
  const next = messages.slice();
  const last = next[next.length - 1];
  next[next.length - 1] = { ...last, content: last.content + delta };
  return next;
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  open: false,
  state: "idle",
  messages: [msg("assistant", WELCOME)],
  actions: [],
  error: null,
  aiSpeaking: false,
  voiceSession: null,
  voiceMode: false,
  micLevel: 0,

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

    // If a voice session exists, route through it for unified duplex flow.
    if (get().voiceSession) {
      const userMessage = msg("user", clean);
      set({ messages: [...get().messages, userMessage], error: null });
      get().voiceSession?.sendIntent(clean);
      return;
    }

    const userMessage = msg("user", clean);
    const history = [...get().messages, userMessage];
    set({ messages: history, state: "thinking", error: null });

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

      if (!fetchRes.ok) throw new Error(`Stream failed: ${fetchRes.status}`);

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
        // After the agent navigates / opens dialogs / clicks Create, focus
        // may have landed somewhere outside the chat textbox (the form
        // input that Radix would have auto-focused, the submit button we
        // clicked, etc.). Put it back so the user can keep typing their
        // next message without first clicking back into the chat.
        if (typeof document !== "undefined") {
          const chatInput = document.querySelector<HTMLInputElement>(
            "[data-ai-chat-input]",
          );
          if (chatInput && !chatInput.disabled) {
            window.setTimeout(() => chatInput.focus(), 0);
          }
        }
      }

      const spokenText = finalReply || streamingText;
      if (fromVoice && spokenText) {
        set({ state: "speaking" });
        try {
          await speak(spokenText);
        } catch {
          /* TTS failure is non-fatal */
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

  async enterVoiceMode(router) {
    if (get().voiceSession) {
      // Already running — just show the overlay.
      set({ voiceMode: true, open: true });
      return;
    }

    const session = new VoiceSessionManager({
      onStateChange: (s) => set({ state: s as AIState }),
      onLevel: (lvl) => set({ micLevel: lvl }),
      onTranscript: (text) => {
        set({ messages: [...get().messages, msg("user", text)] });
      },
      onToken: (delta) => {
        set({ messages: appendOrUpdateAssistant(get().messages, delta) });
      },
      onActions: (actions) => {
        set({ actions: actions as AIAction[] });
        if (actions?.length) {
          executeActions(actions as AIAction[], router);
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("estatechain:ai-data-changed"));
          }
        }
      },
      onError: (errMsg) => {
        set({ error: errMsg, state: "error" });
      },
    });

    set({
      voiceSession: session,
      voiceMode: true,
      open: true,
      error: null,
      state: "listening",
    });
    await session.start();
  },

  exitVoiceMode() {
    const session = get().voiceSession;
    if (session) {
      session.stop();
    }
    cancelRecording();
    stopSpeaking();
    set({ voiceSession: null, voiceMode: false, state: "idle", micLevel: 0 });
  },
}));

if (typeof window !== "undefined") {
  onSpeakingChange((speaking) => {
    useAgentStore.setState({ aiSpeaking: speaking });
  });
}
