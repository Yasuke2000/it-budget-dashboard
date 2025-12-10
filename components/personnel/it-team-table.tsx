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
                  <Badge className="bg-teal-500/10 text-teal-400 border border-teal-500/20 text-[11px]">
                    {emp.functionTitle}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-slate-400 tabular-nums">
                  {formatDate(emp.startDate)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-white tabular-nums">
                  {emp.monthlyCost ? formatCurrency(emp.monthlyCost) : "—"}
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-slate-300 tabular-nums pr-4">
                  {emp.monthlyCost ? formatCurrency(emp.monthlyCost * 12) : "—"}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
