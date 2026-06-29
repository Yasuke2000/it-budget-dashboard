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

  return (
    <div className="rounded-lg border border-slate-800 overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="border-slate-800 hover:bg-transparent">
            <TableHead className="text-slate-400 font-semibold pl-4">Name</TableHead>
            <TableHead className="text-slate-400 font-semibold">Role</TableHead>
            <TableHead className="text-slate-400 font-semibold">Start Date</TableHead>
            <TableHead className="text-slate-400 font-semibold text-right">Monthly Cost</TableHead>
            <TableHead className="text-slate-400 font-semibold text-right pr-4">Annual Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {itTeam.length === 0 ? (
            <TableRow className="border-slate-800 hover:bg-transparent">
              <TableCell colSpan={5} className="text-center text-slate-600 py-12 text-sm">
                No IT team members found.
              </TableCell>
            </TableRow>
          ) : (
            itTeam.map((emp) => (
              <TableRow key={emp.id} className="border-slate-800/50 hover:bg-slate-800/30">
                <TableCell className="pl-4 py-3">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-white">{emp.name}</span>
                    <span className="text-xs text-slate-500">{emp.email}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <Badge className="bg-teal-500/10 text-teal-400 border border-teal-500/20 text-[11px]">
                      {emp.functionTitle || "—"}
                    </Badge>
                    {emp.isStudent && (
                      <Badge className="bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[11px]">
                        Student
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-xs text-slate-400 tabular-nums">
                  {formatDate(emp.startDate)}
                </TableCell>
                <TableCell className={`text-right font-mono text-sm tabular-nums ${emp.isStudent ? "text-slate-500" : "text-white"}`}>
                  {emp.monthlyCost ? `${formatCurrency(emp.monthlyCost)}${emp.isStudent ? "*" : ""}` : "—"}
                </TableCell>
                <TableCell className={`text-right font-mono text-sm tabular-nums pr-4 ${emp.isStudent ? "text-slate-500" : "text-slate-300"}`}>
                  {emp.monthlyCost ? `${formatCurrency(emp.monthlyCost * 12)}${emp.isStudent ? "*" : ""}` : "—"}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {hasStudent && (
        <p className="text-[11px] text-slate-500 px-4 py-2.5 border-t border-slate-800">
          * Jobstudent — contractual full-month rate shown for reference; works variable hours, so excluded from the IT salary cost total.
        </p>
      )}
    </div>
  );
}
