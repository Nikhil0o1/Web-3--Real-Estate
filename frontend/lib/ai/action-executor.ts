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
const workflowFormValues = new Map<string, Record<string, string>>();

declare global {
  interface Window {
    __estatechainPendingModalActions?: Record<string, PendingOpen[]>;
  }
}

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function rememberPendingOpen(action: AIAction) {
  if (!action.modal || action.type !== "OPEN_MODAL") return;
  pendingModalOpens.set(action.modal, { action, expiresAt: nowMs() + PENDING_TTL });
}

function rememberPendingAction(action: AIAction) {
  if (!action.modal) return;
  window.__estatechainPendingModalActions ??= {};
  const queued = window.__estatechainPendingModalActions[action.modal] ?? [];
  queued.push({ action, expiresAt: nowMs() + PENDING_TTL });
  window.__estatechainPendingModalActions[action.modal] = queued;
}

export function emitAction(action: AIAction) {
  if (typeof window === "undefined") return;
  rememberPendingOpen(action);
  rememberPendingAction(action);
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

export function takePendingModalActions(modal: string): AIAction[] {
  const queued = window.__estatechainPendingModalActions?.[modal] ?? [];
  if (window.__estatechainPendingModalActions) {
    delete window.__estatechainPendingModalActions[modal];
  }
  const valid = queued.filter((p) => p.expiresAt >= nowMs()).map((p) => p.action);
  if (!valid.some((action) => action.type === "OPEN_MODAL")) return valid;
  return valid;
}

export function clearPendingModalActions(modal: string) {
  if (window.__estatechainPendingModalActions) {
    delete window.__estatechainPendingModalActions[modal];
  }
  pendingModalOpens.delete(modal);
  workflowFormValues.delete(modal);
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

async function waitForModalField(modal: string, timeoutMs = 5000) {
  if (typeof document === "undefined") return;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (document.querySelector(`[data-workflow-field^="${modal}."]`)) return;
    await delay(100);
  }
}

/**
 * Try to open the modal on the current page.
 *
 * Returns true if either the modal is already open OR a trigger button was
 * found and clicked. Returns false when the modal can't be opened from the
 * current route (e.g. the user is on a different dashboard page).
 *
 * The previous implementation always blocked for ~3s waiting for the field
 * to appear, even when no trigger existed — that caused multi-second hangs
 * on every FILL_FIELD action coming in from the AI. We now only wait when
 * we actually clicked something.
 */
async function openWorkflowModal(modal: string): Promise<boolean> {
  if (typeof document === "undefined") return false;
  if (document.querySelector(`[data-workflow-field^="${modal}."]`)) return true;
  const trigger = document.querySelector<HTMLButtonElement>(`[data-workflow-modal-trigger="${modal}"]`);
  if (!trigger) return false;
  trigger.click();
  await waitForModalField(modal, 3000);
  return Boolean(document.querySelector(`[data-workflow-field^="${modal}."]`));
}

function setWorkflowInputValue(modal: string, field: string, value: string) {
  if (typeof document === "undefined") return;
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[data-workflow-field="${modal}.${field}"]`,
  );
  if (!input) return;
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function submitWorkflowFormDirectly(modal: string) {
  if (typeof document === "undefined") return false;
  const opened = await openWorkflowModal(modal);
  if (!opened) {
    // Modal isn't reachable from the current page — that's fine because
    // the backend's fill_<workflow> tool with submit=true already creates
    // the record server-side. We log at info level and bail out instead of
    // surfacing a scary "Workflow form not found" error.
    console.info(
      "[AI Action] Workflow form not on this page; relying on backend submit:",
      modal,
    );
    return false;
  }
  await waitForModalField(modal);

  const values = workflowFormValues.get(modal) ?? {};
  for (const [field, value] of Object.entries(values)) {
    setWorkflowInputValue(modal, field, value);
  }

  await delay(300);
  const form = document.querySelector<HTMLFormElement>(`form[data-workflow-form="${modal}"]`);
  if (!form) {
    console.info("[AI Action] Workflow form node missing after open:", modal);
    return false;
  }
  console.log("[AI Action] Direct requestSubmit on workflow form:", modal, values);
  form.requestSubmit();
  return true;
}

/** Execute a single UI action. */
export async function executeAction(action: AIAction, router: { push: (href: string) => void }) {
  console.log("[AI Action] Executing:", action.type, action);
  if (action.type === "NAVIGATE" && action.route) {
    console.log("[AI Action] Navigating to:", action.route);
    router.push(action.route);
    await delay(600); // Wait for page to mount
    console.log("[AI Action] Navigation complete, waiting for mount...");
    return;
  }
  if (action.type === "OPEN_MODAL" && action.modal) {
    console.log("[AI Action] Opening modal:", action.modal);
    workflowFormValues.delete(action.modal);
    clearPendingModalActions(action.modal);
    const opened = await openWorkflowModal(action.modal);
    // Always emit the OPEN_MODAL event so listeners that mount later (after
    // a navigation) can pick it up via takePendingModalOpen.
    for (let i = 0; i < MODAL_RETRIES; i++) {
      emitAction(action);
      await delay(MODAL_RETRY_DELAY);
    }
    if (opened) {
      await delay(400); // Extra wait for modal to fully render
      console.log("[AI Action] Modal should be open now");
    } else {
      console.info(
        "[AI Action] OPEN_MODAL emitted but no trigger on this page (modal will open on navigation):",
        action.modal,
      );
    }
    return;
  }
  if (action.type === "FOCUS_FIELD" && action.modal && action.field) {
    console.log("[AI Action] Focusing field:", action.modal, action.field);
    focusField(action.modal, action.field);
    return;
  }
  if (action.type === "FILL_FIELD" && action.modal && action.field) {
    console.log("[AI Action] Filling field:", action.modal, action.field, "=", action.value);
    // Remember the value regardless of whether the form is mounted — the
    // dialog component drains pending actions on mount, so navigating to
    // the page later will still hydrate the form with these values.
    const values = workflowFormValues.get(action.modal) ?? {};
    values[action.field] = String(action.value ?? "");
    workflowFormValues.set(action.modal, values);
    // Try to fill the live input if the modal is reachable from the
    // current page; otherwise emit-only so navigation-on-mount works.
    const opened = await openWorkflowModal(action.modal);
    if (opened) {
      await waitForModalField(action.modal);
      setWorkflowInputValue(action.modal, action.field, String(action.value ?? ""));
    }
    emitAction(action);
    await delay(opened ? 150 : 30); // Allow React state to flush
    return;
  }
  if (action.type === "SUBMIT_FORM" && action.modal) {
    console.log("[AI Action] Submitting form:", action.modal);
    await submitWorkflowFormDirectly(action.modal);
    await delay(500);
    emitAction(action);
    console.log("[AI Action] Submit action emitted");
    return;
  }
  if (action.type === "CLOSE_MODAL" && action.modal) {
    console.log("[AI Action] Closing modal:", action.modal);
    // Forget any cached form values / pending opens for this modal so it
    // starts fresh next time.
    clearPendingModalActions(action.modal);
    // Let dialogs that listen for actions close themselves cleanly (they
    // reset internal form state + toast on this signal). We deliberately
    // do NOT fire a completion event here — the LLM already streams a
    // natural-language confirmation in this branch, and we don't want to
    // double-confirm. Completion events stay reserved for *manual*
    // user-initiated workflows (e.g. clicking Invest, Pay Rent, Claim)
    // where the LLM has no awareness of the outcome.
    emitAction(action);
    return;
  }
  console.log("[AI Action] Unknown action type or missing fields:", action);
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
export const takePendingWorkflowActions = takePendingModalActions;
export const clearPendingWorkflowActions = clearPendingModalActions;
export const emitWorkflowCompletion = emitCompletion;
export const subscribeWorkflowCompletion = subscribeCompletion;
export const waitForWorkflowCompletion = waitForCompletion;
