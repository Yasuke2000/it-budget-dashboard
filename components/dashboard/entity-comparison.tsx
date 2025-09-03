"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { EntitySpend } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

interface EntityComparisonProps {
  data: EntitySpend[];
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 shadow-xl">
      <p className="text-sm font-medium text-slate-300">{d.companyName}</p>
      <p className="text-sm font-mono text-teal-400">Total: {formatCurrency(d.totalSpend)}</p>
      <p className="text-sm font-mono text-slate-400">Per user: {formatCurrency(d.perUserSpend)}</p>
      <p className="text-xs text-slate-500">{d.userCount} users</p>
    </div>
  );
}

export function EntityComparison({ data }: EntityComparisonProps) {
  const chartData = data.map((d) => ({
    ...d,
    name: d.companyName.split(" ")[0], // Shorter label
  }));

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white">Spend by Entity</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
              <XAxis type="number" stroke="#94a3b8" fontSize={12} tickFormatter={(v) => `€${(v / 1000).toFixed(0)}K`} />
              <YAxis type="category" dataKey="name" stroke="#94a3b8" fontSize={12} width={100} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="totalSpend" fill="#0d9488" radius={[0, 4, 4, 0]} barSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
