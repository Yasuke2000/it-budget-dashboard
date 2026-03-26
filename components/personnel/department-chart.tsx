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

interface DepartmentChartProps {
  departments: DepartmentSummary[];
}

const DEPT_COLORS: Record<string, string> = {
  IT: "#14b8a6",
  Operations: "#6366f1",
  Finance: "#f59e0b",
  Sales: "#10b981",
  HR: "#ec4899",
  Management: "#8b5cf6",
  Warehouse: "#f97316",
  Transport: "#3b82f6",
};

interface DeptTooltipPayloadEntry {
  value: number;
  fill?: string;
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: DeptTooltipPayloadEntry[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const count = payload[0].value as number;
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 shadow-xl">
      <p className="text-sm font-semibold text-white">{label}</p>
      <p className="text-sm font-mono" style={{ color: payload[0].fill }}>
        {count} employee{count !== 1 ? "s" : ""}
      </p>
    </div>
  );
}

export function DepartmentChart({ departments }: DepartmentChartProps) {
  const data = [...departments].sort((a, b) => b.headcount - a.headcount);

  return (
    <div className="h-[240px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis
            dataKey="name"
            stroke="#94a3b8"
            fontSize={11}
            tick={{ fill: "#94a3b8" }}
          />
          <YAxis
            stroke="#94a3b8"
            fontSize={12}
            tick={{ fill: "#94a3b8" }}
            allowDecimals={false}
            width={28}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
          <Bar dataKey="headcount" name="Employees" radius={[4, 4, 0, 0]}>
            {data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={DEPT_COLORS[entry.name] || "#64748b"}
                fillOpacity={0.85}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
