"use client";

import { create } from "zustand";
import { api } from "@/lib/api";
import type { WorkflowAction, WorkflowMessage, WorkflowState, WorkflowTurnResponse } from "@/lib/workflows/types";

function id(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sessionId() {
  if (typeof window === "undefined") return id("workflow-session");
  const key = "estatechain.workflow.session.v1";
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const next = id("workflow-session");
  window.sessionStorage.setItem(key, next);
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
    message("assistant", "Tell me what you want to do. I can create a property, invest, pay rent, or claim rewards."),
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
    set({
      workflowState: {},
      error: null,
      transcriptPreview: "",
      messages: [message("assistant", "Workflow cleared. What should I help with next?")],
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

      set((state) => ({
        workflowState: response.workflow_state ?? {},
        messages: [...state.messages, message("assistant", response.message)],
      }));

      if (response.actions.length) {
        await executeActions(response.actions);
      }

      if (response.status === "ready" && response.execution_actions.length) {
        await executeActions(response.execution_actions);
        set((state) => ({
          workflowState: {},
          messages: [
            ...state.messages,
            message(
              "system",
              response.metamask_required
                ? "Workflow launched. MetaMask is the final approval boundary."
                : "Workflow submitted through the existing product form.",
            ),
          ],
        }));
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : "Workflow automation failed.";
      set((state) => ({
        error,
        messages: [...state.messages, message("assistant", error)],
      }));
    } finally {
      set({ processing: false });
    }
  },
}));
