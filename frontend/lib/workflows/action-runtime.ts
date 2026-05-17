"use client";

import { emitWorkflowAction } from "@/lib/workflows/action-bus";
import type { WorkflowAction } from "@/lib/workflows/types";

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

type WorkflowRouter = { push: (href: string) => void };

/**
 * Re-emit OPEN_MODAL a handful of times so a freshly navigated page has time to
 * mount the target dialog. Dialogs that mount AFTER the last emit can also
 * pick up the request via `takePendingModalOpen` in their mount effect.
 */
const OPEN_MODAL_RETRIES = 6;
const OPEN_MODAL_RETRY_DELAY_MS = 220;

export async function executeWorkflowAction(action: WorkflowAction, router: WorkflowRouter) {
  if (action.type === "NAVIGATE") {
    router.push(action.route);
    await delay(450);
    return;
  }

  if (action.type === "OPEN_MODAL") {
    for (let i = 0; i < OPEN_MODAL_RETRIES; i += 1) {
      emitWorkflowAction(action);
      await delay(OPEN_MODAL_RETRY_DELAY_MS);
    }
    return;
  }

  if (action.type === "SUBMIT_FORM") {
    await delay(280);
    emitWorkflowAction(action);
    return;
  }

  emitWorkflowAction(action);
  await delay(140);
}

export async function executeWorkflowActions(actions: WorkflowAction[], router: WorkflowRouter) {
  for (const action of actions) {
    await executeWorkflowAction(action, router);
  }
}
