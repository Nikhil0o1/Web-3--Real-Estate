"use client";

import type { AIAction } from "./types";

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const MODAL_RETRIES = 6;
const MODAL_RETRY_DELAY = 220;

const ACTION_EVENT = "estatechain:ai-action";
const COMPLETION_EVENT = "estatechain:ai-completion";
const PENDING_TTL = 8000;

export type AICompletionStatus = "success" | "error";

export type AICompletionEvent = {
  modal: string;
  status: AICompletionStatus;
  message?: string;
};

type PendingOpen = {
  action: AIAction;
  expiresAt: number;
};

const pendingModalOpens = new Map<string, PendingOpen>();

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function rememberPendingOpen(action: AIAction) {
  if (!action.modal) return;
  pendingModalOpens.set(action.modal, { action, expiresAt: nowMs() + PENDING_TTL });
}

export function emitAction(action: AIAction) {
  if (typeof window === "undefined") return;
  rememberPendingOpen(action);
  window.dispatchEvent(new CustomEvent<AIAction>(ACTION_EVENT, { detail: action }));
}

export function subscribeAction(handler: (action: AIAction) => void) {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => handler((e as CustomEvent<AIAction>).detail);
  window.addEventListener(ACTION_EVENT, listener);
  return () => window.removeEventListener(ACTION_EVENT, listener);
}

export function takePendingModalOpen(modal: string, propertyId?: number | string): AIAction | null {
  const p = pendingModalOpens.get(modal);
  if (!p) return null;
  if (p.expiresAt < nowMs()) {
    pendingModalOpens.delete(modal);
    return null;
  }
  if (propertyId !== undefined) {
    if (String(p.action.property_id ?? "") !== String(propertyId)) return null;
  }
  pendingModalOpens.delete(modal);
  return p.action;
}

export function emitCompletion(event: AICompletionEvent) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<AICompletionEvent>(COMPLETION_EVENT, { detail: event }));
}

export function subscribeCompletion(handler: (event: AICompletionEvent) => void) {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => handler((e as CustomEvent<AICompletionEvent>).detail);
  window.addEventListener(COMPLETION_EVENT, listener);
  return () => window.removeEventListener(COMPLETION_EVENT, listener);
}

export function waitForCompletion(modal: string, timeoutMs = 120_000): Promise<AICompletionEvent | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    let timer = 0;
    const unsub = subscribeCompletion((ev) => {
      if (ev.modal !== modal) return;
      window.clearTimeout(timer);
      unsub();
      resolve(ev);
    });
    timer = window.setTimeout(() => {
      unsub();
      resolve(null);
    }, timeoutMs);
  });
}

export function focusField(modal: string, field: string) {
  if (typeof document === "undefined") return;
  const node = document.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>(
    `[data-workflow-field="${modal}.${field}"]`,
  );
  node?.focus();
  if (node instanceof HTMLInputElement) node.select();
}

/** Execute a single UI action. */
export async function executeAction(action: AIAction, router: { push: (href: string) => void }) {
  if (action.type === "NAVIGATE" && action.route) {
    router.push(action.route);
    await delay(450);
    return;
  }
  if (action.type === "OPEN_MODAL" && action.modal) {
    for (let i = 0; i < MODAL_RETRIES; i++) {
      emitAction(action);
      await delay(MODAL_RETRY_DELAY);
    }
    return;
  }
  if (action.type === "FOCUS_FIELD" && action.modal && action.field) {
    focusField(action.modal, action.field);
    return;
  }
  if (action.type === "FILL_FIELD" && action.modal && action.field) {
    emitAction(action);
    await delay(80); // Allow React state to flush
    return;
  }
  if (action.type === "SUBMIT_FORM" && action.modal) {
    await delay(350); // Ensure all field updates have propagated
    emitAction(action);
    return;
  }
}

export async function executeActions(actions: AIAction[], router: { push: (href: string) => void }) {
  for (const action of actions) {
    await executeAction(action, router);
  }
}

/* -------------------------------------------------------------------------- */
/*  Backward-compatible aliases (old action-bus API)                        */
/* -------------------------------------------------------------------------- */

export function preventCloseFromWorkflowBubble(event: { target: EventTarget | null; preventDefault: () => void }) {
  const target = event.target as Element | null;
  if (target && typeof (target as Element).closest === "function") {
    if (target.closest(`[data-workflow-bubble]`)) {
      event.preventDefault();
    }
  }
}

export function isWorkflowModalAction(action: AIAction, modal: string) {
  return "modal" in action && action.modal === modal;
}

export function workflowPropertyMatches(action: AIAction, propertyId: number | string) {
  if (!("property_id" in action) || action.property_id === undefined || action.property_id === null) return false;
  return String(action.property_id) === String(propertyId);
}

export const focusWorkflowField = focusField;
export const emitWorkflowAction = emitAction;
export const subscribeWorkflowAction = subscribeAction;
export const emitWorkflowCompletion = emitCompletion;
export const subscribeWorkflowCompletion = subscribeCompletion;
export const waitForWorkflowCompletion = waitForCompletion;
