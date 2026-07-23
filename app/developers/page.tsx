"use client";

import { useEffect, useState } from "react";
import { KPICard } from "@/components/dashboard/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useDateRange } from "@/components/layout/date-range-context";
import { PageHeader } from "@/components/layout/page-header";
import { useChartPalette } from "@/lib/chart-theme";
import { formatCurrency } from "@/lib/utils";
import type { DeveloperDashboard } from "@/lib/types";

function fmtDate(d: string): string {
  if (!d) return "—";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? "—" : dt.toLocaleString("nl-BE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function DevelopersPage() {
  const { selectedRange } = useDateRange();
  const p = useChartPalette();
  const [branch, setBranch] = useState<"dev" | "production">("dev");
  const [data, setData] = useState<DeveloperDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    const qs = new URLSearchParams({ dateFrom: selectedRange.from, dateTo: selectedRange.to, branch });
    fetch(`/api/developers?${qs}`, { signal: controller.signal, cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error(`developers ${r.status}`); return r.json(); })
      .then((d) => { clearTimeout(timer); if (cancelled) return; setData(d); setErrored(false); setLoading(false); })
      .catch(() => { clearTimeout(timer); if (cancelled) return; setErrored(true); setLoading(false); });
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [selectedRange.from, selectedRange.to, branch]);

  if (loading) {
    return <div className="flex items-center justify-center h-64"><p className="text-muted-foreground">Loading developer metrics…</p></div>;
  }
  if (errored || !data) {
    return <div className="flex items-center justify-center h-64"><p className="text-muted-foreground">Developer metrics could not be loaded.</p></div>;
  }

  if (!data.configured) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Developer Dashboard"
          description="Per-developer activity from Azure DevOps"
        />
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <p className="text-foreground font-medium">Azure DevOps is not connected yet.</p>
            <p className="text-muted-foreground text-sm">Set <code className="text-primary">AZURE_DEVOPS_ORG</code> and <code className="text-primary">AZURE_DEVOPS_PAT</code> (Code = Read) to enable per-developer commit metrics.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const barColor = (pct: number) => (pct >= 40 ? p.positive : pct >= 20 ? p.categorical[1] : p.warning);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Developer Dashboard"
        actions={
          /* Dev (develop) ↔ Production (master) branch toggle */
          <div className="inline-flex rounded-lg border border-border bg-card p-0.5 text-sm">
            {(["dev", "production"] as const).map((b) => (
              <button
                key={b}
                onClick={() => setBranch(b)}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors ${branch === b ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                {b === "dev" ? "Dev (develop)" : "Production (master)"}
              </button>
            ))}
          </div>
        }
      />
      <p className="text-muted-foreground -mt-4">
        {data.org}/{data.project} · {selectedRange.label.toLowerCase()} · commits on <span className="text-primary">{data.branches.find((b) => b.commits === data.totalCommits)?.name || (branch === "production" ? "master" : "develop")}</span>
        {data.commitsTruncated ? <span className="text-warning"> · ⚠ capped at 5000 commits (undercount)</span> : null}
      </p>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Total Commits" value={String(data.totalCommits)} iconName="BarChart2" description="Integration branch" changeType="neutral" />
        <KPICard title="Developers" value={String(data.developerCount)} iconName="Users" description="Active in this period" changeType="neutral" />
        <KPICard title="Files Changed" value={data.totalFilesChanged.toLocaleString("nl-BE")} iconName="TrendingUp" description={`+${data.filesAdded} new · ${data.filesEdited} edited · ${data.filesDeleted} deleted`} changeType="neutral" />
        <KPICard title="Avg Files / Commit" value={String(data.avgFilesPerCommit)} iconName="Key" description={`${data.smallCommits} small · ${data.largeCommits} large`} changeType="neutral" />
      </div>

      {/* Cost vs Output — the ROI question */}
      {data.roi && data.roi.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-foreground text-base">Cost vs Output — is the dev spend worth it?</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border text-muted-foreground">
                  <th className="text-left px-4 py-3 font-medium">Developer</th>
                  <th className="text-left px-4 py-3 font-medium">Cost source</th>
                  <th className="text-right px-4 py-3 font-medium">Commits</th>
                  <th className="text-right px-4 py-3 font-medium">Issues</th>
                  <th className="text-right px-4 py-3 font-medium">Cost (period)</th>
                  <th className="text-right px-4 py-3 font-medium">€ / commit</th>
                  <th className="text-right px-4 py-3 font-medium">€ / issue</th>
                </tr></thead>
                <tbody>
                  {data.roi.map((r) => (
                    <tr key={r.email} className="border-b border-border">
                      <td className="px-4 py-3 text-foreground font-medium">{r.name}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{r.costLabel}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground">{r.commits}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground">{r.issues}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground">{r.periodCost != null ? formatCurrency(r.periodCost) : "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-primary">{r.costPerCommit != null ? formatCurrency(r.costPerCommit) : "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-primary">{r.costPerIssue != null ? formatCurrency(r.costPerIssue) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 text-xs text-muted-foreground space-y-1 border-t border-border">
              <p>· Internal devs use their per-person Officient employer cost (gross + charges + provisions), prorated over the period. External devs use BC vendor spend.{data.itDeptPayrollPeriod ? <> Total internal IT-dept payroll booked in BC this period: <span className="text-foreground">{formatCurrency(data.itDeptPayrollPeriod)}</span>.</> : null}</p>
              <p>· Commits &amp; issues are activity proxies, not value. Invoice timing is lumpy — read € / commit over months, not days. A directional signal, not a verdict on individuals.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Jira — tickets & hours per developer */}
      {data.jira ? (
        <Card>
          <CardHeader><CardTitle className="text-foreground text-base">Jira — tickets &amp; hours{data.jira.partial ? " · hours sampled" : ""}{data.jira.countsReliable === false ? " · ⚠ some counts unavailable" : ""}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border text-muted-foreground">
                  <th className="text-left px-4 py-3 font-medium">Developer</th>
                  <th className="text-right px-4 py-3 font-medium">Opened</th>
                  <th className="text-right px-4 py-3 font-medium">Closed</th>
                  <th className="text-right px-4 py-3 font-medium">Open now</th>
                  <th className="text-right px-4 py-3 font-medium">Updated</th>
                  <th className="text-right px-4 py-3 font-medium">Hours</th>
                  <th className="text-right px-4 py-3 font-medium">Response</th>
                </tr></thead>
                <tbody>
                  {data.developers.map((d) => {
                    const j = data.jira?.perDev[d.email] ?? { opened: 0, closed: 0, openNow: 0, updated: 0, hours: 0, responseHours: null };
                    return (
                      <tr key={d.email} className="border-b border-border">
                        <td className="px-4 py-3 text-foreground font-medium">{d.name}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-foreground">{j.opened}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-positive">{j.closed}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-foreground">{j.openNow}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-foreground">{j.updated}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-primary">{j.hours}h</td>
                        <td className="px-4 py-3 text-right tabular-nums text-warning">{j.responseHours != null ? `${j.responseHours}h` : "—"}</td>
                      </tr>
                    );
                  })}
                  <tr className="border-t border-border">
                    <td className="px-4 py-3 text-muted-foreground font-semibold">Team (GP + IT)</td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground font-semibold">{data.jira.team.opened}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground font-semibold">{data.jira.team.closed}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground font-semibold">{data.jira.team.openNow}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground font-semibold">{data.jira.team.updated}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground font-semibold">{data.jira.team.hours}h</td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground font-semibold">{data.jira.team.responseHours != null ? `${data.jira.team.responseHours}h` : "—"}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 text-xs text-muted-foreground border-t border-border">
              · Opened = created (reporter) · Closed = resolved (assignee) · Open now = currently assigned &amp; not Done · Updated = touched in period · Hours = worklog time · Response = avg time from ticket creation to first comment/worklog.{data.jira.partial ? " Hours sampled from the 250 most recent issues with worklogs; response time from the 100 most recently created issues." : ""}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Developer statistics */}
        <Card>
          <CardHeader><CardTitle className="text-foreground text-base">Developer Statistics</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border text-muted-foreground">
                  <th className="text-left px-4 py-3 font-medium">Developer</th>
                  <th className="text-right px-4 py-3 font-medium">Commits</th>
                  <th className="text-right px-4 py-3 font-medium">Issues</th>
                  <th className="text-right px-4 py-3 font-medium">Files</th>
                  <th className="text-right px-4 py-3 font-medium">Avg</th>
                  <th className="text-left px-4 py-3 font-medium w-32">Contribution</th>
                </tr></thead>
                <tbody>
                  {data.developers.map((d) => (
                    <tr key={d.email} className="border-b border-border hover:bg-accent">
                      <td className="px-4 py-3">
                        <div className="text-foreground font-medium">{d.name}</div>
                        <div className="text-xs text-muted-foreground">{d.email}</div>
                      </td>
                      <td className="px-4 py-3 text-right"><Badge className="bg-blue-500/15 text-blue-400 border-0">{d.commits}</Badge></td>
                      <td className="px-4 py-3 text-right text-foreground tabular-nums">{d.issues}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span className="text-positive">+{d.filesAdded}</span>{" "}
                        <span className="text-muted-foreground">~{d.filesEdited}</span>{" "}
                        <span className="text-negative">-{d.filesDeleted}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-foreground tabular-nums">{d.avgFilesPerCommit}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${d.contributionPercent}%`, backgroundColor: barColor(d.contributionPercent) }} />
                          </div>
                          <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">{d.contributionPercent}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {data.developers.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No commits in this period.</td></tr>}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Recent commits */}
        <Card>
          <CardHeader><CardTitle className="text-foreground text-base">Recent Commits</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card"><tr className="border-b border-border text-muted-foreground">
                  <th className="text-left px-4 py-3 font-medium">Author</th>
                  <th className="text-left px-4 py-3 font-medium">Message</th>
                  <th className="text-right px-4 py-3 font-medium">Date</th>
                </tr></thead>
                <tbody>
                  {data.recentCommits.map((c) => (
                    <tr key={c.id} className="border-b border-border">
                      <td className="px-4 py-3 text-foreground whitespace-nowrap">{c.author}</td>
                      <td className="px-4 py-3 text-muted-foreground"><span className="font-mono text-xs">{c.message}</span></td>
                      <td className="px-4 py-3 text-right text-muted-foreground whitespace-nowrap text-xs">{fmtDate(c.date)}</td>
                    </tr>
                  ))}
                  {data.recentCommits.length === 0 && <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">No commits.</td></tr>}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Branch statistics */}
        <Card>
          <CardHeader><CardTitle className="text-foreground text-base">Branch Statistics</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-muted-foreground">
                <th className="text-left px-4 py-3 font-medium">Branch</th>
                <th className="text-right px-4 py-3 font-medium">Commits</th>
                <th className="text-right px-4 py-3 font-medium">Last Activity</th>
              </tr></thead>
              <tbody>
                {data.branches.map((b) => (
                  <tr key={b.name} className="border-b border-border">
                    <td className="px-4 py-3"><Badge className="bg-muted text-foreground border-0 font-mono">{b.name}</Badge></td>
                    <td className="px-4 py-3 text-right text-foreground tabular-nums">{b.commits}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground text-xs">{fmtDate(b.lastActivity || "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Code churn */}
        <Card>
          <CardHeader><CardTitle className="text-foreground text-base">Most Changed Files (churn)</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-muted-foreground">
                <th className="text-left px-4 py-3 font-medium">File</th>
                <th className="text-right px-4 py-3 font-medium">Changes</th>
                <th className="text-left px-4 py-3 font-medium">Contributors</th>
              </tr></thead>
              <tbody>
                {data.churn.map((f) => (
                  <tr key={f.path} className="border-b border-border">
                    <td className="px-4 py-3 text-foreground font-mono text-xs">{f.path.split("/").slice(-1)[0]}</td>
                    <td className="px-4 py-3 text-right"><Badge className="bg-warning/15 text-warning border-0">{f.changes}</Badge></td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{f.contributors.join(", ")}</td>
                  </tr>
                ))}
                {data.churn.length === 0 && <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">No churn data.</td></tr>}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* Methodology notes */}
      <div className="text-xs text-muted-foreground space-y-1 border-t border-border pt-4">
        {data.notes.map((n, i) => <p key={i}>· {n}</p>)}
      </div>
    </div>
  );
}
