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
import type { VendorSummary } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

interface VendorSpendChartProps {
  vendors: VendorSummary[];
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 shadow-xl max-w-xs">
      <p className="text-sm font-semibold text-white mb-1">{d.name}</p>
      <p className="text-sm font-mono text-teal-400">{formatCurrency(d.spend)}</p>
      <p className="text-xs text-slate-400">{d.percent.toFixed(1)}% of total</p>
      {d.isRisk && (
        <p className="text-xs text-amber-400 mt-1">Concentration risk &gt;30%</p>
      )}
    </div>
  );
}

function truncateName(name: string, max = 18): string {
  return name.length > max ? name.slice(0, max - 1) + "…" : name;
}

export function VendorSpendChart({ vendors }: VendorSpendChartProps) {
  const data = vendors.map((v) => ({
    name: truncateName(v.vendorName),
    fullName: v.vendorName,
    spend: v.totalSpend,
    percent: v.percentOfTotal,
    isRisk: v.isConcentrationRisk,
  }));

  return (
    <div className="h-[280px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 20, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
          <XAxis
            type="number"
            stroke="#94a3b8"
            fontSize={11}
            tickFormatter={(v) => `€${(v / 1000).toFixed(0)}K`}
          />
          <YAxis
            type="category"
            dataKey="name"
            stroke="#94a3b8"
            fontSize={11}
            width={120}
            tick={{ fill: "#94a3b8" }}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
          <Bar dataKey="spend" name="Spend" radius={[0, 4, 4, 0]}>
            {data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.isRisk ? "#f59e0b" : "#0d9488"}
                fillOpacity={0.85}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
