"use client";

import { useEffect, useState } from "react";
import { KPICard } from "@/components/dashboard/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import type { SavingsOpportunity } from "@/lib/types";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
} from "recharts";

const STATUS_COLORS: Record<SavingsOpportunity["status"], string> = {
  identified: "bg-slate-600 text-slate-200",
  in_review: "bg-amber-600/80 text-amber-100",
  approved: "bg-blue-600/80 text-blue-100",
  reclaimed: "bg-emerald-600/80 text-emerald-100",
};

export default function SavingsPage() {
  const [opportunities, setOpportunities] = useState<SavingsOpportunity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/savings")
      .then((r) => r.json())
      .then((data) => {
        setOpportunities(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-slate-400">Loading savings pipeline...</p>
      </div>
    );
  }

  const totalAnnualSavings = opportunities.reduce((s, o) => s + o.annualSavings, 0);
  const totalUnused = opportunities.reduce((s, o) => s + o.unusedCount, 0);
  const totalLicenses = opportunities.reduce((s, o) => s + o.totalLicenses, 0);
  const totalAssigned = opportunities.reduce((s, o) => s + o.assignedLicenses, 0);
  const overallUtilization = totalLicenses > 0 ? (totalAssigned / totalLicenses) * 100 : 0;

  // Stacked bar chart data
  const utilizationData = opportunities.map((o) => ({
    name: o.displayName.length > 25 ? o.displayName.slice(0, 22) + "..." : o.displayName,
    assigned: o.assignedLicenses,
    unused: o.unusedCount,
  }));

  // Cumulative savings projection (12 months)
  const monthlySavings = totalAnnualSavings / 12;
  const projectionData = Array.from({ length: 13 }, (_, i) => ({
    month: i === 0 ? "Now" : `M${i}`,
    savings: Math.round(monthlySavings * i),
  }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">License Savings Pipeline</h1>
        <p className="text-slate-400">
          Prioritized savings opportunities from license waste analysis
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KPICard
          title="Identified Savings"
          value={formatCurrency(totalAnnualSavings)}
          iconName="DollarSign"
          description="Annual savings potential"
          changeType="positive"
          change={`${formatCurrency(totalAnnualSavings / 12)}/month`}
        />
        <KPICard
          title="Unused Licenses"
          value={String(totalUnused)}
          iconName="AlertTriangle"
          description={`Across ${opportunities.length} SKUs with waste`}
          changeType="negative"
          change={`${formatCurrency(opportunities.reduce((s, o) => s + o.monthlyWaste, 0))}/month wasted`}
        />
        <KPICard
          title="License Utilization"
          value={`${overallUtilization.toFixed(1)}%`}
          iconName="Key"
          description={`${totalAssigned} of ${totalLicenses} licenses assigned`}
          changeType={overallUtilization >= 90 ? "positive" : "neutral"}
        />
      </div>

      {/* Utilization Bar Chart */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white text-base">License Utilization by SKU</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={opportunities.length * 50 + 40}>
            <BarChart layout="vertical" data={utilizationData} margin={{ left: 20, right: 20 }}>
              <XAxis type="number" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 12 }} />
              <YAxis
                type="category"
                dataKey="name"
                width={180}
                tick={{ fill: "#94a3b8", fontSize: 12 }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#1e293b",
                  border: "1px solid #334155",
                  borderRadius: 8,
                  color: "#e2e8f0",
                }}
              />
              <Bar dataKey="assigned" stackId="a" fill="#34d399" name="Assigned" radius={[0, 0, 0, 0]} />
              <Bar dataKey="unused" stackId="a" fill="#ef4444" name="Unused" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Savings Pipeline Table */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white text-base">Savings Pipeline</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left px-4 py-3 text-slate-400 font-medium">SKU Name</th>
                  <th className="text-right px-4 py-3 text-slate-400 font-medium">Total</th>
                  <th className="text-right px-4 py-3 text-slate-400 font-medium">Assigned</th>
                  <th className="text-right px-4 py-3 text-slate-400 font-medium">Unused</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium w-32">Utilization</th>
                  <th className="text-right px-4 py-3 text-slate-400 font-medium">Monthly Waste</th>
                  <th className="text-right px-4 py-3 text-slate-400 font-medium">Annual Savings</th>
                  <th className="text-center px-4 py-3 text-slate-400 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {opportunities.map((opp) => (
                  <tr key={opp.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                    <td className="px-4 py-3 text-white font-medium">{opp.displayName}</td>
                    <td className="px-4 py-3 text-right text-slate-300 tabular-nums">{opp.totalLicenses}</td>
                    <td className="px-4 py-3 text-right text-slate-300 tabular-nums">{opp.assignedLicenses}</td>
                    <td className="px-4 py-3 text-right text-red-400 tabular-nums font-medium">{opp.unusedCount}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-slate-700 overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${opp.utilization}%`,
                              backgroundColor:
                                opp.utilization >= 90
                                  ? "#34d399"
                                  : opp.utilization >= 70
                                  ? "#fbbf24"
                                  : "#ef4444",
                            }}
                          />
                        </div>
                        <span className="text-xs text-slate-400 tabular-nums w-10 text-right">
                          {opp.utilization.toFixed(0)}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300 tabular-nums">
                      {formatCurrency(opp.monthlyWaste)}
                    </td>
                    <td className="px-4 py-3 text-right text-emerald-400 font-bold tabular-nums">
                      {formatCurrency(opp.annualSavings)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge className={`${STATUS_COLORS[opp.status]} border-0 text-xs`}>
                        {opp.status.replace("_", " ")}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {opportunities.length === 0 && (
            <div className="py-12 text-center">
              <p className="text-slate-400">No savings opportunities detected — all licenses are fully utilized.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cumulative Savings Area Chart */}
      {totalAnnualSavings > 0 && (
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white text-base">Projected Cumulative Savings</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={projectionData} margin={{ top: 10, right: 20, bottom: 0, left: 20 }}>
                <defs>
                  <linearGradient id="savingsGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#14b8a6" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#14b8a6" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="month" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                <YAxis
                  stroke="#475569"
                  tick={{ fill: "#94a3b8", fontSize: 12 }}
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)
                  }
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1e293b",
                    border: "1px solid #334155",
                    borderRadius: 8,
                    color: "#e2e8f0",
                  }}
                  formatter={(value) => [formatCurrency(Number(value ?? 0)), "Savings"]}
                />
                <Area
                  type="monotone"
                  dataKey="savings"
                  stroke="#14b8a6"
                  strokeWidth={2}
                  fill="url(#savingsGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
