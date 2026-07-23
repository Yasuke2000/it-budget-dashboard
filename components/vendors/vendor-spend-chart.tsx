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
import { useChartPalette } from "@/lib/chart-theme";

interface VendorSpendChartProps {
  vendors: VendorSummary[];
}

interface TooltipPayloadEntry {
  payload: {
    name: string;
    spend: number;
    percent: number;
    isRisk: boolean;
  };
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-popover/95 p-3 shadow-xl backdrop-blur-sm max-w-xs">
      <p className="text-sm font-semibold text-foreground mb-1">{d.name}</p>
      <p className="text-sm font-mono text-primary">{formatCurrency(d.spend)}</p>
      <p className="text-xs text-muted-foreground">{d.percent.toFixed(1)}% of total</p>
      {d.isRisk && (
        <p className="text-xs text-warning mt-1">Concentration risk &gt;30%</p>
      )}
    </div>
  );
}

function truncateName(name: string, max = 18): string {
  return name.length > max ? name.slice(0, max - 1) + "…" : name;
}

export function VendorSpendChart({ vendors }: VendorSpendChartProps) {
  const p = useChartPalette();
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
          <CartesianGrid stroke={p.grid} horizontal={false} />
          <XAxis
            type="number"
            stroke={p.textMuted}
            fontSize={11}
            tickFormatter={(v) => `€${(v / 1000).toFixed(0)}K`}
          />
          <YAxis
            type="category"
            dataKey="name"
            stroke={p.axis}
            fontSize={11}
            width={120}
            tick={{ fill: p.text }}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
          <Bar dataKey="spend" name="Spend" radius={[0, 4, 4, 0]}>
            {data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.isRisk ? p.warning : p.income}
                fillOpacity={0.85}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
