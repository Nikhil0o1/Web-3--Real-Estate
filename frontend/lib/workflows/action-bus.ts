"use client";

import type { WorkflowAction, WorkflowModal } from "@/lib/workflows/types";

/** Marker attribute placed on the workflow bubble so dialogs can ignore
 *  outside-click events originating from the mic / orb. */
export const WORKFLOW_BUBBLE_ATTR = "data-workflow-bubble";

/** Pass to a Radix Dialog `onInteractOutside`/`onPointerDownOutside` handler
 *  to keep the workflow dialog open while the user interacts with the bubble. */
export function preventCloseFromWorkflowBubble(event: { target: EventTarget | null; preventDefault: () => void }) {
  const target = event.target as Element | null;
  if (target && typeof (target as Element).closest === "function") {
    if (target.closest(`[${WORKFLOW_BUBBLE_ATTR}]`)) {
      event.preventDefault();
    }
  }
}

const ACTION_EVENT = "estatechain:workflow-action";
const COMPLETION_EVENT = "estatechain:workflow-completion";
const PENDING_OPEN_TTL_MS = 8000;

export type WorkflowCompletionStatus = "success" | "error";

export type WorkflowCompletionEvent = {
  modal: WorkflowModal;
  status: WorkflowCompletionStatus;
  message?: string;
};

type PendingOpen = {
  action: Extract<WorkflowAction, { type: "OPEN_MODAL" }>;
  expiresAt: number;
};

const pendingModalOpens = new Map<WorkflowModal, PendingOpen>();

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function rememberPendingOpen(action: WorkflowAction) {
  if (action.type !== "OPEN_MODAL") return;
  pendingModalOpens.set(action.modal, {
    action,
    expiresAt: nowMs() + PENDING_OPEN_TTL_MS,
  });
}

export function emitWorkflowAction(action: WorkflowAction) {
  if (typeof window === "undefined") return;
  rememberPendingOpen(action);
  window.dispatchEvent(new CustomEvent<WorkflowAction>(ACTION_EVENT, { detail: action }));
}

export function subscribeWorkflowAction(handler: (action: WorkflowAction) => void) {
  if (typeof window === "undefined") return () => undefined;
  const listener = (event: Event) => {
    handler((event as CustomEvent<WorkflowAction>).detail);
  };
  window.addEventListener(ACTION_EVENT, listener);
  return () => window.removeEventListener(ACTION_EVENT, listener);
}

export function isWorkflowModalAction(action: WorkflowAction, modal: WorkflowModal) {
  return "modal" in action && action.modal === modal;
}

export function focusWorkflowField(modal: WorkflowModal, field: string) {
  if (typeof document === "undefined") return;
  const selector = `[data-workflow-field="${modal}.${field}"]`;
  const node = document.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>(selector);
  node?.focus();
  if (node instanceof HTMLInputElement) {
    node.select();
  }
}

export function workflowPropertyMatches(action: WorkflowAction, propertyId: number | string) {
  if (!("property_id" in action) || action.property_id === undefined || action.property_id === null) return false;
  return String(action.property_id) === String(propertyId);
}

/**
 * Pending-modal registry — a dialog that mounts AFTER the OPEN_MODAL action was
 * dispatched (e.g. it's on a page we just navigated to) can pull the request on
 * mount instead of missing the event.
 */
export function takePendingModalOpen(
  modal: WorkflowModal,
  propertyId?: number | string,
): Extract<WorkflowAction, { type: "OPEN_MODAL" }> | null {
  const pending = pendingModalOpens.get(modal);
  if (!pending) return null;
  if (pending.expiresAt < nowMs()) {
    pendingModalOpens.delete(modal);
    return null;
  }
  if (propertyId !== undefined && !workflowPropertyMatches(pending.action, propertyId)) {
    return null;
  }
  pendingModalOpens.delete(modal);
  return pending.action;
}

export function emitWorkflowCompletion(event: WorkflowCompletionEvent) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<WorkflowCompletionEvent>(COMPLETION_EVENT, { detail: event }));
}

export function subscribeWorkflowCompletion(
  handler: (event: WorkflowCompletionEvent) => void,
) {
  if (typeof window === "undefined") return () => undefined;
  const listener = (event: Event) => {
    handler((event as CustomEvent<WorkflowCompletionEvent>).detail);
  };
  window.addEventListener(COMPLETION_EVENT, listener);
  return () => window.removeEventListener(COMPLETION_EVENT, listener);
}

/** Resolves when the next completion event for `modal` arrives, or null on timeout. */
export function waitForWorkflowCompletion(
  modal: WorkflowModal,
  timeoutMs = 120_000,
): Promise<WorkflowCompletionEvent | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    let timer = 0;
    const unsubscribe = subscribeWorkflowCompletion((event) => {
      if (event.modal !== modal) return;
      window.clearTimeout(timer);
      unsubscribe();
      resolve(event);
    });
    timer = window.setTimeout(() => {
      unsubscribe();
      resolve(null);
    }, timeoutMs);
  });
}
