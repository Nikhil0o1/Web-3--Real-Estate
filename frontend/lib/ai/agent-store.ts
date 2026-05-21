"use client";

import { create } from "zustand";
import { getApiBase } from "@/lib/api";
import { executeActions, subscribeCompletion, type AICompletionEvent } from "./action-executor";
import {
  cancelRecording,
  onSpeakingChange,
  speak,
  stopSpeaking,
} from "./voice";
import type { AIAction, AIMessage, AIState } from "./types";
import { VoiceSessionManager } from "./conversation";
import type { RoleKey } from "./quick-actions";

function msg(role: AIMessage["role"], content: string): AIMessage {
  return { role, content };
}

const ROLE_WELCOME: Record<RoleKey, string> = {
  property_owner:
    "Hi, I'm your Property Owner Copilot. I can list a new property, edit or remove an existing one, set rent, and answer anything about your portfolio, investors, or rent collections. What would you like to do?",
  investor:
    "Hi, I'm your Investor Copilot. I can browse the marketplace, invest in a property, claim yield, or walk you through your portfolio and recent transactions. What would you like to do?",
  tenant:
    "Hi, I'm your Tenant Copilot. I can pay this month's rent, show your rent history, and tell you when your next payment is due. What would you like to do?",
};

const DEFAULT_VOICE_WELCOME =
  "Hi, I'm EstateChain Copilot. Ask about your properties, investments, or rent — I'm listening.";

function welcomeFor(role: RoleKey | null): string {
  if (role && ROLE_WELCOME[role]) return ROLE_WELCOME[role];
  return DEFAULT_VOICE_WELCOME;
}

/**
 * Map a completed workflow into a friendly one-sentence confirmation the
 * agent should "say" in chat. We prefer the dialog's own descriptive
 * `message` when it's a successful event because those already contain
 * concrete details (token amount, property name, etc.).
 */
function synthesizeWorkflowSuccessLine(event: AICompletionEvent): string | null {
  if (event.status !== "success") return null;
  const detail = event.message?.trim();
  switch (event.modal) {
    case "CREATE_PROPERTY":
      return detail || "Your property has been created and listed on-chain successfully.";
    case "EDIT_PROPERTY":
      return detail || "Property updated successfully.";
    case "DELETE_PROPERTY":
      return detail || "Property removed successfully.";
    case "SET_RENT":
      return detail || "Monthly rent has been set successfully.";
    case "INVEST_PROPERTY":
      return detail
        ? `${detail.replace(/\.$/, "")}. Your investment was completed successfully.`
        : "Your investment was completed successfully.";
    case "PAY_RENT":
      return detail
        ? `${detail.replace(/\.$/, "")}. Your rent was paid successfully.`
        : "Your rent was paid successfully.";
    case "CLAIM_REWARDS":
      return detail
        ? `${detail.replace(/\.$/, "")}. Your yield was claimed successfully.`
        : "Your yield was claimed successfully.";
    default:
      return null;
  }
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

  enterVoiceMode: (
    router: { push: (href: string) => void },
    opts?: { role?: RoleKey | null },
  ) => Promise<void>;
  exitVoiceMode: () => void;

  /** Append a synthetic assistant message confirming a frontend workflow. */
  notifyWorkflowSuccess: (event: AICompletionEvent) => void;
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

  async enterVoiceMode(router, opts) {
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

    // Play a role-aware welcome the moment the orb / mic is live. Mute
    // the VAD while we speak so the welcome audio can't false-trigger a
    // turn through the mic (browser AEC alone isn't always enough).
    const welcomeText = welcomeFor(opts?.role ?? null);
    set({
      messages: [...get().messages, msg("assistant", welcomeText)],
      state: "speaking",
    });
    session.setMuted(true);
    try {
      await speak(welcomeText);
    } catch {
      /* TTS failures are non-fatal — the chat already shows the welcome */
    } finally {
      session.setMuted(false);
      if (get().voiceSession === session) {
        set({ state: "listening" });
      }
    }
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

  notifyWorkflowSuccess(event) {
    const line = synthesizeWorkflowSuccessLine(event);
    if (!line) return;
    const existing = get().messages;
    // Avoid duplicate confirmations if the LLM already said it within
    // the last 2 messages (e.g. after a text-mode workflow completion).
    const recent = existing.slice(-2).find(
      (m) => m.role === "assistant" && m.content.trim() === line.trim(),
    );
    if (recent) return;
    set({
      messages: [...existing, msg("assistant", line)],
      state: get().voiceMode ? "speaking" : get().state,
    });
    if (get().voiceMode) {
      const session = get().voiceSession;
      // Suppress the mic while we read out the confirmation so the user
      // can hear it clearly without the orb false-triggering.
      session?.setMuted(true);
      void speak(line)
        .catch(() => {
          /* non-fatal */
        })
        .finally(() => {
          session?.setMuted(false);
          if (get().voiceSession === session) {
            useAgentStore.setState({ state: "listening" });
          }
        });
    }
  },
}));

if (typeof window !== "undefined") {
  onSpeakingChange((speaking) => {
    useAgentStore.setState({ aiSpeaking: speaking });
  });

  // Globally subscribe to workflow completion events so every successful
  // agent-initiated workflow (create property, invest, pay rent, claim
  // yield, edit / delete / set rent) ends with a clear confirmation
  // message in chat (and TTS in voice mode).
  subscribeCompletion((event) => {
    if (event.status !== "success") return;
    useAgentStore.getState().notifyWorkflowSuccess(event);
  });
}
