"use client";

// Compacte geconsolideerd-kaart op de cockpit: bruto vs IC vs geconsolideerd
// (echte IC-eliminatie per grootboekregel, uit /api/cfo/units). Detail op /cfo/units.

import type { CfoUnits } from "@/lib/units";
import { formatCurrencyCompact } from "@/lib/utils";
import { usePolledData } from "./cfo-ui";
import { Loader2, GitMerge, ChevronRight } from "lucide-react";

export function ConsolidatedCard({ excluded }: { excluded: string[] }) {
  const qs = excluded.length ? `?exclude=${excluded.join(",")}` : "";
  const { data, building, error } = usePolledData<CfoUnits>(`/api/cfo/units${qs}`);
  const t = data?.consolidated?.totals;

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground"><GitMerge className="h-4 w-4 text-primary" /> Geconsolideerd (IC-eliminatie)</h2>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            Operationele P&amp;L YTD, intercompany per grootboekregel geëlimineerd (tegenpartij-herkenning{data ? `, dekking ${data.consolidated.coveragePct}%` : ""}).
          </p>
        </div>
        <a href="/cfo/units" className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-primary hover:opacity-80">detail<ChevronRight className="h-3.5 w-3.5" /></a>
      </div>
      {building && !data && <p className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Grootboek met tegenpartijen wordt opgehaald (2–5 min, eenmalig per dag)…</p>}
      {error && <p className="py-4 text-center text-xs text-warning">{error}</p>}
      {t && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-1 text-left" />
                <th className="px-2 py-1 text-right">Bruto (som firma&apos;s)</th>
                <th className="px-2 py-1 text-right">Intercompany</th>
                <th className="px-2 py-1 text-right">Geconsolideerd</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border/40">
                <td className="px-2 py-1.5 font-semibold text-foreground">Bedrijfsopbrengsten</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrencyCompact(t.revenueGross)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-primary">− {formatCurrencyCompact(t.revenueIc)}</td>
                <td className="px-2 py-1.5 text-right font-bold tabular-nums">{formatCurrencyCompact(t.revenueNet)}</td>
              </tr>
              <tr className="border-b border-border/40">
                <td className="px-2 py-1.5 font-semibold text-foreground">Operationele kosten</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrencyCompact(t.costsGross)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-primary">− {formatCurrencyCompact(t.costsIc)}</td>
                <td className="px-2 py-1.5 text-right font-bold tabular-nums">{formatCurrencyCompact(t.costsNet)}</td>
              </tr>
              <tr>
                <td className="px-2 py-1.5 font-bold text-foreground">EBITDA-benadering</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrencyCompact(t.ebitdaGross)}</td>
                <td className="px-2 py-1.5 text-right text-[10px] text-muted-foreground">Δ {formatCurrencyCompact(t.ebitdaNet - t.ebitdaGross)}</td>
                <td className={`px-2 py-1.5 text-right font-bold tabular-nums ${t.ebitdaNet >= 0 ? "text-positive" : "text-negative"}`}>{formatCurrencyCompact(t.ebitdaNet)}</td>
              </tr>
            </tbody>
          </table>
          {data && (
            <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
              Symmetrie: IC-omzet {formatCurrencyCompact(data.consolidated.icSymmetry.icRevenue)} vs IC-kosten {formatCurrencyCompact(data.consolidated.icSymmetry.icCosts)} (Δ {formatCurrencyCompact(data.consolidated.icSymmetry.delta)}) — Δ ≠ 0 = asymmetrische IC-boekingen, zie /cfo/units. Excl. btw; operationeel (kl. 60–64/70–74).
            </p>
          )}
        </div>
      )}
    </section>
  );
}
