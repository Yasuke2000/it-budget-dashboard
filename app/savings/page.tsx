"use client";

import { useEffect, useState } from "react";
import { KPICard } from "@/components/dashboard/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";
import { useChartPalette } from "@/lib/chart-theme";
import { formatCurrency } from "@/lib/utils";
import type { SavingsOpportunity, LicenseHarvest } from "@/lib/types";
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
  identified: "bg-muted text-foreground",
  in_review: "bg-warning/15 text-warning",
  approved: "bg-blue-500/15 text-blue-400",
  reclaimed: "bg-positive/15 text-positive",
};

export default function SavingsPage() {
  const p = useChartPalette();
  const [opportunities, setOpportunities] = useState<SavingsOpportunity[]>([]);
  const [harvest, setHarvest] = useState<LicenseHarvest | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    fetch("/api/savings", { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`savings ${r.status}`);
        return r.json();
      })
      .then((data) => {
        clearTimeout(timer);
        if (cancelled) return;
        // API returns { opportunities, harvest }; tolerate a bare array too.
        const opps = Array.isArray(data) ? data : data.opportunities ?? [];
        setOpportunities(opps);
        setHarvest(Array.isArray(data) ? null : data.harvest ?? null);
        setLoading(false);
      })
      .catch(() => {
        clearTimeout(timer);
        if (cancelled) return;
        setErrored(true);
        setLoading(false);
      });
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [retry]);

  const handleRetry = () => {
    setLoading(true);
    setErrored(false);
    setRetry((c) => c + 1);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Loading savings pipeline...</p>
      </div>
    );
  }

  if (errored) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-muted-foreground">Savings data could not be loaded.</p>
        <button
          onClick={handleRetry}
          className="text-sm text-primary hover:text-primary/80 underline underline-offset-2"
        >
          Retry
        </button>
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
      <div className="space-y-1">
        <PageHeader
          title="License Optimization"
          description="Reclaimable licenses after the optimization buffer (spare seats kept for new hires)"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Microsoft 365 licences are tenant-wide and reflect current state — this page is not affected by the company or date-range filter.
        </p>
        {harvest?.hasUsageData && harvest.totalReclaimableAnnual > 0 && (
          <p className="text-sm text-muted-foreground mt-1">
            Total reclaimable ≈ <span className="text-primary font-semibold">{formatCurrency(harvest.totalReclaimableAnnual)}/yr</span>{" "}
            — {formatCurrency(harvest.unassignedMonthly * 12)} unassigned seats (exact) + {formatCurrency(harvest.inactiveMonthlyEstimate * 12)} assigned-but-inactive (estimate).
          </p>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Identified Savings"
          value={formatCurrency(totalAnnualSavings)}
          iconName="DollarSign"
          description="Unassigned seats (exact)"
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
        {harvest?.hasUsageData ? (
          <KPICard
            title="Inactive Seats (30d)"
            value={String(harvest.inactiveUsers)}
            iconName="Clock"
            description={`~${formatCurrency(harvest.inactiveMonthlyEstimate * 12)}/yr reclaimable (est.)`}
            changeType={harvest.inactiveUsers > 0 ? "negative" : "positive"}
            change={harvest.activePercent != null ? `${harvest.activePercent.toFixed(0)}% active` : undefined}
          />
        ) : (
          <KPICard
            title="License Utilization"
            value={`${overallUtilization.toFixed(1)}%`}
            iconName="Key"
            description={`${totalAssigned} of ${totalLicenses} licenses assigned`}
            changeType={overallUtilization >= 90 ? "positive" : "neutral"}
          />
        )}
        {harvest?.hasUsageData && (
          <KPICard
            title="License Utilization"
            value={`${overallUtilization.toFixed(1)}%`}
            iconName="Key"
            description={`${totalAssigned} of ${totalLicenses} licenses assigned`}
            changeType={overallUtilization >= 90 ? "positive" : "neutral"}
          />
        )}
      </div>

      {/* Utilization Bar Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground text-base">License Utilization by SKU</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={opportunities.length * 50 + 40}>
            <BarChart layout="vertical" data={utilizationData} margin={{ left: 20, right: 20 }}>
              <XAxis type="number" stroke={p.axis} tick={{ fill: p.textMuted, fontSize: 12 }} />
              <YAxis
                type="category"
                dataKey="name"
                width={180}
                tick={{ fill: p.text, fontSize: 12 }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: p.tooltipBg,
                  border: `1px solid ${p.tooltipBorder}`,
                  borderRadius: 8,
                  color: p.text,
                }}
              />
              <Bar dataKey="assigned" stackId="a" fill={p.positive} name="Assigned" radius={[0, 0, 0, 0]} />
              <Bar dataKey="unused" stackId="a" fill={p.negative} name="Unused" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Savings Pipeline Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground text-base">Savings Pipeline</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 text-muted-foreground font-medium">SKU Name</th>
                  <th className="text-right px-4 py-3 text-muted-foreground font-medium">Total</th>
                  <th className="text-right px-4 py-3 text-muted-foreground font-medium">Assigned</th>
                  <th className="text-right px-4 py-3 text-muted-foreground font-medium">Unused</th>
                  <th className="text-left px-4 py-3 text-muted-foreground font-medium w-32">Utilization</th>
                  <th className="text-right px-4 py-3 text-muted-foreground font-medium">Monthly Waste</th>
                  <th className="text-right px-4 py-3 text-muted-foreground font-medium">Annual Savings</th>
                  <th className="text-center px-4 py-3 text-muted-foreground font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {opportunities.map((opp) => (
                  <tr key={opp.id} className="border-b border-border hover:bg-accent">
                    <td className="px-4 py-3 text-foreground font-medium">{opp.displayName}</td>
                    <td className="px-4 py-3 text-right text-foreground tabular-nums">{opp.totalLicenses}</td>
                    <td className="px-4 py-3 text-right text-foreground tabular-nums">{opp.assignedLicenses}</td>
                    <td className="px-4 py-3 text-right text-negative tabular-nums font-medium">{opp.unusedCount}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${opp.utilization}%`,
                              backgroundColor:
                                opp.utilization >= 90
                                  ? p.positive
                                  : opp.utilization >= 70
                                  ? p.warning
                                  : p.negative,
                            }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground tabular-nums w-10 text-right">
                          {opp.utilization.toFixed(0)}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-foreground tabular-nums">
                      {formatCurrency(opp.monthlyWaste)}
                    </td>
                    <td className="px-4 py-3 text-right text-positive font-bold tabular-nums">
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
              <p className="text-muted-foreground">No savings opportunities detected — all licenses are fully utilized.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cumulative Savings Area Chart */}
      {totalAnnualSavings > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground text-base">Projected Cumulative Savings</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={projectionData} margin={{ top: 10, right: 20, bottom: 0, left: 20 }}>
                <defs>
                  <linearGradient id="savingsGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={p.income} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={p.income} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={p.grid} vertical={false} />
                <XAxis dataKey="month" stroke={p.axis} tick={{ fill: p.text, fontSize: 12 }} />
                <YAxis
                  stroke={p.axis}
                  tick={{ fill: p.textMuted, fontSize: 12 }}
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)
                  }
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: p.tooltipBg,
                    border: `1px solid ${p.tooltipBorder}`,
                    borderRadius: 8,
                    color: p.text,
                  }}
                  formatter={(value) => [formatCurrency(Number(value ?? 0)), "Savings"]}
                />
                <Area
                  type="monotone"
                  dataKey="savings"
                  stroke={p.income}
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
