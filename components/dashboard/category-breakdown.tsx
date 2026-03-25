"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import type { CategorySpend } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

interface CategoryBreakdownProps {
  data: CategorySpend[];
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 shadow-xl">
      <p className="text-sm font-medium text-slate-300">{d.category}</p>
      <p className="text-sm font-mono text-teal-400">{formatCurrency(d.amount)}</p>
      <p className="text-xs text-slate-400">{d.percent.toFixed(1)}% of total</p>
    </div>
  );
}

export function CategoryBreakdown({ data }: CategoryBreakdownProps) {
  const total = data.reduce((sum, d) => sum + d.amount, 0);
  const enriched = data.map((d) => ({
    ...d,
    percent: total > 0 ? (d.amount / total) * 100 : 0,
  }));

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-white">Cost Categories</CardTitle>
          <span className="text-xs text-slate-500 font-mono">
            {formatCurrency(total)} total
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
          <div className="h-[220px] w-[220px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={enriched}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={2}
                  dataKey="amount"
                >
                  {enriched.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex-1 space-y-1.5 pt-1 w-full">
            {enriched.map((cat) => (
              <div key={cat.category} className="group">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: cat.color }}
                    />
                    <span className="text-slate-400 truncate text-xs">
                      {cat.category}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-2">
                    <span className="text-xs font-mono text-slate-500 w-12 text-right">
                      {cat.percent.toFixed(1)}%
                    </span>
                    <span className="font-mono text-xs text-slate-300 w-20 text-right">
                      {formatCurrency(cat.amount)}
                    </span>
                  </div>
                </div>
                <div className="ml-[18px] mt-0.5">
                  <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${cat.percent}%`,
                        backgroundColor: cat.color,
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
