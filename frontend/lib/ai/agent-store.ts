"use client";

import { create } from "zustand";
import { aiChat } from "./api";
import { executeActions } from "./action-executor";
import { speak, onSpeakingChange, isSpeaking } from "./voice-runtime";
import type { AIAction, AIMessage, AIState } from "./types";

function id(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function msg(role: AIMessage["role"], content: string): AIMessage {
  return { role, content };
}

export type AgentStore = {
  open: boolean;
  state: AIState;
  transcriptPreview: string;
  messages: AIMessage[];
  actions: AIAction[];
  error: string | null;
  continuousVoice: boolean;
  aiSpeaking: boolean;

  setOpen: (open: boolean) => void;
  setState: (state: AIState) => void;
  setTranscriptPreview: (t: string) => void;
  setContinuousVoice: (v: boolean) => void;
  clear: () => void;
  send: (text: string, router: { push: (href: string) => void }, opts?: { fromVoice?: boolean }) => Promise<void>;
};

const WELCOME =
  "Hi there! I'm EstateChain Copilot. Ask me anything about your properties, investments, or rent — or just say what you'd like me to do.";

export const useAgentStore = create<AgentStore>((set, get) => ({
  open: false,
  state: "idle",
  transcriptPreview: "",
  messages: [msg("assistant", WELCOME)],
  actions: [],
  error: null,
  continuousVoice: false,
  aiSpeaking: false,

  setOpen(open) {
    set({ open });
  },
  setState(state) {
    set({ state });
  },
  setTranscriptPreview(transcriptPreview) {
    set({ transcriptPreview });
  },
  setContinuousVoice(continuousVoice) {
    set({ continuousVoice });
  },
  clear() {
    set({
      messages: [msg("assistant", WELCOME)],
      actions: [],
      error: null,
      transcriptPreview: "",
      continuousVoice: false,
      state: "idle",
    });
  },

  async send(text, router, opts) {
    const clean = text.trim();
    if (!clean) return;

    if (!opts?.fromVoice) {
      set({ continuousVoice: false });
    }

    const userMessage = msg("user", clean);
    const history = [...get().messages, userMessage];
    set({
      messages: history,
      state: "thinking",
      error: null,
      transcriptPreview: "",
    });

    try {
      const response = await aiChat({ messages: history.map((m) => ({ role: m.role, content: m.content })) });

      const assistantMessage = msg("assistant", response.reply);
      const newHistory = [...history, assistantMessage];

      set({
        messages: newHistory,
        actions: response.actions,
        state: opts?.fromVoice && response.actions.some((a) => a.type === "OPEN_MODAL") ? "speaking" : "idle",
        continuousVoice: opts?.fromVoice ?? get().continuousVoice,
      });

      // Speak the reply (if continuous voice session)
      if (opts?.fromVoice) {
        await speak(response.reply);
      }

      // Execute actions after speech starts / finishes (they run in parallel)
      if (response.actions.length) {
        await executeActions(response.actions, router);
      }

      // Re-arm mic for continuous voice session
      const store = get();
      if (store.continuousVoice && !isSpeaking()) {
        // Small beat before re-arming
        await new Promise((r) => setTimeout(r, 600));
        // Trigger voice re-arm via the bubble's effect
        window.dispatchEvent(new CustomEvent("estatechain:ai-rearm-mic"));
      }
    } catch (err: any) {
      const message = err?.message || "Something went wrong. Please try again.";
      set({
        error: message,
        messages: [...history, msg("assistant", message)],
        state: "error",
      });
      if (get().continuousVoice) {
        await speak(message);
      }
    } finally {
      if (get().state === "thinking") {
        set({ state: "idle" });
      }
    }
  },
}));

// Keep aiSpeaking in sync with voice runtime
onSpeakingChange((speaking) => {
  useAgentStore.setState({ aiSpeaking: speaking });
});
