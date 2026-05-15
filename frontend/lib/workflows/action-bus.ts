"use client";

import type { WorkflowAction, WorkflowModal } from "@/lib/workflows/types";

const EVENT_NAME = "estatechain:workflow-action";

export function emitWorkflowAction(action: WorkflowAction) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<WorkflowAction>(EVENT_NAME, { detail: action }));
}

export function subscribeWorkflowAction(handler: (action: WorkflowAction) => void) {
  if (typeof window === "undefined") return () => undefined;
  const listener = (event: Event) => {
    handler((event as CustomEvent<WorkflowAction>).detail);
  };
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
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
