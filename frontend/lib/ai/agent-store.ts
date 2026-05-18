"use client";

import { create } from "zustand";
import { aiChat } from "./api";
import { executeActions } from "./action-executor";
import { speak, onSpeakingChange, isSpeaking } from "./voice-runtime";
import type { AIAction, AIMessage, AIState } from "./types";

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

      const reply = (response.reply ?? "").trim() || "Done.";
      const assistantMessage = msg("assistant", reply);
      const newHistory = [...history, assistantMessage];

      set({
        messages: newHistory,
        actions: response.actions,
        state: opts?.fromVoice && response.actions.some((a) => a.type === "OPEN_MODAL") ? "speaking" : "idle",
        continuousVoice: opts?.fromVoice ?? get().continuousVoice,
      });

      // Kick off actions immediately, in parallel with TTS playback.
      const actionPromise = response.actions.length
        ? executeActions(response.actions, router)
        : Promise.resolve();

      if (opts?.fromVoice) {
        await speak(reply);
      }
      await actionPromise;

      // Re-arm mic for continuous voice session.
      const store = get();
      if (store.continuousVoice) {
        // Wait for any tail of TTS audio to finish before re-arming.
        let safety = 30;
        while (isSpeaking() && safety-- > 0) {
          await new Promise((r) => setTimeout(r, 100));
        }
        await new Promise((r) => setTimeout(r, 400));
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
