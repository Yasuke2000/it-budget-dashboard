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
import type { DepartmentSummary } from "@/lib/types";
import { useChartPalette } from "@/lib/chart-theme";

interface DepartmentChartProps {
  departments: DepartmentSummary[];
}

interface DeptTooltipPayloadEntry {
  value: number;
  fill?: string;
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: DeptTooltipPayloadEntry[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const count = payload[0].value as number;
  return (
    <div className="rounded-lg border border-border bg-popover/95 p-3 shadow-xl backdrop-blur-sm">
      <p className="text-sm font-semibold text-foreground">{label}</p>
      <p className="text-sm font-mono" style={{ color: payload[0].fill }}>
        {count} employee{count !== 1 ? "s" : ""}
      </p>
    </div>
  );
}

export function DepartmentChart({ departments }: DepartmentChartProps) {
  const p = useChartPalette();
  const DEPT_COLORS: Record<string, string> = {
    IT: p.categorical[0],
    Operations: p.categorical[1],
    Finance: p.categorical[2],
    Sales: p.categorical[3],
    HR: p.categorical[4],
    Management: p.categorical[5],
    Warehouse: p.categorical[0],
    Transport: p.categorical[1],
  };
  const data = [...departments].sort((a, b) => b.headcount - a.headcount);

  return (
    <div className="h-[240px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={p.grid} vertical={false} />
          <XAxis
            dataKey="name"
            stroke={p.axis}
            fontSize={11}
            tick={{ fill: p.text }}
          />
          <YAxis
            stroke={p.axis}
            fontSize={12}
            tick={{ fill: p.textMuted }}
            allowDecimals={false}
            width={28}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
          <Bar dataKey="headcount" name="Employees" radius={[4, 4, 0, 0]}>
            {data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={DEPT_COLORS[entry.name] || p.budget}
                fillOpacity={0.85}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
