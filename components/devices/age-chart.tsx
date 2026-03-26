"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { ManagedDevice } from "@/lib/types";

interface AgeChartProps {
  devices: ManagedDevice[];
}

interface AgeBucket {
  label: string;
  min: number;
  max: number;
  color: string;
}

const AGE_BUCKETS: AgeBucket[] = [
  { label: "0–1 yr", min: 0, max: 1, color: "#0d9488" },
  { label: "1–2 yr", min: 1, max: 2, color: "#0d9488" },
  { label: "2–3 yr", min: 2, max: 3, color: "#0d9488" },
  { label: "3–4 yr", min: 3, max: 4, color: "#f59e0b" },
  { label: "4–5 yr", min: 4, max: 5, color: "#ef4444" },
  { label: "5+ yr", min: 5, max: Infinity, color: "#ef4444" },
];

interface AgeTooltipPayloadEntry {
  value: number;
  fill?: string;
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: AgeTooltipPayloadEntry[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const count = payload[0].value as number;
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 shadow-xl">
      <p className="text-sm font-semibold text-white">{label}</p>
      <p className="text-sm font-mono" style={{ color: payload[0].fill }}>
        {count} device{count !== 1 ? "s" : ""}
      </p>
    </div>
  );
}

export function AgeChart({ devices }: AgeChartProps) {
  const data = AGE_BUCKETS.map((bucket) => ({
    label: bucket.label,
    count: devices.filter(
      (d) => d.ageYears >= bucket.min && d.ageYears < bucket.max
    ).length,
    color: bucket.color,
  }));

  return (
    <div className="h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis
            dataKey="label"
            stroke="#94a3b8"
            fontSize={12}
            tick={{ fill: "#94a3b8" }}
          />
          <YAxis
            stroke="#94a3b8"
            fontSize={12}
            tick={{ fill: "#94a3b8" }}
            allowDecimals={false}
            width={30}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
          <Bar dataKey="count" name="Devices" radius={[4, 4, 0, 0]}>
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} fillOpacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
