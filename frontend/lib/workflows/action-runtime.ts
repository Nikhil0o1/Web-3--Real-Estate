"use client";

import { emitWorkflowAction } from "@/lib/workflows/action-bus";
import type { WorkflowAction } from "@/lib/workflows/types";

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
type WorkflowRouter = { push: (href: string) => void };

export async function executeWorkflowAction(action: WorkflowAction, router: WorkflowRouter) {
  if (action.type === "SUBMIT_FORM") {
    await delay(450);
  }

  if (action.type === "NAVIGATE") {
    router.push(action.route);
    await delay(420);
    return;
  }

  if (action.type === "OPEN_MODAL") {
    for (let i = 0; i < 5; i += 1) {
      emitWorkflowAction(action);
      await delay(180);
    }
    return;
  }

  emitWorkflowAction(action);
  await delay(action.type === "SUBMIT_FORM" ? 240 : 140);
}

export async function executeWorkflowActions(actions: WorkflowAction[], router: WorkflowRouter) {
  for (const action of actions) {
    await executeWorkflowAction(action, router);
  }
}
