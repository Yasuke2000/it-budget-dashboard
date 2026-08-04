"use client";

// Compacte geconsolideerd-kaart op de cockpit: bruto vs IC vs geconsolideerd
// (echte IC-eliminatie per grootboekregel, uit /api/cfo/units). Detail op /cfo/units.

import type { CfoUnits } from "@/lib/units";
import { formatCurrencyCompact } from "@/lib/utils";
import { usePolledData, fmtDate } from "./cfo-ui";
import { Loader2, GitMerge, ChevronRight, Info } from "lucide-react";

export function ConsolidatedCard({ excluded }: { excluded: string[] }) {
  const qs = excluded.length ? `?exclude=${excluded.join(",")}` : "";
  const { data, building, error } = usePolledData<CfoUnits>(`/api/cfo/units${qs}`);
  const t = data?.consolidated?.totals;
  const vandaag = fmtDate(new Date().toISOString().slice(0, 10));

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground"><GitMerge className="h-4 w-4 text-primary" /> Geconsolideerd (IC-eliminatie)</h2>
            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary ring-1 ring-primary/30">
              {data ? `01/01/${data.year} t/m ${vandaag} (YTD)` : "YTD"}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            Operationele P&amp;L over het lopende boekjaar, intercompany per grootboekregel geëlimineerd (tegenpartij-herkenning{data ? `, dekking ${data.consolidated.coveragePct}%` : ""}).
            Deze kaart rekent ALTIJD year-to-date en volgt dus niet de periodekiezer bovenaan.
          </p>
          <details className="mt-1.5">
            <summary className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-muted px-2 py-1 text-[10px] font-semibold text-muted-foreground ring-1 ring-border transition hover:bg-primary/10 hover:text-primary hover:ring-primary/40">
              <Info className="h-3 w-3" />bron &amp; uitleg
            </summary>
            <div className="mt-2 space-y-1.5">
              <p className="text-[11px] leading-snug text-foreground"><b>Periode:</b> {data ? `01/01/${data.year} tot en met vandaag (${vandaag})` : "year-to-date"} — altijd YTD, ongeacht de periodekiezer bovenaan de pagina.</p>
              <p className="text-[11px] leading-snug text-muted-foreground"><b className="text-foreground">Wat staat er:</b> kolom 1 is de naïeve som van de elf vennootschappen, waarin de omzet die firma&apos;s aan elkaar factureren dubbel geteld zit. Kolom 2 is precies dat interne deel. Kolom 3 is wat de groep werkelijk aan de buitenwereld verdient — dat is het cijfer dat je aan een bank of een externe partij geeft.</p>
              <p className="text-[11px] leading-snug text-muted-foreground"><b className="text-foreground">Bron in Business Central:</b> Grootboekposten_Excel per klasse. Een regel geldt als intercompany wanneer de tegenpartij (klant of leverancier) een groepsvennootschap is; bij memoriaalboekingen, die geen tegenpartij hebben, kijken we aanvullend naar de omschrijving.{data ? ` De tegenpartij-dekking van ${data.consolidated.coveragePct}% zegt voor welk deel van het P&L-volume die toets mogelijk is.` : ""}</p>
              <p className="text-[11px] leading-snug text-muted-foreground"><b className="text-foreground">Waar je op moet letten:</b> dit is een management-consolidatie voor besluitvorming, geen statutaire geconsolideerde jaarrekening — deelnemingen, minderheidsbelangen en herwaarderingen zitten er niet in. De volledige opbouw per klasse, met de symmetrie-check tussen IC-omzet en IC-kosten, staat via &quot;detail&quot; op de pagina Business Units.</p>
            </div>
          </details>
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
              <tr className="border-b border-border/40">
                <td className="px-2 py-1.5 font-bold text-foreground">EBITDA <span className="font-normal text-muted-foreground">(vóór afschr.)</span></td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrencyCompact(t.ebitdaGross)}</td>
                <td className="px-2 py-1.5 text-right text-[10px] text-muted-foreground">Δ {formatCurrencyCompact(t.ebitdaNet - t.ebitdaGross)}</td>
                <td className={`px-2 py-1.5 text-right font-bold tabular-nums ${t.ebitdaNet >= 0 ? "text-positive" : "text-negative"}`}>{formatCurrencyCompact(t.ebitdaNet)}</td>
              </tr>
              <tr>
                <td className="px-2 py-1.5 font-bold text-foreground">EBIT <span className="font-normal text-muted-foreground">(ná afschr.)</span></td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrencyCompact(t.ebitGross)}</td>
                <td className="px-2 py-1.5 text-right text-[10px] text-muted-foreground">Δ {formatCurrencyCompact(t.ebitNet - t.ebitGross)}</td>
                <td className={`px-2 py-1.5 text-right font-bold tabular-nums ${t.ebitNet >= 0 ? "text-positive" : "text-negative"}`}>{formatCurrencyCompact(t.ebitNet)}</td>
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
