"use client";

import { useEffect, useState } from "react";
import { KPICard } from "@/components/dashboard/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useDateRange } from "@/components/layout/date-range-context";
import type { DeveloperDashboard } from "@/lib/types";

function fmtDate(d: string): string {
  if (!d) return "—";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("nl-BE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function DevelopersPage() {
  const { selectedRange } = useDateRange();
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
    return <div className="flex items-center justify-center h-64"><p className="text-slate-400">Loading developer metrics…</p></div>;
  }
  if (errored || !data) {
    return <div className="flex items-center justify-center h-64"><p className="text-slate-400">Developer metrics could not be loaded.</p></div>;
  }

  if (!data.configured) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Developer Dashboard</h1>
          <p className="text-slate-400">Per-developer activity from Azure DevOps</p>
        </div>
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="py-12 text-center space-y-2">
            <p className="text-slate-300 font-medium">Azure DevOps is not connected yet.</p>
            <p className="text-slate-500 text-sm">Set <code className="text-teal-300">AZURE_DEVOPS_ORG</code> and <code className="text-teal-300">AZURE_DEVOPS_PAT</code> (Code = Read) to enable per-developer commit metrics.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const barColor = (pct: number) => (pct >= 40 ? "#34d399" : pct >= 20 ? "#38bdf8" : "#fbbf24");

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Developer Dashboard</h1>
          <p className="text-slate-400">
            {data.org}/{data.project} · {selectedRange.label.toLowerCase()} · commits on <span className="text-teal-300">{data.branches.find((b) => b.commits === data.totalCommits)?.name || (branch === "production" ? "master" : "develop")}</span>
          </p>
        </div>
        {/* Dev (develop) ↔ Production (master) branch toggle */}
        <div className="inline-flex rounded-lg border border-slate-700 bg-slate-900 p-0.5 text-sm">
          {(["dev", "production"] as const).map((b) => (
            <button
              key={b}
              onClick={() => setBranch(b)}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${branch === b ? "bg-teal-500/20 text-teal-300" : "text-slate-400 hover:text-slate-200"}`}
            >
              {b === "dev" ? "Dev (develop)" : "Production (master)"}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Total Commits" value={String(data.totalCommits)} iconName="BarChart2" description="Integration branch" changeType="neutral" />
        <KPICard title="Developers" value={String(data.developerCount)} iconName="Users" description="Active in this period" changeType="neutral" />
        <KPICard title="Files Changed" value={data.totalFilesChanged.toLocaleString("nl-BE")} iconName="TrendingUp" description={`+${data.filesAdded} new · ${data.filesEdited} edited · ${data.filesDeleted} deleted`} changeType="neutral" />
        <KPICard title="Avg Files / Commit" value={String(data.avgFilesPerCommit)} iconName="Key" description={`${data.smallCommits} small · ${data.largeCommits} large`} changeType="neutral" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Developer statistics */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader><CardTitle className="text-white text-base">Developer Statistics</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-800 text-slate-400">
                  <th className="text-left px-4 py-3 font-medium">Developer</th>
                  <th className="text-right px-4 py-3 font-medium">Commits</th>
                  <th className="text-right px-4 py-3 font-medium">Files</th>
                  <th className="text-right px-4 py-3 font-medium">Avg</th>
                  <th className="text-left px-4 py-3 font-medium w-32">Contribution</th>
                </tr></thead>
                <tbody>
                  {data.developers.map((d) => (
                    <tr key={d.email} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="px-4 py-3">
                        <div className="text-white font-medium">{d.name}</div>
                        <div className="text-xs text-slate-500">{d.email}</div>
                      </td>
                      <td className="px-4 py-3 text-right"><Badge className="bg-blue-600/80 text-blue-100 border-0">{d.commits}</Badge></td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span className="text-emerald-400">+{d.filesAdded}</span>{" "}
                        <span className="text-slate-400">~{d.filesEdited}</span>{" "}
                        <span className="text-red-400">-{d.filesDeleted}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300 tabular-nums">{d.avgFilesPerCommit}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 rounded-full bg-slate-700 overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${d.contributionPercent}%`, backgroundColor: barColor(d.contributionPercent) }} />
                          </div>
                          <span className="text-xs text-slate-400 tabular-nums w-12 text-right">{d.contributionPercent}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {data.developers.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No commits in this period.</td></tr>}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Recent commits */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader><CardTitle className="text-white text-base">Recent Commits</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-900"><tr className="border-b border-slate-800 text-slate-400">
                  <th className="text-left px-4 py-3 font-medium">Author</th>
                  <th className="text-left px-4 py-3 font-medium">Message</th>
                  <th className="text-right px-4 py-3 font-medium">Date</th>
                </tr></thead>
                <tbody>
                  {data.recentCommits.map((c) => (
                    <tr key={c.id} className="border-b border-slate-800/50">
                      <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{c.author}</td>
                      <td className="px-4 py-3 text-slate-400"><span className="font-mono text-xs">{c.message}</span></td>
                      <td className="px-4 py-3 text-right text-slate-500 whitespace-nowrap text-xs">{fmtDate(c.date)}</td>
                    </tr>
                  ))}
                  {data.recentCommits.length === 0 && <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-500">No commits.</td></tr>}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Branch statistics */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader><CardTitle className="text-white text-base">Branch Statistics</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-800 text-slate-400">
                <th className="text-left px-4 py-3 font-medium">Branch</th>
                <th className="text-right px-4 py-3 font-medium">Commits</th>
                <th className="text-right px-4 py-3 font-medium">Last Activity</th>
              </tr></thead>
              <tbody>
                {data.branches.map((b) => (
                  <tr key={b.name} className="border-b border-slate-800/50">
                    <td className="px-4 py-3"><Badge className="bg-slate-700 text-slate-200 border-0 font-mono">{b.name}</Badge></td>
                    <td className="px-4 py-3 text-right text-slate-300 tabular-nums">{b.commits}</td>
                    <td className="px-4 py-3 text-right text-slate-500 text-xs">{fmtDate(b.lastActivity || "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Code churn */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader><CardTitle className="text-white text-base">Most Changed Files (churn)</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-800 text-slate-400">
                <th className="text-left px-4 py-3 font-medium">File</th>
                <th className="text-right px-4 py-3 font-medium">Changes</th>
                <th className="text-left px-4 py-3 font-medium">Contributors</th>
              </tr></thead>
              <tbody>
                {data.churn.map((f) => (
                  <tr key={f.path} className="border-b border-slate-800/50">
                    <td className="px-4 py-3 text-slate-300 font-mono text-xs">{f.path.split("/").slice(-1)[0]}</td>
                    <td className="px-4 py-3 text-right"><Badge className="bg-amber-600/70 text-amber-100 border-0">{f.changes}</Badge></td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{f.contributors.join(", ")}</td>
                  </tr>
                ))}
                {data.churn.length === 0 && <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-500">No churn data.</td></tr>}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* Methodology notes */}
      <div className="text-xs text-slate-500 space-y-1 border-t border-slate-800 pt-4">
        {data.notes.map((n, i) => <p key={i}>· {n}</p>)}
      </div>
    </div>
  );
}
