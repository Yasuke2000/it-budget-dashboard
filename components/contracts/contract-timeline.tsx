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

interface ContractTimelineProps {
  contracts: Contract[];
}

const STATUS_COLORS: Record<string, string> = {
  active: "#0d9488",
  expiring_soon: "#f59e0b",
  expired: "#ef4444",
  cancelled: "#6b7280",
};

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
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 shadow-xl">
      <p className="text-sm font-medium text-slate-300">{d.vendor}</p>
      <p className="text-xs text-slate-400">
        Ends: {d.endDate}
      </p>
      <p className="text-xs font-mono text-teal-400">
        €{d.annualCost.toLocaleString("nl-BE")}/yr
      </p>
    </div>
  );
}

export function ContractTimeline({ contracts }: ContractTimelineProps) {
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
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-2">
        <CardTitle className="text-white">Contract Timeline</CardTitle>
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
                stroke="#94a3b8"
                fontSize={11}
              />
              <YAxis type="category" dataKey="vendor" width={120} stroke="#94a3b8" fontSize={11} />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine x={todayOffset} stroke="#0d9488" strokeDasharray="3 3" label={{ value: "Today", fill: "#0d9488", fontSize: 10 }} />
              <Bar dataKey="duration" stackId="a" radius={[0, 4, 4, 0]}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={STATUS_COLORS[entry.status] || "#6b7280"} />
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
