"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";
import type { Contract } from "@/lib/types";
import { useChartPalette } from "@/lib/chart-theme";

interface ContractTimelineProps {
  contracts: Contract[];
}

interface TimelineTooltipPayloadEntry {
  payload?: { vendor: string; endDate: string; annualCost: number; status: string };
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TimelineTooltipPayloadEntry[];
}) {
  if (!active || !payload?.length || !payload[0].payload) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-popover/95 p-3 shadow-xl backdrop-blur-sm">
      <p className="text-sm font-medium text-foreground">{d.vendor}</p>
      <p className="text-xs text-muted-foreground">
        Ends: {d.endDate}
      </p>
      <p className="text-xs font-mono text-primary">
        €{d.annualCost.toLocaleString("nl-BE")}/yr
      </p>
    </div>
  );
}

export function ContractTimeline({ contracts }: ContractTimelineProps) {
  const p = useChartPalette();
  const STATUS_COLORS: Record<string, string> = {
    active: p.positive,
    expiring_soon: p.warning,
    expired: p.negative,
    cancelled: p.budget,
  };
  const now = new Date();
  const oneYearLater = new Date(now);
  oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);

  // Filter to active/expiring contracts ending within next 18 months
  const relevant = contracts
    .filter((c) => c.status !== "cancelled" && new Date(c.endDate) >= new Date(now.getFullYear(), now.getMonth() - 1, 1))
    .sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime())
    .slice(0, 12);

  // Convert to chart data: each bar represents duration in days from today
  const startRef = new Date(now.getFullYear(), now.getMonth(), 1);
  const chartData = relevant.map((c) => {
    const start = new Date(c.startDate);
    const end = new Date(c.endDate);
    const startOffset = Math.max(0, Math.round((start.getTime() - startRef.getTime()) / 86400000));
    const endOffset = Math.round((end.getTime() - startRef.getTime()) / 86400000);
    return {
      vendor: c.vendor.length > 20 ? c.vendor.substring(0, 20) + "…" : c.vendor,
      start: startOffset,
      duration: endOffset - startOffset,
      endDate: c.endDate,
      annualCost: c.annualCost,
      status: c.status,
    };
  });

  const todayOffset = Math.round((now.getTime() - startRef.getTime()) / 86400000);
  const maxDays = Math.max(...chartData.map((d) => d.start + d.duration), 365);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-foreground">Contract Timeline</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 20, top: 10, bottom: 10 }}>
              <XAxis
                type="number"
                domain={[0, maxDays]}
                tickFormatter={(v) => {
                  const d = new Date(startRef);
                  d.setDate(d.getDate() + v);
                  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
                }}
                stroke={p.textMuted}
                fontSize={11}
              />
              <YAxis type="category" dataKey="vendor" width={120} stroke={p.text} fontSize={11} />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine x={todayOffset} stroke={p.income} strokeDasharray="3 3" label={{ value: "Today", fill: p.income, fontSize: 10 }} />
              <Bar dataKey="duration" stackId="a" radius={[0, 4, 4, 0]}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={STATUS_COLORS[entry.status] || p.budget} />
                ))}
              </Bar>
              <Bar dataKey="start" stackId="a" fill="transparent" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
