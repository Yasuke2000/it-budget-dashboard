"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ShieldCheck, AlertTriangle, ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import type { CategorySpend } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { isITCategory } from "@/lib/constants";

interface CategoryBreakdownProps {
  data: CategorySpend[];
  company?: string;
  from?: string;
  to?: string;
}

interface CategoryTooltipPayloadEntry {
  payload?: {
    category: string;
    amount: number;
    percent: number;
  };
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: CategoryTooltipPayloadEntry[] }) {
  if (!active || !payload?.length || !payload[0].payload) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 shadow-xl">
      <p className="text-sm font-medium text-slate-300">{d.category}</p>
      <p className="text-sm font-mono tabular-nums text-teal-400">{formatCurrency(d.amount)}</p>
      <p className="text-xs text-slate-400">{d.percent.toFixed(1)}% of total</p>
    </div>
  );
}

export function CategoryBreakdown({ data, company, from, to }: CategoryBreakdownProps) {
  const drillHref = (category: string) => {
    const p = new URLSearchParams();
    p.set("category", category);
    if (company && company !== "all") p.set("company", company);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    return `/invoices?${p.toString()}`;
  };
  // Per-page customizable scope. Defaults to IT-only: any non-IT ("Unclassified")
  // spend the BC feed pulled in is excluded up front, so the headline total is
  // trustworthy IT spend. Click a legend row to include/exclude any category.
  const allCategories = useMemo(() => data.map((d) => d.category), [data]);
  const [excluded, setExcluded] = useState<Set<string>>(
    () => new Set(data.filter((d) => !isITCategory(d.category)).map((d) => d.category))
  );

  // Trust indicator: how much of the raw feed is non-IT / unclassified.
  const grandTotal = data.reduce((s, d) => s + d.amount, 0);
  const nonItTotal = data.filter((d) => !isITCategory(d.category)).reduce((s, d) => s + d.amount, 0);
  const itShare = grandTotal > 0 ? ((grandTotal - nonItTotal) / grandTotal) * 100 : 100;

  const isSelected = (cat: string) => !excluded.has(cat);
  function toggle(cat: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }
  const selectAll = () => setExcluded(new Set());
  const clearAll = () => setExcluded(new Set(allCategories));

  const selectedData = data.filter((d) => isSelected(d.category));
  const total = selectedData.reduce((sum, d) => sum + d.amount, 0);
  // Legend shows every category (so excluded ones can be re-added); percent is
  // relative to the selected total.
  const enriched = data.map((d) => ({
    ...d,
    selected: isSelected(d.category),
    percent: total > 0 && isSelected(d.category) ? (d.amount / total) * 100 : 0,
  }));
  const pieData = enriched.filter((d) => d.selected);
  const selectedCount = allCategories.length - excluded.size;

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <CardTitle className="text-white">Cost Categories</CardTitle>
            {/* Trust indicator: confirms the total is IT-only, or flags non-IT spend. */}
            {nonItTotal > 0 ? (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300"
                title={`${formatCurrency(nonItTotal)} is on GL accounts not mapped to IT. Excluded by default — map these accounts in Settings, or toggle "Unclassified" on to include them.`}
              >
                <AlertTriangle className="h-3 w-3" />
                {itShare.toFixed(0)}% IT · {formatCurrency(nonItTotal)} unclassified
              </span>
            ) : (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-teal-500/30 bg-teal-500/10 px-2 py-0.5 text-[11px] text-teal-300"
                title="Every line maps to an IT cost category — this total is IT-only."
              >
                <ShieldCheck className="h-3 w-3" />
                100% IT-classified
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {excluded.size > 0 ? (
              <button onClick={selectAll} className="text-[11px] text-teal-400 hover:text-teal-300 transition-colors">
                Show all ({selectedCount}/{allCategories.length})
              </button>
            ) : (
              <button onClick={clearAll} className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
                Clear
              </button>
            )}
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              {formatCurrency(total)} {excluded.size > 0 ? "IT only" : "total"}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
          <figure role="figure" aria-label="IT cost category breakdown" className="h-[220px] w-[220px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={2}
                  dataKey="amount"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <figcaption className="sr-only">Pie chart showing IT spending distribution across cost categories</figcaption>
          </figure>
          <div className="flex-1 space-y-1.5 pt-1 w-full">
            {enriched.map((cat) => (
              <div
                key={cat.category}
                className="group w-full rounded px-1 -mx-1 hover:bg-slate-800/50 transition-colors"
              >
                <div className="flex items-center justify-between text-sm">
                  <button
                    type="button"
                    onClick={() => toggle(cat.category)}
                    aria-pressed={cat.selected}
                    title={cat.selected ? "Click to exclude from total" : "Click to include in total"}
                    className="flex items-center gap-2 min-w-0 flex-1 text-left"
                  >
                    <div
                      className="w-2.5 h-2.5 rounded-full shrink-0 transition-opacity"
                      style={{ backgroundColor: cat.color, opacity: cat.selected ? 1 : 0.3 }}
                    />
                    <span className={`truncate text-xs ${cat.selected ? "text-slate-400" : "text-slate-600 line-through"}`}>
                      {cat.category}
                    </span>
                  </button>
                  <div className="flex items-center gap-3 shrink-0 ml-2">
                    <span className="text-xs font-mono tabular-nums text-slate-500 w-12 text-right">
                      {cat.selected ? `${cat.percent.toFixed(1)}%` : "—"}
                    </span>
                    <span className={`font-mono tabular-nums text-xs w-20 text-right ${cat.selected ? "text-slate-300" : "text-slate-600"}`}>
                      {formatCurrency(cat.amount)}
                    </span>
                    <Link
                      href={drillHref(cat.category)}
                      title={`View ${cat.category} invoices`}
                      className="text-slate-600 opacity-0 group-hover:opacity-100 hover:text-teal-400 transition-all"
                    >
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>
                <div className="ml-[18px] mt-0.5">
                  <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${cat.percent}%`,
                        backgroundColor: cat.color,
                        opacity: cat.selected ? 1 : 0,
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
