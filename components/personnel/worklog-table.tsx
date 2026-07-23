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
  ITSUP: "bg-primary/10 text-primary border-primary/20",
  INFRA: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  SEC: "bg-warning/10 text-warning border-warning/20",
  PROJ: "bg-positive/10 text-positive border-positive/20",
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
    <div className="rounded-lg border border-border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            <TableHead className="text-muted-foreground font-semibold pl-4">Issue</TableHead>
            <TableHead className="text-muted-foreground font-semibold">Project</TableHead>
            <TableHead className="text-muted-foreground font-semibold">Author</TableHead>
            <TableHead className="text-muted-foreground font-semibold text-right">Hours</TableHead>
            <TableHead className="text-muted-foreground font-semibold text-right">Cost</TableHead>
            <TableHead className="text-muted-foreground font-semibold text-right pr-4">Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {recent.length === 0 ? (
            <TableRow className="border-border hover:bg-transparent">
              <TableCell colSpan={6} className="text-center text-muted-foreground/70 py-12 text-sm">
                No worklog entries found.
              </TableCell>
            </TableRow>
          ) : (
            recent.map((wl, idx) => (
              <TableRow key={`${wl.issueKey}-${idx}`} className="border-border/50 hover:bg-accent">
                <TableCell className="pl-4 py-3">
                  <div className="flex flex-col">
                    <span className="text-xs font-mono font-semibold text-primary">
                      {wl.issueKey}
                    </span>
                    <span className="text-xs text-muted-foreground max-w-[200px] truncate">
                      {wl.issueSummary}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge
                    className={`text-[11px] border ${PROJECT_BADGE[wl.project] || "bg-muted text-muted-foreground border-border"}`}
                  >
                    {wl.project}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-foreground">{wl.author}</TableCell>
                <TableCell className="text-right font-mono text-sm text-foreground tabular-nums">
                  {wl.timeSpentHours}h
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-foreground tabular-nums">
                  {wl.totalCost != null ? `€${wl.totalCost.toFixed(0)}` : "—"}
                </TableCell>
                <TableCell className="text-right text-xs text-muted-foreground tabular-nums pr-4">
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
