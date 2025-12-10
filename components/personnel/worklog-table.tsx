"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { JiraWorklog } from "@/lib/types";

interface WorklogTableProps {
  worklogs: JiraWorklog[];
}

const PROJECT_BADGE: Record<string, string> = {
  ITSUP: "bg-teal-500/10 text-teal-400 border-teal-500/20",
  INFRA: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  SEC: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  PROJ: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
};

function formatDate(dateStr: string): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export function WorklogTable({ worklogs }: WorklogTableProps) {
  const recent = [...worklogs]
    .sort((a, b) => b.started.localeCompare(a.started))
    .slice(0, 20);

  return (
    <div className="rounded-lg border border-slate-800 overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="border-slate-800 hover:bg-transparent">
            <TableHead className="text-slate-400 font-semibold pl-4">Issue</TableHead>
            <TableHead className="text-slate-400 font-semibold">Project</TableHead>
            <TableHead className="text-slate-400 font-semibold">Author</TableHead>
            <TableHead className="text-slate-400 font-semibold text-right">Hours</TableHead>
            <TableHead className="text-slate-400 font-semibold text-right">Cost</TableHead>
            <TableHead className="text-slate-400 font-semibold text-right pr-4">Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {recent.length === 0 ? (
            <TableRow className="border-slate-800 hover:bg-transparent">
              <TableCell colSpan={6} className="text-center text-slate-600 py-12 text-sm">
                No worklog entries found.
              </TableCell>
            </TableRow>
          ) : (
            recent.map((wl, idx) => (
              <TableRow key={`${wl.issueKey}-${idx}`} className="border-slate-800/50 hover:bg-slate-800/30">
                <TableCell className="pl-4 py-3">
                  <div className="flex flex-col">
                    <span className="text-xs font-mono font-semibold text-teal-400">
                      {wl.issueKey}
                    </span>
                    <span className="text-xs text-slate-400 max-w-[200px] truncate">
                      {wl.issueSummary}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge
                    className={`text-[11px] border ${PROJECT_BADGE[wl.project] || "bg-slate-500/10 text-slate-400 border-slate-500/20"}`}
                  >
                    {wl.project}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-slate-300">{wl.author}</TableCell>
                <TableCell className="text-right font-mono text-sm text-white tabular-nums">
                  {wl.timeSpentHours}h
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-slate-300 tabular-nums">
                  {wl.totalCost != null ? `€${wl.totalCost.toFixed(0)}` : "—"}
                </TableCell>
                <TableCell className="text-right text-xs text-slate-500 tabular-nums pr-4">
                  {formatDate(wl.started)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
