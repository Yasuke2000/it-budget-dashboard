"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { MonthlySpend } from "@/lib/types";
import { formatCurrency, getMonthName } from "@/lib/utils";

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
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 shadow-xl">
      <p className="text-sm font-medium text-slate-300 mb-1">{label}</p>
      {payload.map((entry, index: number) => (
        <p key={index} className="text-sm font-mono" style={{ color: entry.color }}>
          {entry.name}: {formatCurrency(entry.value)}
        </p>
      ))}
    </div>
  );
}

export function SpendTrendChart({ data }: SpendTrendChartProps) {
  const chartData = data.map((d) => ({
    ...d,
    name: getMonthName(d.month),
  }));

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white">Monthly Spend vs Budget</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[350px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="actualGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0d9488" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#0d9488" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="budgetGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} />
              <YAxis stroke="#94a3b8" fontSize={12} tickFormatter={(v) => `€${(v / 1000).toFixed(0)}K`} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ color: "#94a3b8" }} />
              <Area type="stepAfter" dataKey="budget" name="Budget" stroke="#6366f1" fill="url(#budgetGradient)" strokeWidth={2} strokeDasharray="5 5" />
              <Area type="monotone" dataKey="actual" name="Actual" stroke="#0d9488" fill="url(#actualGradient)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
