"use client";

import { buildNavigateHref, pickFirstNavigateAction, type CopilotNavigateAction, type CopilotPushRouter } from "@/lib/ai/apply-copilot-client-actions";
import { useCopilotAppRuntime } from "@/lib/ai/copilot-app-runtime-store";
import type { InvestorCopilotStructuredResponse } from "@/lib/ai/types";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

export type FrontendNavigateAction = {
  type: "NAVIGATE";
  route: string;
  query?: Record<string, string | number | boolean | null | undefined>;
};

export type FrontendFillFormAction = {
  type: "FILL_FORM";
  form_id: string;
  fields: Record<string, string | number | boolean>;
};

export type FrontendScrollAction = {
  type: "SCROLL_TO_ELEMENT";
  element_id: string;
};

export type GovernedFrontendAction = FrontendNavigateAction | FrontendFillFormAction | FrontendScrollAction;

export type FrontendPlanContext = {
  router: CopilotPushRouter;
  pushExecutionActivity: (message: string) => void;
};

function coerceQuery(q: unknown): Record<string, string | number | boolean> | undefined {
  if (!isRecord(q)) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(q)) {
    if (v == null) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Normalize backend / legacy payloads into governed actions. */
export function resolveGovernedFrontendPlan(structured: InvestorCopilotStructuredResponse | null): GovernedFrontendAction[] {
  if (!structured) return [];
  const raw = structured.frontend_actions;
  if (Array.isArray(raw) && raw.length > 0) {
    const out: GovernedFrontendAction[] = [];
    for (const item of raw) {
      if (!isRecord(item)) continue;
      const typ = String(item.type || "").toUpperCase();
      if (item.kind === "navigate") {
        const route = String(item.path ?? "");
        if (!route.startsWith("/")) continue;
        out.push({ type: "NAVIGATE", route, query: coerceQuery(item.query) });
        continue;
      }
      if (typ === "NAVIGATE") {
        const route = String(item.route ?? item.path ?? "");
        if (!route.startsWith("/")) continue;
        out.push({ type: "NAVIGATE", route, query: coerceQuery(item.query) });
        continue;
      }
      if (typ === "FILL_FORM") {
        const formId = String(item.form_id || "");
        const fields = item.fields;
        if (!formId || !isRecord(fields)) continue;
        const f: Record<string, string | number | boolean> = {};
        for (const [k, v] of Object.entries(fields)) {
          if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") f[k] = v;
        }
        if (Object.keys(f).length) out.push({ type: "FILL_FORM", form_id: formId, fields: f });
        continue;
      }
      if (typ === "SCROLL_TO_ELEMENT") {
        const element_id = String(item.element_id || "");
        if (element_id) out.push({ type: "SCROLL_TO_ELEMENT", element_id });
      }
    }
    if (out.length) return out;
  }
  const legacyNav = pickFirstNavigateAction(structured.client_actions);
  if (!legacyNav) return [];
  const nav: CopilotNavigateAction = legacyNav;
  return [{ type: "NAVIGATE", route: nav.path, query: nav.query as Record<string, string | number | boolean> | undefined }];
}

export function planIncludesTenantAutoRent(plan: GovernedFrontendAction[]): boolean {
  return plan.some(
    (a) =>
      a.type === "NAVIGATE" &&
      a.route === "/tenant/rentals" &&
      String(a.query?.copilot_auto ?? "") === "1",
  );
}

export async function runGovernedFrontendPlan(plan: GovernedFrontendAction[], ctx: FrontendPlanContext): Promise<void> {
  const { router, pushExecutionActivity } = ctx;
  for (const action of plan) {
    switch (action.type) {
      case "NAVIGATE": {
        const href = buildNavigateHref({
          kind: "navigate",
          path: action.route,
          query: action.query,
        });
        pushExecutionActivity(`UI plan: NAVIGATE → ${href}`);
        router.push(href);
        await sleep(220);
        break;
      }
      case "FILL_FORM": {
        if (action.form_id === "create_property") {
          const strFields: Record<string, string> = {};
          for (const [k, v] of Object.entries(action.fields)) {
            strFields[k] = String(v);
          }
          useCopilotAppRuntime.getState().mergeCreatePropertyPrefill(strFields);
          pushExecutionActivity(`UI plan: FILL_FORM create_property (${Object.keys(strFields).join(", ")})`);
        } else {
          pushExecutionActivity(`UI plan: FILL_FORM skipped (unknown form_id: ${action.form_id})`);
        }
        await sleep(40);
        break;
      }
      case "SCROLL_TO_ELEMENT": {
        pushExecutionActivity(`UI plan: SCROLL_TO #${action.element_id}`);
        if (typeof document !== "undefined") {
          document.getElementById(action.element_id)?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        await sleep(120);
        break;
      }
      default:
        break;
    }
  }
}
