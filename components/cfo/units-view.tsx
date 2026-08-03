"use client";

// Business Units & Activa — operationele P&L per AFDELING-dimensie
// (Grootboekposten_Excel) + facturatie/DSO per unit (klantposten) + vaste activa
// (FALedgerEntries). Zelfde poll-patroon en designtaal als Klanten & Cash.

import { useMemo } from "react";
import * as echarts from "echarts";
import type { CfoReceivables } from "@/lib/types";
import type { CfoUnits } from "@/lib/units";
import type { CfoAssets } from "@/lib/assets";
import { EChart } from "./echart";
import { formatCurrency, formatCurrencyCompact } from "@/lib/utils";
import { useChartPalette } from "@/lib/chart-theme";
import { usePolledData, Card, Kpi, eurAxis, fmtStamp, fmtMonth } from "./cfo-ui";
import { Loader2, RefreshCcw, AlertTriangle, ArrowLeft } from "lucide-react";

export function UnitsView({ exclude }: { exclude: string[] }) {
  const qs = exclude.length ? `?exclude=${exclude.join(",")}` : "";
  const units = usePolledData<CfoUnits>(`/api/cfo/units${qs}`);
  const assets = usePolledData<CfoAssets>(`/api/cfo/assets${qs}`);
  const rcv = usePolledData<CfoReceivables>(`/api/cfo/receivables${qs}`);
  const p = useChartPalette();
  const u = units.data;

  const revStack = useMemo<echarts.EChartsOption | null>(() => {
    if (!u) return null;
    const top = u.units.slice(0, 8);
    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => formatCurrency(Number(v)) },
      legend: { data: top.map((x) => x.label), textStyle: { color: p.text, fontSize: 10 }, top: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10 },
      grid: { top: 46, left: 6, right: 8, bottom: 20, containLabel: true },
      xAxis: { type: "category", data: u.months.map(fmtMonth), axisLabel: { color: p.text, fontSize: 9 }, axisLine: { lineStyle: { color: p.axis } }, axisTick: { show: false } },
      yAxis: { type: "value", axisLabel: { color: p.textMuted, formatter: (v: number) => eurAxis(v) }, splitLine: { lineStyle: { color: p.grid } } },
      series: top.map((x, i) => ({
        name: x.label, type: "bar" as const, stack: "rev", data: x.monthlyRevenue,
        itemStyle: { color: p.categorical[i % p.categorical.length] }, barMaxWidth: 26,
      })),
    };
  }, [u, p]);

  const marginBars = useMemo<echarts.EChartsOption | null>(() => {
    if (!u) return null;
    const rows = [...u.units].sort((a, b) => b.result - a.result);
    return {
      tooltip: {
        trigger: "axis", axisPointer: { type: "shadow" },
        formatter: (prs: unknown) => {
          const pr = (prs as { dataIndex: number }[])[0];
          const r = rows[pr.dataIndex]; if (!r) return "";
          return `${r.label}<br/>Omzet <b>${formatCurrency(r.revenue)}</b> · Kosten ${formatCurrency(r.costs)}<br/>Resultaat <b>${formatCurrency(r.result)}</b> (${r.marginPct}%)`;
        },
      },
      grid: { top: 10, left: 6, right: 40, bottom: 20, containLabel: true },
      xAxis: { type: "value", axisLabel: { color: p.textMuted, formatter: (v: number) => eurAxis(v) }, splitLine: { lineStyle: { color: p.grid } } },
      yAxis: { type: "category", data: rows.map((r) => r.label), axisLabel: { color: p.text, fontSize: 10 }, axisLine: { lineStyle: { color: p.axis } }, axisTick: { show: false } },
      series: [{
        type: "bar", barMaxWidth: 18,
        data: rows.map((r) => ({ value: r.result, itemStyle: { color: r.result >= 0 ? p.positive : p.negative, borderRadius: 3 } })),
        label: { show: true, position: "right", color: p.text, fontSize: 9, formatter: (pl: { dataIndex: number }) => `${rows[pl.dataIndex]?.marginPct ?? 0}%` },
      }],
    };
  }, [u, p]);

  if (!u) {
    return (
      <div className="mx-auto mt-20 max-w-md rounded-2xl border border-border bg-card p-8 text-center">
        {units.error ? (
          <>
            <AlertTriangle className="mx-auto h-7 w-7 text-warning" />
            <h1 className="mt-3 text-base font-semibold text-foreground">Kon de data niet laden</h1>
            <p className="mt-1 text-xs text-muted-foreground">{units.error}</p>
            <button onClick={() => units.reload(false)} className="mt-4 rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground">Opnieuw proberen</button>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto h-7 w-7 animate-spin text-primary" />
            <h1 className="mt-3 text-base font-semibold text-foreground">{units.building ? "Grootboek met dimensies wordt opgehaald…" : "Laden…"}</h1>
            {units.building && <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">Eerste opbouw: alle P&L-boekingen mét AFDELING-dimensie van 11 vennootschappen (2–5 min). De pagina ververst zichzelf.</p>}
          </>
        )}
      </div>
    );
  }

  const totRev = u.perCompany.reduce((s, x) => s + x.revenue, 0);
  const totRes = u.perCompany.reduce((s, x) => s + x.result, 0);
  const best = u.perCompany.length ? [...u.perCompany].sort((a, b) => b.result - a.result)[0] : null;
  const worst = u.perCompany.length ? [...u.perCompany].sort((a, b) => a.result - b.result)[0] : null;
  const buRows = (rcv.data?.businessUnits || []).slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <a href="/cfo" className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground ring-1 ring-border hover:text-foreground"><ArrowLeft className="h-3 w-3" />CFO-cockpit</a>
              <a href="/cfo/klanten" className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground ring-1 ring-border hover:text-foreground">Klanten & Cash →</a>
              <h1 className="text-lg font-bold text-foreground">Business Units & Activa</h1>
              {!u.isLive && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold uppercase text-warning">demo</span>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Operationele P&L per activiteit (dimensie AFDELING), YTD {u.year} · bedragen excl. btw, bruto (incl. intercompany).</p>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>Data per <b className="text-foreground">{fmtStamp(u.asOf)}</b></span>
            {u.refreshing && <span className="inline-flex items-center gap-1 text-primary"><Loader2 className="h-3 w-3 animate-spin" />vernieuwt…</span>}
            <button onClick={() => units.reload(true)} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 font-semibold ring-1 ring-border hover:text-foreground"><RefreshCcw className="h-3 w-3" />Vernieuwen</button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Omzet YTD (bruto)" value={formatCurrencyCompact(totRev)} sub="klassen 70–74, excl. btw, incl. IC" />
        <Kpi label="Operationeel resultaat" value={formatCurrencyCompact(totRes)} sub="omzet − operationele kosten" tone={totRes >= 0 ? "pos" : "neg"} />
        <Kpi label="Sterkste activiteit" value={best ? `${best.code} · ${best.activity}` : "—"} sub={best ? `${formatCurrencyCompact(best.result)} · ${best.marginPct}%` : undefined} tone="pos" />
        <Kpi label="Zwakste activiteit" value={worst ? `${worst.code} · ${worst.activity}` : "—"} sub={worst ? `${formatCurrencyCompact(worst.result)} · ${worst.marginPct}%` : undefined} tone={worst && worst.result < 0 ? "neg" : "neutral"} />
        <Kpi label="AFDELING-dekking" value={`${Math.round(100 - u.undimensioned.sharePct)}%`} sub={`${u.undimensioned.sharePct}% van het P&L-volume mist de dimensie (vooral GDI/overnames)`} tone={u.undimensioned.sharePct > 10 ? "warn" : "pos"} />
        <Kpi label="CAPEX YTD" value={assets.data ? formatCurrencyCompact(assets.data.totals.acquisitionYtd) : "…"} sub={assets.data ? `boekwaarde ${formatCurrencyCompact(assets.data.totals.bookValue)}` : "vaste activa laden…"} />
      </div>

      <Card
        title="Per vennootschap — de betrouwbare activiteiten-laag"
        hint="De firma's zíjn de activiteiten van de groep. Volledig beeld, geen dimensies nodig; IC-omzet% = intra-groep."
        source={u.sources.find((s) => s.label.startsWith("Per vennootschap"))?.detail}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-1.5 text-left">Vennootschap · activiteit</th>
                <th className="px-2 py-1.5 text-right">Omzet YTD</th>
                <th className="px-2 py-1.5 text-right">Kosten</th>
                <th className="px-2 py-1.5 text-right">Resultaat</th>
                <th className="px-2 py-1.5 text-right">Marge</th>
                <th className="px-2 py-1.5 text-right">IC-omzet</th>
                <th className="px-2 py-1.5 text-right" title="Aandeel van het P&L-volume met AFDELING-dimensie — bepaalt of de dimensie-laag hieronder bruikbaar is voor deze firma">AFDELING-dekking</th>
              </tr>
            </thead>
            <tbody>
              {u.perCompany.map((c) => (
                <tr key={c.code} className="border-b border-border/40">
                  <td className="px-2 py-1.5 font-semibold text-foreground">{c.code} <span className="font-normal text-muted-foreground">· {c.activity}</span></td>
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{formatCurrency(c.revenue)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(c.costs)}</td>
                  <td className={`px-2 py-1.5 text-right font-semibold tabular-nums ${c.result >= 0 ? "text-positive" : "text-negative"}`}>{formatCurrency(c.result)}</td>
                  <td className={`px-2 py-1.5 text-right tabular-nums ${c.marginPct >= 0 ? "text-foreground" : "text-negative"}`}>{c.marginPct}%</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{c.icRevenuePct}%</td>
                  <td className="px-2 py-1.5 text-right">
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${c.dimCoveragePct >= 80 ? "bg-positive/15 text-positive" : c.dimCoveragePct >= 30 ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground"}`}>{Math.round(c.dimCoveragePct)}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 rounded-lg bg-muted/60 p-2.5 text-[11px] leading-snug text-muted-foreground">
          Bedragen bruto (incl. intra-groep-omzet — zie kolom IC). Voor het geconsolideerde groepsbeeld: de eliminatie-kaart hieronder. Jaareinde-caveat: afschrijvingen/belastingen grotendeels op 31/12 geboekt.
        </p>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="AFDELING-dimensie: omzet per maand" hint="⚠ Alleen boekingen mét AFDELING-tag (vooral GTR) — GDI's distributie-omzet zit hier NIET in, zie de firma-tabel." source={u.sources.find((s) => s.label.startsWith("AFDELING"))?.detail}>
          {revStack && <EChart option={revStack} height={300} ariaLabel="Omzet per AFDELING per maand" />}
        </Card>
        <Card title="AFDELING-dimensie: resultaat (YTD)" hint="⚠ Zelfde beperking — marges zijn vertekend waar kosten wél en omzet níet getagd is (of omgekeerd)." source={u.sources.find((s) => s.label.startsWith("AFDELING"))?.detail}>
          {marginBars && <EChart option={marginBars} height={300} ariaLabel="Resultaat per AFDELING" />}
        </Card>
      </div>

      <Card
        title="Geconsolideerde P&L — echte IC-eliminatie"
        hint={`Bruto − intercompany (per grootboekregel herkend op tegenpartij) = geconsolideerd. Tegenpartij-dekking: ${u.consolidated.coveragePct}% van het P&L-volume.`}
        source={u.sources.find((s) => s.label.startsWith("IC-eliminatie"))?.detail}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-1.5 text-left">Klasse</th>
                <th className="px-2 py-1.5 text-right">Bruto</th>
                <th className="px-2 py-1.5 text-right">Intercompany</th>
                <th className="px-2 py-1.5 text-right">Geconsolideerd</th>
              </tr>
            </thead>
            <tbody>
              {u.consolidated.byClass.map((r) => (
                <tr key={r.cls} className="border-b border-border/40">
                  <td className="px-2 py-1.5 font-semibold text-foreground">{r.cls} · {r.label}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(r.gross)}</td>
                  <td className={`px-2 py-1.5 text-right tabular-nums ${r.ic ? "text-primary" : "text-muted-foreground"}`}>{r.ic ? `− ${formatCurrency(r.ic)}` : "—"}</td>
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{formatCurrency(r.net)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-border">
                <td className="px-2 py-2 font-bold text-foreground">Bedrijfsopbrengsten</td>
                <td className="px-2 py-2 text-right font-bold tabular-nums">{formatCurrency(u.consolidated.totals.revenueGross)}</td>
                <td className="px-2 py-2 text-right font-bold tabular-nums text-primary">− {formatCurrency(u.consolidated.totals.revenueIc)}</td>
                <td className="px-2 py-2 text-right font-bold tabular-nums">{formatCurrency(u.consolidated.totals.revenueNet)}</td>
              </tr>
              <tr>
                <td className="px-2 py-1 font-bold text-foreground">Operationele kosten</td>
                <td className="px-2 py-1 text-right font-bold tabular-nums">{formatCurrency(u.consolidated.totals.costsGross)}</td>
                <td className="px-2 py-1 text-right font-bold tabular-nums text-primary">− {formatCurrency(u.consolidated.totals.costsIc)}</td>
                <td className="px-2 py-1 text-right font-bold tabular-nums">{formatCurrency(u.consolidated.totals.costsNet)}</td>
              </tr>
              <tr className="border-t border-border">
                <td className="px-2 py-2 font-bold text-foreground">EBITDA-benadering</td>
                <td className="px-2 py-2 text-right font-bold tabular-nums">{formatCurrency(u.consolidated.totals.ebitdaGross)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">Δ {formatCurrency(u.consolidated.totals.ebitdaNet - u.consolidated.totals.ebitdaGross)}</td>
                <td className={`px-2 py-2 text-right font-bold tabular-nums ${u.consolidated.totals.ebitdaNet >= 0 ? "text-positive" : "text-negative"}`}>{formatCurrency(u.consolidated.totals.ebitdaNet)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 rounded-lg bg-muted/60 p-2.5 text-[11px] leading-snug text-muted-foreground">
          <b className="text-foreground">Symmetrie-check:</b> IC-omzet {formatCurrencyCompact(u.consolidated.icSymmetry.icRevenue)} vs IC-kosten {formatCurrencyCompact(u.consolidated.icSymmetry.icCosts)} → Δ <b className={Math.abs(u.consolidated.icSymmetry.delta) > 500_000 ? "text-warning" : "text-foreground"}>{formatCurrencyCompact(u.consolidated.icSymmetry.delta)}</b>. {u.consolidated.icSymmetry.note}
        </p>
      </Card>

      <Card title="AFDELING in cijfers (waar getagd)" hint="⚠ Onvolledig beeld zolang de dimensie niet groepsbreed ingevuld wordt — de firma-tabel bovenaan is de betrouwbare laag." source={u.sources.find((s) => s.label.startsWith("AFDELING"))?.detail}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-1.5 text-left">Unit</th>
                <th className="px-2 py-1.5 text-right">Omzet YTD</th>
                <th className="px-2 py-1.5 text-right">Kosten YTD</th>
                <th className="px-2 py-1.5 text-right">Resultaat</th>
                <th className="px-2 py-1.5 text-right">Marge</th>
              </tr>
            </thead>
            <tbody>
              {u.units.map((x) => (
                <tr key={x.code} className="border-b border-border/40">
                  <td className="px-2 py-1.5 font-semibold text-foreground">{x.label} <span className="ml-1 font-mono text-[9px] text-muted-foreground">{x.code}</span></td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(x.revenue)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(x.costs)}</td>
                  <td className={`px-2 py-1.5 text-right font-semibold tabular-nums ${x.result >= 0 ? "text-positive" : "text-negative"}`}>{formatCurrency(x.result)}</td>
                  <td className={`px-2 py-1.5 text-right tabular-nums ${x.marginPct >= 0 ? "text-foreground" : "text-negative"}`}>{x.marginPct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card
          title="Facturatie & betaalgedrag per unit"
          hint="Uit de klantposten (dimensie op de factuur) — gefactureerd 12m incl. btw, excl. IC."
          source="Cust_LedgerEntries + DimensionSetEntries (AFDELING per Dimension_Set_ID). '(geen)' = factuur zonder AFDELING-dimensie."
        >
          {!rcv.data && <p className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Klantposten laden…</p>}
          {rcv.data && buRows.length === 1 && buRows[0].code === "(geen)" ? (
            <p className="rounded-lg bg-warning/10 p-3 text-[11px] leading-snug text-warning">
              Klantfacturen dragen in BC (vrijwel) geen AFDELING-dimensie — facturatie en DSO per unit zijn
              daardoor nog niet meetbaar. De omzet per unit hierboven komt wél correct uit het grootboek.
              Actiepunt finance: AFDELING op de verkoopboeking laten overerven; deze tabel vult zich dan vanzelf.
            </p>
          ) : rcv.data && (
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-1.5 text-left">Unit</th>
                  <th className="px-2 py-1.5 text-right">Gefact. 12m</th>
                  <th className="px-2 py-1.5 text-right">Open nu</th>
                  <th className="px-2 py-1.5 text-right">Dgn tot betaling</th>
                </tr>
              </thead>
              <tbody>
                {buRows.map((b) => (
                  <tr key={b.code} className="border-b border-border/40">
                    <td className="px-2 py-1.5 font-semibold text-foreground">{b.code}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrencyCompact(b.invoiced12m)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrencyCompact(b.openNow)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{b.avgDaysToPay != null ? `${b.avgDaysToPay}d` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card
          title="Vaste activa per klasse"
          hint={assets.data ? `${assets.data.totals.assetCount} activa · afschrijving YTD ${formatCurrencyCompact(assets.data.totals.depreciationYtd)}` : "Vaste activa laden…"}
          source={assets.data?.sources?.[0]?.detail || "FALedgerEntries + fixedAssets."}
        >
          {assets.building && !assets.data && <p className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />FA-boekingen laden…</p>}
          {assets.error && <p className="py-4 text-center text-xs text-warning">{assets.error}</p>}
          {assets.data && (
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-1.5 text-left">Klasse · subklasse</th>
                  <th className="px-2 py-1.5 text-right">#</th>
                  <th className="px-2 py-1.5 text-right">Boekwaarde</th>
                  <th className="px-2 py-1.5 text-right">CAPEX YTD</th>
                  <th className="px-2 py-1.5 text-right">Afschr. YTD</th>
                </tr>
              </thead>
              <tbody>
                {assets.data.classes.slice(0, 12).map((c) => (
                  <tr key={`${c.classCode}-${c.subclassCode}`} className="border-b border-border/40">
                    <td className="px-2 py-1.5 font-semibold text-foreground">{c.classCode} <span className="font-mono text-[9px] text-muted-foreground">{c.subclassCode}</span></td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{c.count}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(c.bookValue)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{c.acquisitionYtd ? formatCurrency(c.acquisitionYtd) : "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{c.depreciationYtd ? formatCurrency(c.depreciationYtd) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <details className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <summary className="cursor-pointer text-sm font-semibold text-foreground">Bronnen & methodiek</summary>
        <div className="mt-3 grid gap-2.5 md:grid-cols-2">
          {[...u.sources, ...(assets.data?.sources || [])].map((s) => (
            <div key={s.label} className="rounded-xl border border-border bg-background/40 p-3">
              <p className="text-[11px] font-bold text-foreground">{s.label}</p>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{s.detail}</p>
            </div>
          ))}
        </div>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-[11px] leading-snug text-muted-foreground">
          {[...u.notes, ...(assets.data?.notes || [])].map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      </details>
    </div>
  );
}
