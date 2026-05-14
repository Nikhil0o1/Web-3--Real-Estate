export type CopilotNavigateAction = {
  kind: "navigate";
  path: string;
  query?: Record<string, string | number | boolean | null | undefined>;
};

export type CopilotPushRouter = { push: (href: string) => void };

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

/** First navigate action wins (backend may emit multiple hints; one transition per response). */
export function pickFirstNavigateAction(raw: unknown[] | undefined): CopilotNavigateAction | null {
  if (!raw?.length) return null;
  for (const item of raw) {
    if (!isRecord(item)) continue;
    if (item.kind !== "navigate") continue;
    const path = typeof item.path === "string" ? item.path : "";
    if (!path.startsWith("/")) continue;
    const q = item.query;
    const query: CopilotNavigateAction["query"] = {};
    if (isRecord(q)) {
      for (const [k, v] of Object.entries(q)) {
        if (v == null) continue;
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          query[k] = v;
        }
      }
    }
    return { kind: "navigate", path, query };
  }
  return null;
}

export function buildNavigateHref(action: CopilotNavigateAction): string {
  const sp = new URLSearchParams();
  const q = action.query ?? {};
  for (const [k, v] of Object.entries(q)) {
    if (v == null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `${action.path}?${s}` : action.path;
}

export function applyCopilotNavigateAction(router: CopilotPushRouter, action: CopilotNavigateAction): void {
  router.push(buildNavigateHref(action));
}
