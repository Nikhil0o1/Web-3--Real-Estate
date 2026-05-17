"use client";

import { create } from "zustand";
import { api } from "@/lib/api";
import { RUNTIME_CONFIG } from "@/lib/runtime-config";
import { waitForWorkflowCompletion, type WorkflowCompletionEvent } from "@/lib/workflows/action-bus";
import type {
  WorkflowAction,
  WorkflowMessage,
  WorkflowModal,
  WorkflowState,
  WorkflowTurnResponse,
} from "@/lib/workflows/types";
import { cancelWorkflowSpeech, speakWorkflowAssistant } from "@/lib/workflows/workflow-speech";
import { invokeWorkflowVoiceContinuation } from "@/lib/workflows/workflow-voice-bridge";

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

export type SendTurnOptions = {
  /** Mic / Whisper path — enables hands-free continuation until completion or reset. */
  fromVoice?: boolean;
};

function shouldOfferVoiceContinuation(response: WorkflowTurnResponse): boolean {
  if (response.status === "unknown" || response.status === "forbidden" || response.status === "ready") return false;
  if (response.status === "awaiting_fields") return true;
  if (response.status === "idle") return Boolean(response.workflow_id);
  return false;
}

function scheduleVoiceContinuation(response: WorkflowTurnResponse): void {
  if (!shouldOfferVoiceContinuation(response)) return;
  window.setTimeout(() => {
    const s = useWorkflowRuntimeStore.getState();
    if (!s.continuousVoiceSession || s.processing || s.listening) return;
    void invokeWorkflowVoiceContinuation();
  }, RUNTIME_CONFIG.workflowVoiceContinuationDelayMs);
}

function findSubmitModal(actions: WorkflowAction[]): WorkflowModal | null {
  for (const action of actions) {
    if (action.type === "SUBMIT_FORM") return action.modal;
  }
  return null;
}

function workflowSuccessLine(workflowId: string | null, fallback: string): string {
  const map: Record<string, string> = {
    CREATE_PROPERTY_WORKFLOW: "Property created successfully.",
    EDIT_PROPERTY_WORKFLOW: "Property updated successfully.",
    INVEST_WORKFLOW: "Investment confirmed.",
    PAY_RENT_WORKFLOW: "Rent payment confirmed.",
    CLAIM_REWARDS_WORKFLOW: "Rewards claim confirmed.",
  };
  return (workflowId && map[workflowId]) || fallback;
}

function completionLine(
  workflowId: string | null,
  completion: WorkflowCompletionEvent | null,
  metamaskRequired: boolean,
): string {
  if (completion?.status === "success") {
    return completion.message || workflowSuccessLine(workflowId, "Workflow completed.");
  }
  if (completion?.status === "error") {
    return `Workflow failed. ${completion.message ?? "Please try again."}`.trim();
  }
  if (metamaskRequired) {
    return "Submitted to MetaMask — confirm in your wallet to finalize.";
  }
  return "Workflow submitted.";
}

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
  /** When true, restart mic after assistant speech (voice-initiated sessions only). */
  continuousVoiceSession: boolean;

  setOpen: (open: boolean) => void;
  setDraft: (draft: string) => void;
  setListening: (listening: boolean) => void;
  setTranscriptPreview: (transcript: string) => void;
  clearWorkflow: () => void;
  sendTurn: (text: string, executeActions: ExecuteActions, options?: SendTurnOptions) => Promise<void>;
};

export const useWorkflowRuntimeStore = create<WorkflowRuntimeState>((set, get) => ({
  open: false,
  draft: "",
  processing: false,
  listening: false,
  transcriptPreview: "",
  error: null,
  continuousVoiceSession: false,
  messages: [
    message(
      "assistant",
      'Say what you want done — for example: "Create a new property". Voice and text both run end-to-end automatically.',
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
      continuousVoiceSession: false,
      messages: [message("assistant", "Workflow cleared. Name your next task.")],
    });
  },

  async sendTurn(text, executeActions, options) {
    const clean = text.trim();
    if (!clean || get().processing) return;

    if (!options?.fromVoice) {
      set({ continuousVoiceSession: false });
    }

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

      const bustCheckpoint =
        response.status === "unknown" || response.status === "forbidden"
          ? rotateWorkflowSessionId()
          : clientSessionId;

      const nextContinuous =
        options?.fromVoice === true && response.status !== "unknown" && response.status !== "forbidden";

      set((state) => ({
        workflowState:
          response.status === "unknown" || response.status === "forbidden" ? {} : (response.workflow_state ?? {}),
        clientSessionId: bustCheckpoint,
        continuousVoiceSession: nextContinuous,
        messages: [...state.messages, message("assistant", response.message)],
      }));

      // Speech and navigation/modal-open run concurrently — the voice
      // acknowledgement plays while the page transitions and the dialog opens,
      // matching the "Hi there, creating a new property" + navigate UX.
      const speakReply =
        response.status === "ready"
          ? speakWorkflowAssistant(response.message)
          : speakWorkflowAssistant(response.message, {
              onComplete: () => scheduleVoiceContinuation(response),
            });

      if (response.actions.length) {
        await executeActions(response.actions);
      }
      await speakReply;

      // Belt-and-suspenders: even if the TTS path silently failed to fire
      // onComplete (some browsers swallow speechSynthesis events), make sure
      // the mic still re-engages so the user can answer the next question
      // hands-free.
      if (response.status !== "ready") {
        scheduleVoiceContinuation(response);
      }

      if (response.status === "ready" && response.execution_actions.length) {
        const submitModal = findSubmitModal(response.execution_actions);
        const completionPromise = submitModal
          ? waitForWorkflowCompletion(submitModal)
          : Promise.resolve<WorkflowCompletionEvent | null>(null);
        await executeActions(response.execution_actions);
        const completion = await completionPromise;
        const finalLine = completionLine(
          response.workflow_id ?? null,
          completion,
          response.metamask_required,
        );
        await speakWorkflowAssistant(finalLine);
        set((state) => ({
          workflowState: {},
          continuousVoiceSession: false,
          messages: [...state.messages, message("system", finalLine)],
        }));
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Workflow automation failed.";
      set({ continuousVoiceSession: false });
      await speakWorkflowAssistant(errorMessage);
      set((state) => ({
        error: errorMessage,
        messages: [...state.messages, message("assistant", errorMessage)],
      }));
    } finally {
      set({ processing: false });
    }
  },
}));
