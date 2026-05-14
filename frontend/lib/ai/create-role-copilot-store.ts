"use client";

import { create, type StoreApi, type UseBoundStore } from "zustand";
import { extractProgressLines, extractStructuredResponse, streamCopilotChat } from "./stream";
import type {
  AiActivityItem,
  AiActivityKind,
  CopilotConversationMessage,
  CopilotStreamEvent,
  InvestorCopilotChatRequest,
  InvestorCopilotStructuredResponse,
} from "./types";

function id(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function createActivity(kind: AiActivityKind, message: string): AiActivityItem {
  return { id: id("activity"), kind, message, createdAt: new Date().toISOString() };
}

export type RoleCopilotStoreConfig = {
  /** localStorage namespace per wallet */
  storagePrefix: string;
  /** Path after `/api/agents/` (e.g. `copilot/investor/chat/stream`) */
  streamPath: string;
};

export type RoleCopilotStoreState = {
  wallet: string | null;
  threadId: number | null;
  traceId: string | null;
  streaming: boolean;
  messages: CopilotConversationMessage[];
  progress: string[];
  activities: AiActivityItem[];
  lastStructured: InvestorCopilotStructuredResponse | null;
  error: string | null;
  draft: string;
  commandPaletteOpen: boolean;
  abortController: AbortController | null;

  hydrateForWallet: (wallet: string | null) => void;
  setDraft: (draft: string) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  clearConversation: () => void;
  sendMessage: (text: string) => Promise<void>;
  abortStream: () => void;
  pushExecutionActivity: (message: string) => void;
};

type PersistedState = {
  threadId: number | null;
  messages: CopilotConversationMessage[];
  activities: AiActivityItem[];
  lastStructured: InvestorCopilotStructuredResponse | null;
};

const initialState = {
  wallet: null,
  threadId: null,
  traceId: null,
  streaming: false,
  messages: [] as CopilotConversationMessage[],
  progress: [] as string[],
  activities: [] as AiActivityItem[],
  lastStructured: null as InvestorCopilotStructuredResponse | null,
  error: null as string | null,
  draft: "",
  commandPaletteOpen: false,
  abortController: null as AbortController | null,
};

function addProgressLine(state: RoleCopilotStoreState, line: string) {
  if (!line.trim()) return state;
  const last = state.progress[state.progress.length - 1];
  if (last === line) return state;
  const progress = [...state.progress, line];
  const messages = state.messages.map((m) =>
    m.status === "streaming" && m.role === "assistant" ? { ...m, content: line, progress } : m,
  );
  return { ...state, progress, messages };
}

export function createRoleCopilotStore(
  config: RoleCopilotStoreConfig,
): UseBoundStore<StoreApi<RoleCopilotStoreState>> {
  const { storagePrefix, streamPath } = config;

  function storageKey(wallet: string) {
    return `${storagePrefix}:${wallet.toLowerCase()}`;
  }

  function readPersisted(wallet: string | null): PersistedState | null {
    if (!wallet || typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(storageKey(wallet));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PersistedState;
      return {
        threadId: typeof parsed.threadId === "number" ? parsed.threadId : null,
        messages: Array.isArray(parsed.messages) ? parsed.messages : [],
        activities: Array.isArray(parsed.activities) ? parsed.activities : [],
        lastStructured: parsed.lastStructured ?? null,
      };
    } catch {
      return null;
    }
  }

  function persist(wallet: string | null, snapshot: PersistedState) {
    if (!wallet || typeof window === "undefined") return;
    window.localStorage.setItem(storageKey(wallet), JSON.stringify(snapshot));
  }

  return create<RoleCopilotStoreState>((set, get) => ({
    ...initialState,

    hydrateForWallet(wallet) {
      const normalized = wallet?.toLowerCase() ?? null;
      if (!normalized) {
        set({ ...initialState });
        return;
      }
      const persisted = readPersisted(normalized);
      set({
        wallet: normalized,
        threadId: persisted?.threadId ?? null,
        messages: persisted?.messages ?? [],
        activities: persisted?.activities ?? [],
        lastStructured: persisted?.lastStructured ?? null,
        traceId: null,
        streaming: false,
        progress: [],
        error: null,
        draft: "",
        commandPaletteOpen: false,
        abortController: null,
      });
    },

    setDraft(draft) {
      set({ draft });
    },

    setCommandPaletteOpen(open) {
      set({ commandPaletteOpen: open });
    },

    clearConversation() {
      const wallet = get().wallet;
      set((state) => ({
        ...state,
        threadId: null,
        traceId: null,
        streaming: false,
        progress: [],
        messages: [],
        lastStructured: null,
        error: null,
        activities: [createActivity("system", "Started a new AI memory thread.")],
        abortController: null,
      }));
      persist(wallet, { threadId: null, messages: [], activities: [], lastStructured: null });
    },

    abortStream() {
      const ctrl = get().abortController;
      ctrl?.abort();
      set((state) => ({
        ...state,
        streaming: false,
        abortController: null,
        activities: [createActivity("system", "Streaming interrupted by user."), ...state.activities].slice(0, 120),
      }));
    },

    pushExecutionActivity(message) {
      set((state) => ({
        ...state,
        activities: [createActivity("execution", message), ...state.activities].slice(0, 120),
      }));
      const snap = get();
      persist(snap.wallet, {
        threadId: snap.threadId,
        messages: snap.messages,
        activities: snap.activities,
        lastStructured: snap.lastStructured,
      });
    },

    async sendMessage(text) {
      const message = text.trim();
      if (!message || get().streaming) return;

      const ctrl = new AbortController();
      const userMessage: CopilotConversationMessage = {
        id: id("msg"),
        role: "user",
        content: message,
        createdAt: new Date().toISOString(),
        status: "done",
      };
      const assistantMessage: CopilotConversationMessage = {
        id: id("msg"),
        role: "assistant",
        content: "Initializing orchestration…",
        createdAt: new Date().toISOString(),
        status: "streaming",
        progress: [],
      };
      set((state) => ({
        ...state,
        streaming: true,
        error: null,
        progress: [],
        draft: "",
        abortController: ctrl,
        messages: [...state.messages, userMessage, assistantMessage],
        activities: [createActivity("lifecycle", "Orchestration started."), ...state.activities].slice(0, 120),
      }));

      let finalSeen = false;
      let endedThreadId: number | null = null;

      const applyEvent = (evt: CopilotStreamEvent) => {
        if (evt.event === "progress") {
          const line = (evt.data as Record<string, unknown>)?.progress_line;
          if (typeof line === "string") {
            set((state) => addProgressLine(state, line));
            set((state) => ({
              ...state,
              activities: [createActivity("progress", line), ...state.activities].slice(0, 120),
            }));
          }
          return;
        }

        if (evt.event === "orchestration") {
          const lines = extractProgressLines(evt.data);
          for (const line of lines) {
            set((state) => addProgressLine(state, line));
          }
          // LangGraph often delivers structured_response only inside orchestration chunks;
          // if the dedicated `final` frame fails JSON.parse (e.g. legacy NaN payloads), recover here.
          const nested = extractStructuredResponse(evt.data);
          if (nested && typeof nested === "object" && typeof (nested as Record<string, unknown>).message === "string") {
            finalSeen = true;
            const structured = nested as InvestorCopilotStructuredResponse;
            const mode = structured.interaction_mode ?? "advisory";
            const timelinePrefix: ReturnType<typeof createActivity>[] = [
              createActivity("progress", `Intent classified (${mode}).`),
            ];
            if (structured.prompt_metamask) {
              timelinePrefix.push(
                createActivity("execution", "Transaction prepared — MetaMask signature requested."),
              );
            }
            set((state) => ({
              ...state,
              lastStructured: structured,
              messages: state.messages.map((m) =>
                m.id === assistantMessage.id
                  ? {
                      ...m,
                      status: "done",
                      content: structured.message,
                      structured,
                      progress: structured.stream_progress ?? state.progress,
                    }
                  : m,
              ),
              activities: [
                ...timelinePrefix,
                createActivity(
                  "recommendation",
                  structured.intent ? `Intent resolved: ${structured.intent}` : "New AI recommendation available.",
                ),
                ...state.activities,
              ].slice(0, 120),
            }));
          }
          return;
        }

        if (evt.event === "lifecycle") {
          const data = (evt.data || {}) as Record<string, unknown>;
          const phase = data.phase;
          const traceId = typeof data.trace_id === "string" ? data.trace_id : null;
          if (phase === "start" && traceId) {
            set((state) => ({ ...state, traceId }));
          }
          const threadCandidate =
            typeof data.thread_id === "number"
              ? data.thread_id
              : typeof data.thread_id === "string"
                ? Number(data.thread_id)
                : Number.NaN;
          if (phase === "end" && Number.isFinite(threadCandidate) && threadCandidate > 0) {
            endedThreadId = threadCandidate;
            set((state) => ({ ...state, threadId: threadCandidate }));
          }
          return;
        }

        if (evt.event === "error") {
          const d = (evt.data || {}) as Record<string, unknown>;
          const detail = d.message;
          const code = d.error;
          const errorText =
            typeof detail === "string" && detail.trim()
              ? detail
              : typeof code === "string"
                ? code
                : "Copilot stream failed.";
          set((state) => ({
            ...state,
            error: errorText,
            messages: state.messages.map((m) =>
              m.id === assistantMessage.id ? { ...m, status: "error", content: errorText } : m,
            ),
            activities: [createActivity("error", errorText), ...state.activities].slice(0, 120),
          }));
          return;
        }

        if (evt.event === "final" && evt.data && typeof evt.data === "object") {
          finalSeen = true;
          const structured = evt.data as InvestorCopilotStructuredResponse;
          const mode = structured.interaction_mode ?? "advisory";
          const timelinePrefix: ReturnType<typeof createActivity>[] = [
            createActivity("progress", `Intent classified (${mode}).`),
          ];
          if (structured.prompt_metamask) {
            timelinePrefix.push(
              createActivity("execution", "Transaction prepared — MetaMask signature requested."),
            );
          }
          set((state) => ({
            ...state,
            lastStructured: structured,
            messages: state.messages.map((m) =>
              m.id === assistantMessage.id
                ? {
                    ...m,
                    status: "done",
                    content: structured.message,
                    structured,
                    progress: structured.stream_progress ?? state.progress,
                  }
                : m,
            ),
            activities: [
              ...timelinePrefix,
              createActivity(
                "recommendation",
                structured.intent ? `Intent resolved: ${structured.intent}` : "New AI recommendation available.",
              ),
              ...state.activities,
            ].slice(0, 120),
          }));
        }
      };

      const payload: InvestorCopilotChatRequest = {
        message,
        thread_id: get().threadId ?? undefined,
        title: get().threadId ? undefined : message.slice(0, 100),
      };

      try {
        await streamCopilotChat(streamPath, payload, { signal: ctrl.signal, onEvent: applyEvent });
      } catch (error: unknown) {
        const errMsg =
          error instanceof Error && error.name === "AbortError"
            ? "Copilot stream aborted."
            : error instanceof Error
              ? error.message
              : "Copilot stream failed.";
        set((state) => ({
          ...state,
          error: errMsg,
          messages: state.messages.map((m) =>
            m.id === assistantMessage.id && m.status === "streaming" ? { ...m, status: "error", content: errMsg } : m,
          ),
          activities: [createActivity("error", errMsg), ...state.activities].slice(0, 120),
        }));
      } finally {
        set((state) => ({
          ...state,
          streaming: false,
          abortController: null,
          threadId: endedThreadId ?? state.threadId,
          messages: state.messages.map((m) =>
            m.id === assistantMessage.id && m.status === "streaming"
              ? {
                  ...m,
                  status: finalSeen ? "done" : "error",
                  content: finalSeen ? m.content : state.error || "No final response received.",
                }
              : m,
          ),
        }));

        const snapshot = get();
        persist(snapshot.wallet, {
          threadId: snapshot.threadId,
          messages: snapshot.messages,
          activities: snapshot.activities,
          lastStructured: snapshot.lastStructured,
        });
      }
    },
  }));
}
