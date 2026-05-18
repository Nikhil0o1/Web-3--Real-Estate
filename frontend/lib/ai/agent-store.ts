"use client";

import { create } from "zustand";
import { getApiBase } from "@/lib/api";
import { executeActions } from "./action-executor";
import { speak, speakSentence, onSpeakingChange, clearAudioQueue, isAudioQueueEmpty } from "./voice-runtime";
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

    // Stop any previous audio when the user sends a new message.
    clearAudioQueue();

    const fromVoice = opts?.fromVoice ?? false;

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
      let lastSpokenIndex = 0;
      let assistantMessage = msg("assistant", "");
      let actions: AIAction[] = [];
      let streamError: string | null = null;

      // Show placeholder assistant message so the user sees streaming immediately.
      set({
        messages: [...history, assistantMessage],
        state: "idle",
      });

      const decoder = new TextDecoder();
      let sseBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });

        // Parse SSE events (split on double newline).
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
                const token = event.content || "";
                streamingText += token;
                assistantMessage = { ...assistantMessage, content: streamingText };
                set({ messages: [...history, assistantMessage] });

                // Sentence-level TTS for voice mode — detect completed sentences.
                if (fromVoice) {
                  let boundary = -1;
                  for (let i = streamingText.length - 1; i >= lastSpokenIndex; i--) {
                    if (".!?".includes(streamingText[i]) && i - lastSpokenIndex > 15) {
                      boundary = i;
                      break;
                    }
                  }
                  if (boundary !== -1) {
                    const sentence = streamingText.slice(lastSpokenIndex, boundary + 1).trim();
                    lastSpokenIndex = boundary + 1;
                    if (sentence) speakSentence(sentence);
                  }
                }
              } else if (event.type === "complete") {
                const finalReply = (event.reply || "").trim();
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

      if (streamError) {
        throw new Error(streamError);
      }

      // Speak any trailing fragment in voice mode.
      if (fromVoice) {
        const remainder = streamingText.slice(lastSpokenIndex).trim();
        if (remainder && remainder.length > 3) {
          speakSentence(remainder);
        }
      }

      // Execute UI actions (modals, navigation, etc).
      if (actions.length) {
        await executeActions(actions, router);
      }

      // Re-arm mic for continuous voice session.
      if (fromVoice && get().continuousVoice) {
        let safety = 200;
        while (!isAudioQueueEmpty() && safety-- > 0) {
          await new Promise((r) => setTimeout(r, 100));
        }
        await new Promise((r) => setTimeout(r, 400));
        _rearmMicRef?.();
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

// Single rearm callback — set by the bubble component.
let _rearmMicRef: (() => void) | null = null;
export function setRearmMicRef(fn: (() => void) | null) {
  _rearmMicRef = fn;
}
