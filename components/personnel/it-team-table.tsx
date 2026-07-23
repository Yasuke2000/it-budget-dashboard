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
import { formatCurrency } from "@/lib/utils";
import type { Employee } from "@/lib/types";

interface ITTeamTableProps {
  employees: Employee[];
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function ITTeamTable({ employees }: ITTeamTableProps) {
  const itTeam = employees
    .filter((e) => e.department === "IT" && e.status === "active")
    .sort((a, b) => (a.monthlyCost || 0) > (b.monthlyCost || 0) ? -1 : 1);
  const hasStudent = itTeam.some((e) => e.isStudent);
  const hasExternal = itTeam.some((e) => e.isExternal);

  return (
    <div className="rounded-lg border border-border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            <TableHead className="text-muted-foreground font-semibold pl-4">Name</TableHead>
            <TableHead className="text-muted-foreground font-semibold">Role</TableHead>
            <TableHead className="text-muted-foreground font-semibold">Start Date</TableHead>
            <TableHead className="text-muted-foreground font-semibold text-right">Monthly Cost</TableHead>
            <TableHead className="text-muted-foreground font-semibold text-right pr-4">Annual Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {itTeam.length === 0 ? (
            <TableRow className="border-border hover:bg-transparent">
              <TableCell colSpan={5} className="text-center text-muted-foreground/70 py-12 text-sm">
                No IT team members found.
              </TableCell>
            </TableRow>
          ) : (
            itTeam.map((emp) => (
              <TableRow key={emp.id} className="border-border/50 hover:bg-accent">
                <TableCell className="pl-4 py-3">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-foreground">{emp.name}</span>
                    <span className="text-xs text-muted-foreground">{emp.email}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <Badge className="bg-primary/10 text-primary border border-primary/20 text-[11px]">
                      {emp.functionTitle || "—"}
                    </Badge>
                    {emp.isStudent && (
                      <Badge className="bg-warning/10 text-warning border border-warning/20 text-[11px]">
                        Student
                      </Badge>
                    )}
                    {emp.isExternal && (
                      <Badge className="bg-violet-500/10 text-violet-400 border border-violet-500/20 text-[11px]">
                        External
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground tabular-nums">
                  {formatDate(emp.startDate)}
                </TableCell>
                <TableCell className={`text-right font-mono text-sm tabular-nums ${emp.isStudent ? "text-muted-foreground" : "text-foreground"}`}>
                  {emp.monthlyCost ? `${formatCurrency(emp.monthlyCost)}${emp.isStudent ? "*" : ""}` : "—"}
                </TableCell>
                <TableCell className={`text-right font-mono text-sm tabular-nums pr-4 ${emp.isStudent ? "text-muted-foreground" : "text-foreground"}`}>
                  {emp.monthlyCost ? `${formatCurrency(emp.monthlyCost * 12)}${emp.isStudent ? "*" : ""}` : "—"}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {(hasStudent || hasExternal) && (
        <p className="text-[11px] text-muted-foreground px-4 py-2.5 border-t border-border space-y-0.5">
          {hasStudent && <>* Jobstudent — contractual full-month rate shown for reference; works variable hours, so excluded from the internal IT salary total.<br /></>}
          {hasExternal && <>External — contractor billed via a vendor (not payroll); cost is counted under External Services, not internal salary.</>}
        </p>
      )}
    </div>
  );
}
