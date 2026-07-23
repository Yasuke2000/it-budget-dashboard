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
import { useChartPalette } from "@/lib/chart-theme";

interface AgeChartProps {
  devices: ManagedDevice[];
}

interface AgeBucket {
  label: string;
  min: number;
  max: number;
  tone: "positive" | "warning" | "negative";
}

const AGE_BUCKETS: AgeBucket[] = [
  { label: "0–1 yr", min: 0, max: 1, tone: "positive" },
  { label: "1–2 yr", min: 1, max: 2, tone: "positive" },
  { label: "2–3 yr", min: 2, max: 3, tone: "positive" },
  { label: "3–4 yr", min: 3, max: 4, tone: "warning" },
  { label: "4–5 yr", min: 4, max: 5, tone: "negative" },
  { label: "5+ yr", min: 5, max: Infinity, tone: "negative" },
];

interface AgeTooltipPayloadEntry {
  value: number;
  fill?: string;
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: AgeTooltipPayloadEntry[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const count = payload[0].value as number;
  return (
    <div className="rounded-lg border border-border bg-popover/95 p-3 shadow-xl backdrop-blur-sm">
      <p className="text-sm font-semibold text-foreground">{label}</p>
      <p className="text-sm font-mono" style={{ color: payload[0].fill }}>
        {count} device{count !== 1 ? "s" : ""}
      </p>
    </div>
  );
}

export function AgeChart({ devices }: AgeChartProps) {
  const p = useChartPalette();
  const data = AGE_BUCKETS.map((bucket) => ({
    label: bucket.label,
    count: devices.filter(
      (d) => d.ageYears >= bucket.min && d.ageYears < bucket.max
    ).length,
    color: p[bucket.tone],
  }));

  return (
    <div className="h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={p.grid} vertical={false} />
          <XAxis
            dataKey="label"
            stroke={p.axis}
            fontSize={12}
            tick={{ fill: p.text }}
          />
          <YAxis
            stroke={p.axis}
            fontSize={12}
            tick={{ fill: p.textMuted }}
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
