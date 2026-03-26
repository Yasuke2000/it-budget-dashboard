"use client";

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { JiraProjectCost } from "@/lib/types";

interface ProjectCostDonutProps {
  projectCosts: JiraProjectCost[];
}

const PROJECT_COLORS: Record<string, string> = {
  ITSUP: "#14b8a6",
  INFRA: "#6366f1",
  SEC: "#f59e0b",
  PROJ: "#10b981",
};

interface TooltipPayloadEntry {
  name: string;
  value: number;
  payload: {
    fill: string;
    totalHours: number;
    contributors: number;
  };
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 shadow-xl">
      <p className="text-sm font-semibold" style={{ color: entry.payload.fill }}>
        {entry.name}
      </p>
      <p className="text-sm font-mono text-white">
        €{entry.value.toFixed(0)}
      </p>
      <p className="text-xs text-slate-400">
        {entry.payload.totalHours}h · {entry.payload.contributors} contributor{entry.payload.contributors !== 1 ? "s" : ""}
      </p>
    </div>
  );
}

interface LabelProps {
  cx: number;
  cy: number;
  midAngle: number;
  innerRadius: number;
  outerRadius: number;
  percent: number;
}

function renderCustomLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }: LabelProps) {
  if (percent < 0.07) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text
      x={x}
      y={y}
      fill="white"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={12}
      fontWeight={600}
    >
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

export function ProjectCostDonut({ projectCosts }: ProjectCostDonutProps) {
  const total = projectCosts.reduce((sum, p) => sum + p.totalCost, 0);

  const data = projectCosts.map((p) => ({
    name: p.projectName,
    value: p.totalCost,
    totalHours: p.totalHours,
    contributors: p.contributors,
    fill: PROJECT_COLORS[p.projectKey] || "#64748b",
  }));

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="h-[200px] w-full relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={85}
              dataKey="value"
              labelLine={false}
              label={renderCustomLabel as unknown as boolean}
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.fill} strokeWidth={0} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-lg font-bold text-white tabular-nums">
            €{total.toFixed(0)}
          </span>
          <span className="text-xs text-slate-500">total cost</span>
        </div>
      </div>

      <div className="flex flex-wrap justify-center gap-4">
        {data.map((entry) => (
          <div key={entry.name} className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-full shrink-0"
              style={{ backgroundColor: entry.fill }}
            />
            <span className="text-xs text-slate-400">
              {entry.name}{" "}
              <span className="font-mono font-semibold text-white">
                €{entry.value.toFixed(0)}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
