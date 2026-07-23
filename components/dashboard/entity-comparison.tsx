"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { EntitySpend } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { useChartPalette } from "@/lib/chart-theme";

interface EntityComparisonProps {
  data: EntitySpend[];
}

interface EntityTooltipPayloadEntry {
  payload?: {
    companyName?: string;
    totalSpend: number;
    perUserSpend: number;
    userCount: number;
  };
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: EntityTooltipPayloadEntry[] }) {
  if (!active || !payload?.length || !payload[0].payload) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-popover/95 p-3 shadow-xl backdrop-blur-sm">
      <p className="text-sm font-medium text-foreground">{d.companyName}</p>
      <p className="font-mono text-sm tabnum text-primary">Total: {formatCurrency(d.totalSpend)}</p>
      {d.userCount > 0 && (
        <>
          <p className="font-mono text-sm tabnum text-muted-foreground">Per user: {formatCurrency(d.perUserSpend)}</p>
          <p className="text-xs text-muted-foreground/70">{d.userCount} users</p>
        </>
      )}
    </div>
  );
}

export function EntityComparison({ data }: EntityComparisonProps) {
  const p = useChartPalette();
  const chartData = data.map((d) => ({
    ...d,
    // Shorten long names for chart labels
    name: d.companyName.length <= 15
      ? d.companyName
      : d.companyName
          .replace("International", "Intl")
          .replace("Solutions", "Sol.")
          .split(" ")
          .slice(0, 2)
          .join(" "),
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Spend by entity</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={p.grid} horizontal={false} />
              <XAxis type="number" stroke={p.axis} tick={{ fill: p.textMuted, fontSize: 11 }} tickLine={false} tickFormatter={(v) => `€${(v / 1000).toFixed(0)}K`} />
              <YAxis type="category" dataKey="name" stroke={p.axis} tick={{ fill: p.text, fontSize: 11 }} tickLine={false} width={100} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "color-mix(in oklch, var(--foreground) 5%, transparent)" }} />
              <Bar dataKey="totalSpend" fill={p.categorical[0]} radius={[0, 4, 4, 0]} barSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
