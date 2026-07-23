"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Legend } from "recharts";
import { formatCurrency } from "@/lib/utils";
import { useChartPalette } from "@/lib/chart-theme";
import type { ForecastPoint } from "@/lib/types";

const MONTHS = ["Jan", "Feb", "Mrt", "Apr", "Mei", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dec"];
function label(m: string): string {
  const [y, mm] = m.split("-");
  return `${MONTHS[Number(mm) - 1] ?? mm} '${(y || "").slice(2)}`;
}

export function ForecastChart({ points }: { points: ForecastPoint[] }) {
  const p = useChartPalette();
  const data = points.map((pt) => ({ ...pt, m: label(pt.month) }));
  const firstForecast = data.find((d) => d.forecast != null && d.actual == null);

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 10, right: 20, bottom: 0, left: 10 }}>
        <CartesianGrid stroke={p.grid} />
        <XAxis dataKey="m" stroke={p.axis} tick={{ fill: p.text, fontSize: 11 }} interval={1} />
        <YAxis stroke={p.axis} tick={{ fill: p.textMuted, fontSize: 11 }} tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v))} />
        <Tooltip
          contentStyle={{ backgroundColor: p.tooltipBg, border: `1px solid ${p.tooltipBorder}`, borderRadius: 8, color: p.text }}
          formatter={(v) => (v != null ? formatCurrency(Number(v)) : "—")}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {firstForecast && (
          <ReferenceLine x={firstForecast.m} stroke={p.axis} strokeDasharray="4 4" label={{ value: "now", fill: p.textMuted, fontSize: 10, position: "insideTopRight" }} />
        )}
        <Line type="monotone" dataKey="actual" name="Actual" stroke={p.income} strokeWidth={2} dot={false} connectNulls={false} />
        <Line type="monotone" dataKey="forecast" name="Forecast" stroke={p.warning} strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
