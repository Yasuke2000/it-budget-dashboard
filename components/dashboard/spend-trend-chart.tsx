"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { MonthlySpend } from "@/lib/types";
import { formatCurrency, getMonthName } from "@/lib/utils";
import { useChartPalette } from "@/lib/chart-theme";

interface SpendTrendChartProps {
  data: MonthlySpend[];
}

interface SpendTooltipPayloadEntry {
  name?: string;
  value: number;
  color?: string;
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: SpendTooltipPayloadEntry[]; label?: string }) {
  if (!active || !payload) return null;
  return (
    <div className="rounded-lg border border-border bg-popover/95 p-3 shadow-xl backdrop-blur-sm">
      <p className="mb-1 text-sm font-medium text-muted-foreground">{label}</p>
      {payload.map((entry, index: number) => (
        <p key={index} className="font-mono text-sm tabnum" style={{ color: entry.color }}>
          {entry.name}: {formatCurrency(entry.value)}
        </p>
      ))}
    </div>
  );
}

export function SpendTrendChart({ data }: SpendTrendChartProps) {
  const p = useChartPalette();
  const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const chartData = data.map((d) => ({
    ...d,
    name: getMonthName(d.month),
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Monthly spend vs budget</CardTitle>
      </CardHeader>
      <CardContent>
        <figure role="figure" aria-label="Monthly spend vs budget trend chart">
        <div className="h-[350px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="actualGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={p.income} stopOpacity={0.28} />
                  <stop offset="95%" stopColor={p.income} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={p.grid} vertical={false} />
              <XAxis dataKey="name" stroke={p.axis} tick={{ fill: p.textMuted, fontSize: 11 }} tickLine={false} />
              <YAxis stroke={p.axis} tick={{ fill: p.textMuted, fontSize: 11 }} tickLine={false} tickFormatter={(v) => `€${(v / 1000).toFixed(0)}K`} />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: p.axis, strokeWidth: 1 }} />
              <Legend wrapperStyle={{ color: p.text, fontSize: 12 }} iconType="plainline" />
              <Area type="stepAfter" dataKey="budget" name="Budget" stroke={p.budget} fill="transparent" strokeWidth={1.5} strokeDasharray="5 4" isAnimationActive={!prefersReducedMotion} />
              <Area type="monotone" dataKey="actual" name="Actual" stroke={p.income} fill="url(#actualGradient)" strokeWidth={2} isAnimationActive={!prefersReducedMotion} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <figcaption className="sr-only">Chart showing monthly IT spending compared to budget over the past 12 months</figcaption>
        </figure>
      </CardContent>
    </Card>
  );
}
