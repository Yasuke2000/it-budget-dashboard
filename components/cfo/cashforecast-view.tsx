"use client";

// Cashflowprognose — 13-weken direct (zonder/met factoring side-by-side) +
// maandlaag tot eind volgend jaar + 6 mnd. Meeting 17/08/2026, cluster C.

import { useState } from "react";
import type { CfoCashForecast } from "@/lib/cashforecast";
import { usePolledData, Card, Kpi, KpiSourceModal, fmtStamp, weekRange, eurAxis } from "./cfo-ui";
import type { KpiSource } from "./cfo-ui";
import { EChart } from "./echart";
import { useChartPalette, echartsTooltip, echartsCategoryAxis, echartsValueAxis } from "@/lib/chart-theme";
import { Loader2, RefreshCcw, ArrowLeft, AlertTriangle } from "lucide-react";

const eur = (v: number) => `€ ${Math.round(v).toLocaleString("nl-BE")}`;
const eurS = (v: number) => `${v < 0 ? "−" : ""}€ ${Math.abs(Math.round(v / 1000)).toLocaleString("nl-BE")}k`;

export function CashForecastView() {
  const fc = usePolledData<CfoCashForecast>("/api/cfo/cashforecast");
  const pal = useChartPalette();
  const [kpiSrc, setKpiSrc] = useState<KpiSource | null>(null);
  const [scenario, setScenario] = useState<"beide" | "zonder" | "met">("beide");
  const d = fc.data;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <a href="/cfo" className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground ring-1 ring-border hover:text-foreground"><ArrowLeft className="h-3 w-3" />CFO-cockpit</a>
              <a href="/cfo/klanten" className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground ring-1 ring-border hover:text-foreground">Klanten & cash →</a>
              <h1 className="text-lg font-bold text-foreground">Cashflowprognose</h1>
              {d && !d.isLive && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold uppercase text-warning">demo</span>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              13 weken vooruit op betaalgedrag per klant (week 1–4 scherp, 5–13 richtinggevend), creditnota&apos;s gesaldeerd.
              Baseline = <b>zonder factoring</b> (het zuiverste beeld van wanneer klanten echt betalen); de lijn <b>met factoring</b> toont
              de kasrealiteit waarin ±85% al via de 433-rekening is voorgeschoten. Anker = de échte bankstand van vandaag.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {([["beide", "Side-by-side"], ["zonder", "Zonder factoring"], ["met", "Met factoring"]] as const).map(([k, lbl]) => (
                <button key={k} onClick={() => setScenario(k)}
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ring-1 transition ${scenario === k ? "bg-primary text-primary-foreground ring-primary" : "bg-muted text-muted-foreground ring-border hover:text-foreground"}`}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>
          {d && (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>Data per <b className="text-foreground">{fmtStamp(d.asOf)}</b></span>
              {d.refreshing && <span className="inline-flex items-center gap-1 text-primary"><Loader2 className="h-3 w-3 animate-spin" />vernieuwt…</span>}
              <button onClick={() => fc.reload(true)} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 font-semibold ring-1 ring-border hover:text-foreground"><RefreshCcw className="h-3 w-3" />Vernieuwen</button>
            </div>
          )}
        </div>
      </div>

      {fc.building && (
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Prognose wordt opgebouwd (klantposten, leveranciersposten, bankmutaties en saldi van alle vennootschappen — kan enkele minuten duren)…
        </div>
      )}
      {fc.error && <div className="rounded-2xl border border-negative/40 bg-negative/10 p-4 text-sm text-negative">{fc.error}</div>}

      {d && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Kpi label="Bankstand nu (eigen)" value={eurS(d.bankNow)} sub="excl. factorkrediet — het anker van de prognose"
              onClick={() => setKpiSrc({ label: "Bankstand nu", value: eur(d.bankNow), bron: "Som van alle eigen bankrekeningen (BankAccountLedgerEntries per rekening), exclusief de factor-rekeningen — het opgenomen factorvoorschot is een schuld (433), geen cash.", caveat: "Live BC-stand; Isabel/CODA-dagreconciliatie is fase 2." })} />
            <Kpi label="Laagste punt (zonder factoring)" value={eurS(d.lowPoint.noFactor.value)} tone={d.lowPoint.noFactor.value < 0 ? "neg" : "pos"}
              sub={`week van ${weekRange(d.lowPoint.noFactor.week)}`}
              onClick={() => setKpiSrc({ label: "Laagste punt — zonder factoring", value: eur(d.lowPoint.noFactor.value), bron: "Cumulatief saldo per week: bankstand nu + verwachte ontvangsten (betaalgedrag per klant, CN gesaldeerd, 100% van de factuur) − leveranciers op vervaldag − lonen/btw/leasing op kalenderdata.", caveat: "Baseline uit de meeting: factoring buiten beschouwing voor het zuiverste beeld." })} />
            <Kpi label="Laagste punt (met factoring)" value={eurS(d.lowPoint.withFactor.value)} tone={d.lowPoint.withFactor.value < 0 ? "neg" : "pos"}
              sub={`week van ${weekRange(d.lowPoint.withFactor.week)}`}
              onClick={() => setKpiSrc({ label: "Laagste punt — met factoring", value: eur(d.lowPoint.withFactor.value), bron: "Zelfde opbouw, maar bij factoring-klanten telt alleen het 15%-saldo als komende ontvangst (85% is al voorgeschoten via de 433-rekening).", caveat: "Nieuwe facturatie ná vandaag (en dus nieuwe 85%-voorschotten) zit nog niet in het weekbeeld — daarvoor zijn de E-trans opmaakdatums nodig (fase 2)." })} />
            <Kpi label="Niet-toegewezen betalingen" value={eurS(d.totals.unapplied)} sub={`${d.totals.unappliedCount} open betalingen zonder factuur`}
              onClick={() => setKpiSrc({ label: "Niet-toegewezen betalingen", value: eur(d.totals.unapplied), bron: "Open klantposten van het type Betaling (Cust_LedgerEntries, Open=true): geld dat op de bank staat maar (nog) niet aan een factuur is afgepunt — drukt het echte openstaande saldo.", excel: "Klantenaging-export: gesaldeerd in het blok van hun datum." })} />
            <Kpi label="433-saldo (factor R/C)" value={eurS(d.totals.saldo433)} sub="de lump-sum 'zak met geld' bij de factors"
              onClick={() => setKpiSrc({ label: "Rekening 433 — factor rekening-courant", value: eur(d.totals.saldo433), bron: "trialBalances per vennootschap, alle 433-rekeningen: het saldo tussen voorgeschoten (85%) en afgerekende facturen. Negatief = opgenomen voorschot (schuld aan de factor).", caveat: "Koppeling van individuele 433-bewegingen aan facturen is fase 2 (factorportaal-rapporten)." })} />
          </div>

          <Card title="13 weken — in/uit per week en cumulatief saldo" period={`${weekRange(d.weeks[0].weekStart)} → ${weekRange(d.weeks[12].weekStart)}`}
            hint="Balken = verwachte in- en uitstromen per week. Lijnen = cumulatief banksaldo per scenario; onder nul = liquiditeitstekort."
            onSource={() => setKpiSrc({ label: "13-weken prognose", value: "", bron: d.sources.map((s) => `${s.label}: ${s.detail}`).join("\n\n") })}>
            <EChart height={340} ariaLabel="13-weken cashflowprognose"
              option={{
                tooltip: { ...echartsTooltip(pal), trigger: "axis", valueFormatter: (v) => eur(Number(v || 0)) },
                legend: { textStyle: { color: pal.text, fontSize: 10 }, top: 0 },
                grid: { left: 64, right: 16, top: 34, bottom: 26 },
                xAxis: echartsCategoryAxis(pal, { data: d.weeks.map((w) => w.label) }),
                yAxis: echartsValueAxis(pal, (v) => eurAxis(v)),
                series: [
                  ...(scenario !== "met" ? [{ name: "In (zonder factoring)", type: "bar" as const, stack: "in", data: d.weeks.map((w) => w.inNoFactor), itemStyle: { color: pal.income, opacity: 0.85 } }] : []),
                  ...(scenario !== "zonder" ? [{ name: "In (met factoring, 15%-saldo)", type: "bar" as const, stack: "inF", data: d.weeks.map((w) => w.inWithFactor), itemStyle: { color: pal.info, opacity: 0.7 } }] : []),
                  { name: "Uit (leveranciers)", type: "bar", stack: "uit", data: d.weeks.map((w) => -w.outAP), itemStyle: { color: pal.expense, opacity: 0.85 } },
                  { name: "Uit (lonen/btw/leasing)", type: "bar", stack: "uit", data: d.weeks.map((w) => -w.outFixed), itemStyle: { color: pal.warning, opacity: 0.8 } },
                  ...(scenario !== "met" ? [{ name: "Saldo zonder factoring", type: "line" as const, data: d.weeks.map((w) => w.cumNoFactor), lineStyle: { width: 2.5, color: pal.positive }, itemStyle: { color: pal.positive }, symbolSize: 5 }] : []),
                  ...(scenario !== "zonder" ? [{ name: "Saldo met factoring", type: "line" as const, data: d.weeks.map((w) => w.cumWithFactor), lineStyle: { width: 2.5, color: pal.info, type: "dashed" as const }, itemStyle: { color: pal.info }, symbolSize: 5 }] : []),
                  { name: "nul", type: "line", data: d.weeks.map(() => 0), lineStyle: { width: 1, color: pal.negative, type: "dotted" }, symbol: "none", tooltip: { show: false } },
                ],
              }} />
            {(d.negativeWeeks.noFactor.length > 0 || d.negativeWeeks.withFactor.length > 0) && (
              <p className="mt-2 inline-flex items-start gap-1.5 text-[11px] text-negative">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Kantelpunt: het saldo duikt onder nul {d.negativeWeeks.withFactor.length > 0 && `mét factoring in de week van ${weekRange(d.negativeWeeks.withFactor[0])}`}
                {d.negativeWeeks.noFactor.length > 0 && `${d.negativeWeeks.withFactor.length > 0 ? " en " : ""}zónder factoring in de week van ${weekRange(d.negativeWeeks.noFactor[0])}`}.
              </p>
            )}
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[860px] text-[11px]">
                <thead>
                  <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-1.5 pr-2">Week</th>
                    <th className="py-1.5 pr-2 text-right">In zonder</th>
                    <th className="py-1.5 pr-2 text-right">In met (15%)</th>
                    <th className="py-1.5 pr-2 text-right">Uit leveranciers</th>
                    <th className="py-1.5 pr-2 text-right">Uit vast</th>
                    <th className="py-1.5 pr-2 text-right">Saldo zonder</th>
                    <th className="py-1.5 pr-2 text-right">Saldo met</th>
                  </tr>
                </thead>
                <tbody>
                  {d.weeks.map((w) => (
                    <tr key={w.weekStart} className="border-b border-border/50">
                      <td className="py-1 pr-2 font-medium text-foreground">{w.label} · {weekRange(w.weekStart)}</td>
                      <td className="py-1 pr-2 text-right tabular-nums text-positive">{eurS(w.inNoFactor)}</td>
                      <td className="py-1 pr-2 text-right tabular-nums text-info" style={{ color: pal.info }}>{eurS(w.inWithFactor)}</td>
                      <td className="py-1 pr-2 text-right tabular-nums text-negative">{eurS(-w.outAP)}</td>
                      <td className="py-1 pr-2 text-right tabular-nums text-warning">{eurS(-w.outFixed)}</td>
                      <td className={`py-1 pr-2 text-right font-semibold tabular-nums ${w.cumNoFactor < 0 ? "text-negative" : "text-foreground"}`}>{eurS(w.cumNoFactor)}</td>
                      <td className={`py-1 pr-2 text-right font-semibold tabular-nums ${w.cumWithFactor < 0 ? "text-negative" : "text-foreground"}`}>{eurS(w.cumWithFactor)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="py-1.5 pr-2 text-muted-foreground">ná week 13 nog verwacht</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">{eurS(d.beyond13w.inNoFactor)}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">{eurS(d.beyond13w.inWithFactor)}</td>
                    <td colSpan={4} />
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Maandlaag — tot eind volgend jaar + 6 maanden" period={`${d.months.find((m) => !m.isActual)?.month || ""} → ${d.months[d.months.length - 1]?.month || ""}`}
            hint="Seizoensbeeld uit de échte bankmutaties (excl. factorbewegingen): richtinggevend, geen budget. De 12-maanden indirecte prognose blijft EMAsphere."
            onSource={() => setKpiSrc({ label: "Maandlaag", value: "", bron: "Per kalendermaand het gemiddelde van de werkelijke bankin- en uitstromen van de afgelopen 13 maanden (BankAccountLedgerEntries, alle merken behalve Factor), doorgetrokken tot eind volgend jaar + 6 maanden. Cumulatief vanaf de bankstand van vandaag.", caveat: "Puur seizoenspatroon: bevat géén groei, prijsstijgingen, capex-planning of de CO₂-tolverhoging (1/7-effect zit deels in de historiek)." })}>
            <EChart height={300} ariaLabel="Maandprognose cashflow"
              option={{
                tooltip: { ...echartsTooltip(pal), trigger: "axis", valueFormatter: (v) => eur(Number(v || 0)) },
                legend: { textStyle: { color: pal.text, fontSize: 10 }, top: 0 },
                grid: { left: 64, right: 16, top: 34, bottom: 26 },
                xAxis: echartsCategoryAxis(pal, { data: d.months.map((m) => m.month) }),
                yAxis: echartsValueAxis(pal, (v) => eurAxis(v)),
                series: [
                  { name: "Netto per maand (historiek)", type: "bar", data: d.months.map((m) => (m.isActual ? m.net : null)), itemStyle: { color: pal.budget, opacity: 0.7 } },
                  { name: "Netto per maand (projectie)", type: "bar", data: d.months.map((m) => (m.isActual ? null : m.net)), itemStyle: { color: pal.result, opacity: 0.85 } },
                  { name: "Cumulatief saldo (projectie)", type: "line", data: d.months.map((m) => (m.isActual ? null : m.cum)), lineStyle: { width: 2.5, color: pal.info }, itemStyle: { color: pal.info }, symbolSize: 4 },
                ],
              }} />
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Per vennootschap — 433, btw en niet-toegewezen" period="stand vandaag"
              hint="De 'zak met geld': factor-rekening-courant (433), te betalen btw (451) en betalingen die nog niet aan een factuur hangen.">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-[11px]">
                  <thead>
                    <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                      <th className="py-1.5 pr-2">Firma</th>
                      <th className="py-1.5 pr-2 text-right">433-saldo</th>
                      <th className="py-1.5 pr-2 text-right">Btw (451)</th>
                      <th className="py-1.5 pr-2 text-right">Niet-toegewezen bet.</th>
                      <th className="py-1.5 pr-2 text-right">Open CN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.perCompany.filter((c) => c.saldo433 || c.btwSaldo || c.unappliedPayments || c.openCn).map((c) => (
                      <tr key={c.company} className="border-b border-border/50">
                        <td className="py-1 pr-2 font-medium text-foreground">{c.company}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{c.saldo433 ? eurS(c.saldo433) : "—"}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{c.btwSaldo ? eurS(c.btwSaldo) : "—"}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{c.unappliedPayments ? `${eurS(c.unappliedPayments)} (${c.unappliedCount})` : "—"}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{c.openCn ? eurS(c.openCn) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card title="Aannames & wat nog ontbreekt" period="v1 — 17/08/2026"
              hint="Elke aanname staat hier expliciet; fase 2 sluit de gaten met E-trans, CODA en de factorportalen.">
              <ul className="list-disc space-y-1.5 pl-4 text-[11px] leading-snug text-muted-foreground">
                {d.aannames.map((a, i) => <li key={i}>{a}</li>)}
                {d.notes.map((n, i) => <li key={`n${i}`} className="text-foreground/80">{n}</li>)}
              </ul>
            </Card>
          </div>
        </>
      )}
      {kpiSrc && <KpiSourceModal src={kpiSrc} onClose={() => setKpiSrc(null)} />}
    </div>
  );
}
