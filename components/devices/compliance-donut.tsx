"use client";

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface ComplianceDonutProps {
  compliant: number;
  noncompliant: number;
  unknown: number;
}

const SLICES = [
  { key: "compliant", label: "Compliant", color: "#10b981" },
  { key: "noncompliant", label: "Non-compliant", color: "#ef4444" },
  { key: "unknown", label: "Unknown", color: "#64748b" },
];

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 shadow-xl">
      <p className="text-sm font-semibold" style={{ color: entry.payload.fill }}>
        {entry.name}
      </p>
      <p className="text-sm font-mono text-white">{entry.value} devices</p>
    </div>
  );
}

function renderCustomLabel({
  cx,
  cy,
  midAngle,
  innerRadius,
  outerRadius,
  percent,
}: any) {
  if (percent < 0.05) return null;
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

export function ComplianceDonut({
  compliant,
  noncompliant,
  unknown,
}: ComplianceDonutProps) {
  const counts: Record<string, number> = { compliant, noncompliant, unknown };
  const data = SLICES.filter((s) => counts[s.key] > 0).map((s) => ({
    name: s.label,
    value: counts[s.key],
    fill: s.color,
  }));

  const total = compliant + noncompliant + unknown;

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
              label={renderCustomLabel}
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.fill} strokeWidth={0} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        {/* Centre label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-2xl font-bold text-white tabular-nums">{total}</span>
          <span className="text-xs text-slate-500">devices</span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-4">
        {SLICES.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-full shrink-0"
              style={{ backgroundColor: s.color }}
            />
            <span className="text-xs text-slate-400">
              {s.label}{" "}
              <span className="font-mono font-semibold text-white">
                {counts[s.key]}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
