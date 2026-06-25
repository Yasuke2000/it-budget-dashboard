"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ForecastChart } from "./forecast-chart";
import { formatCurrencyCompact } from "@/lib/utils";
import type { SpendForecast } from "@/lib/types";

export function ForecastPanel({ company, initial }: { company: string; initial: SpendForecast | null }) {
  const [growth, setGrowth] = useState(0);
  const [extra, setExtra] = useState(0);
  const [data, setData] = useState<SpendForecast | null>(initial);
  const [loading, setLoading] = useState(false);
  // The server already rendered the default (0/0) scenario as `initial`, so skip the
  // redundant fetch on first mount; only fetch when the scenario actually changes.
  const firstRun = useRef(true);

  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; if (growth === 0 && extra === 0 && initial) return; }
    let cancelled = false;
    const qs = new URLSearchParams({ company, growthPct: String(growth), extraMonthly: String(extra) });
    fetch(`/api/forecast?${qs}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [growth, extra, company, initial]);

  if (!data || data.points.length < 2) return null;
  const hasBudget = data.annualBudget > 0;
  const over = hasBudget && data.annualForecast > data.annualBudget;
  const diff = Math.abs(data.annualForecast - data.annualBudget);

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white text-base flex items-center justify-between flex-wrap gap-2">
          <span>12-Month Forecast {data.includesPersonnel ? "(incl. internal IT staff)" : "(tools/services)"}</span>
          <span className="text-sm font-normal text-slate-400">
            Next 12 months ≈ <span className="text-amber-300 font-semibold">{formatCurrencyCompact(data.annualForecast)}</span>
            {hasBudget && (
              <> · budget {formatCurrencyCompact(data.annualBudget)} · <span className={over ? "text-red-400" : "text-emerald-400"}>{over ? "over" : "under"} {formatCurrencyCompact(diff)}</span></>
            )}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Scenario knobs */}
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 mb-4 text-sm">
          <label className="flex items-center gap-2 text-slate-300">
            Growth on variable spend:
            <input type="range" min={-20} max={50} step={5} value={growth} onChange={(e) => { setGrowth(Number(e.target.value)); setLoading(true); }} className="align-middle accent-teal-400" />
            <span className="tabular-nums w-12 text-right font-medium text-white">{growth > 0 ? "+" : ""}{growth}%</span>
          </label>
          <label className="flex items-center gap-2 text-slate-300">
            Extra €/month (new tool/hire):
            <input type="number" min={0} step={500} value={extra} onChange={(e) => { setExtra(Math.max(0, Number(e.target.value) || 0)); setLoading(true); }} className="w-28 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-white tabular-nums" />
          </label>
          {(growth !== 0 || extra !== 0) && (
            <button onClick={() => { setGrowth(0); setExtra(0); setLoading(true); }} className="text-xs text-teal-400 hover:text-teal-300 underline underline-offset-2">reset</button>
          )}
          {loading && <span className="text-xs text-slate-500">updating…</span>}
        </div>
        <ForecastChart points={data.points} />
        <p className="text-xs text-slate-500 mt-2">
          {data.method}. Each future month is projected from the same calendar month last year (so Q1-clustered annual licences land in the right months){growth !== 0 ? `, variable spend ×${(1 + growth / 100).toFixed(2)}` : ""}{extra ? `, +${formatCurrencyCompact(extra)}/mo` : ""}.
          {hasBudget ? " Tracked against your configured budget." : " Set per-category budgets in Settings → Budget to track against this."}
        </p>
      </CardContent>
    </Card>
  );
}
