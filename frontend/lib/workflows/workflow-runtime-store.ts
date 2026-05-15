"use client";

import { create } from "zustand";
import { api } from "@/lib/api";
import type { WorkflowAction, WorkflowMessage, WorkflowState, WorkflowTurnResponse } from "@/lib/workflows/types";
import { cancelWorkflowSpeech, speakWorkflowAssistant } from "@/lib/workflows/workflow-speech";

function id(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const WORKFLOW_SESSION_KEY = "estatechain.workflow.session.v1";

function rotateWorkflowSessionId(): string {
  const next = id("workflow-session");
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(WORKFLOW_SESSION_KEY, next);
  }
  return next;
}

function sessionId() {
  if (typeof window === "undefined") return id("workflow-session");
  const existing = window.sessionStorage.getItem(WORKFLOW_SESSION_KEY);
  if (existing) return existing;
  const next = id("workflow-session");
  window.sessionStorage.setItem(WORKFLOW_SESSION_KEY, next);
  return next;
}

function message(role: WorkflowMessage["role"], content: string): WorkflowMessage {
  return { id: id("wf-msg"), role, content, createdAt: new Date().toISOString() };
}

type ExecuteActions = (actions: WorkflowAction[]) => Promise<void>;

export type WorkflowRuntimeState = {
  open: boolean;
  draft: string;
  processing: boolean;
  listening: boolean;
  transcriptPreview: string;
  error: string | null;
  messages: WorkflowMessage[];
  workflowState: WorkflowState;
  clientSessionId: string | null;

  setOpen: (open: boolean) => void;
  setDraft: (draft: string) => void;
  setListening: (listening: boolean) => void;
  setTranscriptPreview: (transcript: string) => void;
  clearWorkflow: () => void;
  sendTurn: (text: string, executeActions: ExecuteActions) => Promise<void>;
};

export const useWorkflowRuntimeStore = create<WorkflowRuntimeState>((set, get) => ({
  open: false,
  draft: "",
  processing: false,
  listening: false,
  transcriptPreview: "",
  error: null,
  messages: [
    message(
      "assistant",
      'Say what you want done — for example: "Create a new property". Voice and text both run through workflow automation first.',
    ),
  ],
  workflowState: {},
  clientSessionId: null,

  setOpen(open) {
    set({ open });
  },

  setDraft(draft) {
    set({ draft });
  },

  setListening(listening) {
    set({ listening });
  },

  setTranscriptPreview(transcriptPreview) {
    set({ transcriptPreview });
  },

  clearWorkflow() {
    cancelWorkflowSpeech();
    const sid = rotateWorkflowSessionId();
    set({
      workflowState: {},
      clientSessionId: sid,
      error: null,
      transcriptPreview: "",
      messages: [message("assistant", "Workflow cleared. Name your next task.")],
    });
  },

  async sendTurn(text, executeActions) {
    const clean = text.trim();
    if (!clean || get().processing) return;
    const clientSessionId = get().clientSessionId ?? sessionId();
    set((state) => ({
      processing: true,
      error: null,
      draft: "",
      transcriptPreview: "",
      clientSessionId,
      messages: [...state.messages, message("user", clean)],
    }));

    try {
      const response = await api.post<WorkflowTurnResponse>("/api/agents/workflows/turn", {
        message: clean,
        client_session_id: clientSessionId,
        workflow_state: get().workflowState,
      });

      set((state) => {
        const bustCheckpoint =
          response.status === "unknown" || response.status === "forbidden"
            ? rotateWorkflowSessionId()
            : clientSessionId;
        return {
          workflowState:
            response.status === "unknown" || response.status === "forbidden" ? {} : (response.workflow_state ?? {}),
          clientSessionId: bustCheckpoint,
          messages: [...state.messages, message("assistant", response.message)],
        };
      });

      speakWorkflowAssistant(response.message);

      if (response.actions.length) {
        await executeActions(response.actions);
      }

      if (response.status === "ready") {
        if (response.execution_actions.length) {
          await executeActions(response.execution_actions);
        }
        set((state) => {
          const sys =
            response.execution_actions.length && response.metamask_required
              ? "Workflow launched. MetaMask is the final approval boundary."
              : response.execution_actions.length
                ? "Workflow submitted through the existing product form."
                : "Done.";
          speakWorkflowAssistant(sys);
          return {
            workflowState: {},
            messages: [...state.messages, message("system", sys)],
          };
        });
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : "Workflow automation failed.";
      speakWorkflowAssistant(error);
      set((state) => ({
        error,
        messages: [...state.messages, message("assistant", error)],
      }));
    } finally {
      set({ processing: false });
    }
  },
}));
