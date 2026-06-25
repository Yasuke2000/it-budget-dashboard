"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Legend } from "recharts";
import { formatCurrency } from "@/lib/utils";
import type { ForecastPoint } from "@/lib/types";

const MONTHS = ["Jan", "Feb", "Mrt", "Apr", "Mei", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dec"];
function label(m: string): string {
  const [y, mm] = m.split("-");
  return `${MONTHS[Number(mm) - 1] ?? mm} '${(y || "").slice(2)}`;
}

export function ForecastChart({ points }: { points: ForecastPoint[] }) {
  const data = points.map((p) => ({ ...p, m: label(p.month) }));
  const firstForecast = data.find((d) => d.forecast != null && d.actual == null);

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 10, right: 20, bottom: 0, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis dataKey="m" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} interval={1} />
        <YAxis stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v))} />
        <Tooltip
          contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0" }}
          formatter={(v) => (v != null ? formatCurrency(Number(v)) : "—")}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {firstForecast && (
          <ReferenceLine x={firstForecast.m} stroke="#475569" strokeDasharray="4 4" label={{ value: "now", fill: "#64748b", fontSize: 10, position: "insideTopRight" }} />
        )}
        <Line type="monotone" dataKey="actual" name="Actual" stroke="#2dd4bf" strokeWidth={2} dot={false} connectNulls={false} />
        <Line type="monotone" dataKey="forecast" name="Forecast" stroke="#fbbf24" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
