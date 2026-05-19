"use client";

import { useEffect, useMemo, useState } from "react";
import { AdminTopbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useUpdateGovernanceSettings } from "@/lib/mutations";
import {
  useGovernanceAdminBrief,
  useGovernanceAuditRuns,
  useGovernanceNotifications,
  useGovernanceObservability,
  useGovernanceOverview,
  useGovernanceProviders,
  useGovernanceRiskSignals,
  useGovernanceSettings,
  useGovernanceTimeline,
} from "@/lib/queries";
import { cn } from "@/lib/utils";

export default function GovernanceConsolePage() {
  const overview = useGovernanceOverview();
  const timeline = useGovernanceTimeline(90);
  const audit = useGovernanceAuditRuns(0);
  const providers = useGovernanceProviders();
  const risk = useGovernanceRiskSignals();
  const notifications = useGovernanceNotifications();
  const observability = useGovernanceObservability();
  const brief = useGovernanceAdminBrief();
  const settingsQ = useGovernanceSettings();
  const save = useUpdateGovernanceSettings();

  const stored = useMemo(() => settingsQ.data?.settings ?? {}, [settingsQ.data?.settings]);

  const [autoEnabled, setAutoEnabled] = useState(true);
  const [tickSec, setTickSec] = useState(120);
  const [primary, setPrimary] = useState<"openai" | "anthropic">("openai");
  const [fallback, setFallback] = useState<"" | "openai" | "anthropic">("");

  useEffect(() => {
    const a = stored["autonomous_agents_enabled"]?.value?.enabled;
    if (typeof a === "boolean") setAutoEnabled(a);
    const s = stored["autonomous_tick_interval_sec"]?.value?.seconds;
    if (typeof s === "number" && Number.isFinite(s)) setTickSec(s);
    const pr = stored["provider_routing"]?.value?.primary;
    if (pr === "openai" || pr === "anthropic") setPrimary(pr);
    const fb = stored["provider_routing"]?.value?.fallback;
    if (fb === "openai" || fb === "anthropic") setFallback(fb);
    else if (fb === "" || fb == null) setFallback("");
  }, [stored]);

  const hints = overview.data?.runtime_env_hints;
  const rollups = useMemo(() => providers.data?.rollups ?? [], [providers.data?.rollups]);

  async function onSave() {
    await save.mutateAsync({
      autonomous_agents_enabled: { enabled: autoEnabled },
      autonomous_tick_interval_sec: { seconds: tickSec },
      provider_routing: {
        primary,
        fallback: fallback || "",
      },
    });
  }

  return (
    <>
      <AdminTopbar
        title="AI Governance"
        subtitle="Operational intelligence, auditability, and controls — non-custodial posture preserved"
      />
      <main className="flex-1 space-y-4 p-4 lg:p-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi title="Orch. runs (24h)" value={String(overview.data?.orchestration_runs_24h ?? "—")} loading={overview.isLoading} />
          <Kpi
            title="OK rate (24h)"
            value={
              overview.data?.orchestration_ok_rate_24h != null
                ? `${(overview.data.orchestration_ok_rate_24h * 100).toFixed(1)}%`
                : "—"
            }
            loading={overview.isLoading}
          />
          <Kpi title="Intel events (24h)" value={String(overview.data?.intel_events_24h ?? "—")} loading={overview.isLoading} />
          <Kpi title="Gov. samples (24h)" value={String(overview.data?.governance_metric_samples_24h ?? "—")} loading={overview.isLoading} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="border-border/80">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Governance controls</CardTitle>
              <CardDescription>Admin-scoped, auditable runtime policies (stored in PostgreSQL).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label htmlFor="gov-auto">Autonomous agents</Label>
                  <p className="text-[11px] text-muted-foreground">Disable to pause monitoring ticks (read-only agents).</p>
                </div>
                <input
                  id="gov-auto"
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={autoEnabled}
                  onChange={(e) => setAutoEnabled(e.target.checked)}
                  disabled={settingsQ.isLoading}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gov-tick">Tick interval (seconds)</Label>
                <Input
                  id="gov-tick"
                  type="number"
                  min={30}
                  max={3600}
                  value={tickSec}
                  onChange={(e) => setTickSec(Number(e.target.value))}
                  className="max-w-[200px]"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Primary LLM vendor</Label>
                  <select
                    className={cn(
                      "h-9 w-full rounded-md border border-input bg-background px-2 text-sm",
                      "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                    value={primary}
                    onChange={(e) => setPrimary(e.target.value as "openai" | "anthropic")}
                  >
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Fallback vendor</Label>
                  <select
                    className={cn(
                      "h-9 w-full rounded-md border border-input bg-background px-2 text-sm",
                      "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                    value={fallback}
                    onChange={(e) => setFallback(e.target.value as "" | "openai" | "anthropic")}
                  >
                    <option value="">None</option>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                  </select>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Env defaults: provider <span className="font-medium">{hints?.env_provider}</span>, fallback{" "}
                <span className="font-medium">{hints?.env_fallback_provider ?? "none"}</span>. Stored routing overrides
                synthesis chain when keys are configured.
              </p>
              <Button onClick={() => void onSave()} disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save governance settings"}
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/80">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Operational notifications</CardTitle>
              <CardDescription>Severity-aware signals from governance events and derived heuristics.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="max-h-56 space-y-2 overflow-y-auto text-sm">
                {(notifications.data?.items ?? []).length ? (
                  notifications.data!.items.map((n, i) => (
                    <li key={`${n.title}-${i}`} className="rounded-md border border-border/60 bg-muted/20 px-2 py-1.5">
                      <span className="font-medium">{n.title}</span>{" "}
                      <span className="text-muted-foreground">({n.severity})</span>
                      {n.created_at ? (
                        <span className="ml-2 text-[11px] text-muted-foreground">{new Date(n.created_at).toLocaleString()}</span>
                      ) : null}
                    </li>
                  ))
                ) : notifications.isLoading ? (
                  <Skeleton className="h-8 w-full" />
                ) : (
                  <li className="text-muted-foreground">No active notifications.</li>
                )}
              </ul>
            </CardContent>
          </Card>
        </div>

        <Card className="border-border/80">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Admin intelligence brief</CardTitle>
            <CardDescription>Deterministic narrative from live metrics and risk analytics (no extra LLM calls).</CardDescription>
          </CardHeader>
          <CardContent>
            {brief.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-border/60 bg-muted/15 p-3 text-xs leading-relaxed text-muted-foreground">
                {brief.data?.text ?? ""}
              </pre>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="border-border/80">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Provider intelligence (7d)</CardTitle>
              <CardDescription>Latency, fallbacks, tokens, and heuristic cost from persisted samples.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {providers.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : rollups.length ? (
                rollups.map((r) => (
                  <div key={r.provider} className="space-y-1 rounded-lg border border-border/60 p-2.5">
                    <div className="flex items-center justify-between text-sm font-medium capitalize">{r.provider}</div>
                    <div className="grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
                      <span>samples {r.samples_7d}</span>
                      <span>fallback rate {(r.fallback_rate_7d * 100).toFixed(1)}%</span>
                      <span>avg latency {r.avg_latency_ms_7d.toFixed(0)} ms</span>
                      <span>est. cost ≈ ${r.estimated_cost_usd_7d.toFixed(3)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-primary/80"
                        style={{ width: `${Math.min(100, r.fallback_rate_7d * 100 * 2)}%` }}
                      />
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No LLM synthesis samples recorded yet in this window.</p>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/80">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Risk analytics (foundational)</CardTitle>
              <CardDescription>Analytics-only signals — no automated enforcement.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="max-h-64 space-y-2 overflow-y-auto text-sm">
                {(risk.data?.signals ?? []).length ? (
                  risk.data!.signals.map((s, idx) => (
                    <li key={`${s.signal_id}-${idx}`} className="rounded-md border border-border/60 px-2 py-1.5">
                      <div className="font-medium text-foreground">{s.summary}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {s.signal_id} · {s.severity}
                        {s.wallet_address ? ` · ${s.wallet_address}` : ""}
                      </div>
                    </li>
                  ))
                ) : risk.isLoading ? (
                  <Skeleton className="h-8 w-full" />
                ) : (
                  <li className="text-muted-foreground">No threshold breaches detected.</li>
                )}
              </ul>
            </CardContent>
          </Card>
        </div>

        <Card className="border-border/80">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Observability snapshot</CardTitle>
            <CardDescription>Step outcomes and governance metric keys (24h).</CardDescription>
          </CardHeader>
          <CardContent>
            {observability.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-md border border-border/60 p-2">
                  <div className="text-[11px] font-medium uppercase text-muted-foreground">Orchestration steps</div>
                  <div className="mt-1 text-muted-foreground">
                    ok: <span className="text-foreground">{String(observability.data?.orchestration?.steps_ok_24h ?? "—")}</span> · errors:{" "}
                    <span className="text-foreground">{String(observability.data?.orchestration?.steps_error_24h ?? "—")}</span>
                  </div>
                </div>
                <div className="rounded-md border border-border/60 p-2">
                  <div className="text-[11px] font-medium uppercase text-muted-foreground">Metric keys (24h)</div>
                  <ul className="mt-1 max-h-24 overflow-y-auto text-[11px] text-muted-foreground">
                    {(observability.data?.metrics?.samples_by_key_24h ?? []).map((m) => (
                      <li key={m.metric_key}>
                        {m.metric_key}: {m.samples_24h}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="border-border/80">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Governance timeline</CardTitle>
              <CardDescription>Unified stream of governance events and intelligence feed entries.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="max-h-80 space-y-2 overflow-y-auto text-xs">
                {(timeline.data?.items ?? []).map((e) => (
                  <li key={`${e.source}-${e.id}-${e.created_at}`} className="border-b border-border/40 pb-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-muted px-1.5 py-0.5 font-medium">{e.source}</span>
                      <span className="text-muted-foreground">{e.kind}</span>
                      <span className="text-muted-foreground">({e.severity})</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {e.created_at ? new Date(e.created_at).toLocaleString() : ""}
                      {e.trace_id ? ` · trace ${e.trace_id.slice(0, 10)}…` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card className="border-border/80">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">AI audit — recent runs</CardTitle>
              <CardDescription>Durable orchestration runs (open a run in the API for full step JSON).</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-h-80 overflow-x-auto overflow-y-auto text-xs">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-border text-[11px] uppercase text-muted-foreground">
                      <th className="py-1 pr-2">When</th>
                      <th className="py-1 pr-2">Mode</th>
                      <th className="py-1 pr-2">Status</th>
                      <th className="py-1">User</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(audit.data?.items ?? []).map((r) => (
                      <tr key={r.id} className="border-b border-border/40">
                        <td className="py-1 pr-2 whitespace-nowrap text-muted-foreground">
                          {r.created_at ? new Date(r.created_at).toLocaleString() : "—"}
                        </td>
                        <td className="py-1 pr-2 font-mono text-[11px]">{r.execution_mode}</td>
                        <td className="py-1 pr-2">{r.status}</td>
                        <td className="py-1 font-mono text-[11px]">{r.wallet_address ?? r.user_id}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  );
}

function Kpi({ title, value, loading }: { title: string; value: string; loading?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3.5 shadow-[inset_0_1px_0_hsl(var(--border)/0.6)]">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{title}</div>
      {loading ? <Skeleton className="mt-2 h-7 w-16" /> : <div className="mt-1.5 text-xl font-semibold tracking-tight text-primary">{value}</div>}
    </div>
  );
}
