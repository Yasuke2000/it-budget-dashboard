"use client";

// Dagelijkse cashpositie — vraag CFO 18/08/2026: bankstand nu, wie gisteren
// betaalde, dalende outstandings (credit-control-resultaat) en de
// blokkeeranalyse +60/+75 dagen met omzetimpact.

import { useState } from "react";
import type { CfoDagbrief, DagBlokKlant } from "@/lib/dagbrief";
import { usePolledData, Card, Kpi, KpiSourceModal, fmtStamp, eurAxis } from "./cfo-ui";
import type { KpiSource } from "./cfo-ui";
import { EChart } from "./echart";
import { useChartPalette, echartsTooltip, echartsCategoryAxis, echartsValueAxis } from "@/lib/chart-theme";
import { Loader2, RefreshCcw, ArrowLeft } from "lucide-react";

const eur = (v: number) => `€ ${Math.round(v).toLocaleString("nl-BE")}`;
const eurS = (v: number) => {
  const a = Math.abs(v), sign = v < 0 ? "−" : "";
  if (a >= 950_000) return `${sign}€ ${(a / 1e6).toLocaleString("nl-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}M`;
  return `${sign}€ ${Math.round(a / 1000).toLocaleString("nl-BE")}k`;
};

function BlokTabel({ b, drempel }: { b: { klanten: number; vervallen: number; openTotaal: number; omzet12m: number; lijst: DagBlokKlant[] }; drempel: number }) {
  return (
    <div>
      <p className="mb-2 text-[11px] text-muted-foreground">
        <b className="text-foreground">{b.klanten} klanten</b> hebben een factuur die ≥ {drempel} dagen vervallen is —
        samen <b className="text-negative">{eurS(b.vervallen)} vervallen</b> ({eurS(b.openTotaal)} totaal open).
        Blokkeren raakt <b className="text-foreground">{eurS(b.omzet12m)}</b> jaaromzet (12m, incl. btw).
      </p>
      <div className="max-h-72 overflow-y-auto">
        <table className="w-full min-w-[560px] text-[11px]">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="py-1 pr-2">Klant</th>
              <th className="py-1 pr-2 text-right">Oudste (d)</th>
              <th className="py-1 pr-2 text-right">Vervallen</th>
              <th className="py-1 pr-2 text-right">Open totaal</th>
              <th className="py-1 pr-2 text-right">Omzet 12m</th>
            </tr>
          </thead>
          <tbody>
            {b.lijst.map((k) => (
              <tr key={`${k.co}-${k.klant}`} className="border-b border-border/40">
                <td className="py-1 pr-2 font-medium text-foreground">{k.klant} <span className="text-muted-foreground">· {k.co}</span></td>
                <td className="py-1 pr-2 text-right tabular-nums">{k.oudsteDagen}</td>
                <td className="py-1 pr-2 text-right tabular-nums text-negative">{eurS(k.vervallen)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{eurS(k.openTotaal)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{k.omzet12m != null ? eurS(k.omzet12m) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function DagbriefView() {
  const db = usePolledData<CfoDagbrief>("/api/cfo/dagbrief");
  const pal = useChartPalette();
  const [kpiSrc, setKpiSrc] = useState<KpiSource | null>(null);
  const [blokTab, setBlokTab] = useState<"d60" | "d75">("d60");
  const d = db.data;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <a href="/cfo" className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground ring-1 ring-border hover:text-foreground"><ArrowLeft className="h-3 w-3" />CFO-cockpit</a>
              <a href="/cfo/cashflow" className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground ring-1 ring-border hover:text-foreground">Cashflowprognose →</a>
              <h1 className="text-lg font-bold text-foreground">Dagelijkse cashpositie</h1>
              {d && !d.isLive && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold uppercase text-warning">demo</span>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Elke ochtend vers (cron 07:15): hoeveel geld er beschikbaar is, wie er gisteren betaald heeft, en of de
              outstandings dalen — het dagelijkse resultaat van de credit-control-acties.
            </p>
          </div>
          {d && (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>Data per <b className="text-foreground">{fmtStamp(d.asOf)}</b></span>
              {d.refreshing && <span className="inline-flex items-center gap-1 text-primary"><Loader2 className="h-3 w-3 animate-spin" />vernieuwt…</span>}
              <button onClick={() => db.reload(true)} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 font-semibold ring-1 ring-border hover:text-foreground"><RefreshCcw className="h-3 w-3" />Vernieuwen</button>
            </div>
          )}
        </div>
      </div>

      {db.building && (
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Dagbrief wordt opgebouwd (bankstand, betalingen van gisteren en alle open posten)…
        </div>
      )}
      {db.error && <div className="rounded-2xl border border-negative/40 bg-negative/10 p-4 text-sm text-negative">{db.error}</div>}

      {d && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Beschikbaar op de bank" value={eurS(d.bankEigen)} tone={d.bankEigen < 0 ? "neg" : "pos"}
              sub={`eigen rekeningen, stand ${fmtStamp(d.bankAsOf)}`}
              onClick={() => setKpiSrc({ label: "Beschikbaar op de bank", value: eur(d.bankEigen), bron: d.sources[0].detail })} />
            <Kpi label={`Gisteren ontvangen (${d.ontvangenGister.datum.slice(8, 10)}/${d.ontvangenGister.datum.slice(5, 7)})`} value={eurS(d.ontvangenGister.totaal)} tone="pos"
              sub={`${d.ontvangenGister.aantal} betalingen — lijst hieronder`}
              onClick={() => setKpiSrc({ label: "Gisteren ontvangen", value: eur(d.ontvangenGister.totaal), bron: d.sources[1].detail })} />
            <Kpi label="Open extern (netto)" value={eurS(d.openExtern)}
              sub={d.deltaVsGister.openExtern != null ? `${d.deltaVsGister.openExtern <= 0 ? "▼" : "▲"} ${eurS(Math.abs(d.deltaVsGister.openExtern))} vs gisteren` : "trend start vandaag"}
              tone={d.deltaVsGister.openExtern != null && d.deltaVsGister.openExtern > 0 ? "warn" : "neutral"}
              onClick={() => setKpiSrc({ label: "Open extern", value: eur(d.openExtern), bron: d.sources[2].detail })} />
            <Kpi label="Waarvan vervallen" value={eurS(d.vervallen)}
              sub={d.deltaVsGister.vervallen != null ? `${d.deltaVsGister.vervallen <= 0 ? "▼" : "▲"} ${eurS(Math.abs(d.deltaVsGister.vervallen))} vs gisteren` : "trend start vandaag"}
              tone={d.deltaVsGister.vervallen != null && d.deltaVsGister.vervallen > 0 ? "warn" : "neg"}
              onClick={() => setKpiSrc({ label: "Vervallen facturen", value: eur(d.vervallen), bron: d.sources[2].detail })} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Wie heeft gisteren betaald?" period={d.ontvangenGister.datum}
              hint="Externe klantbetalingen op boekdatum gisteren, per klant. Klik de klant om zijn posten in BC te openen.">
              {d.ontvangenGister.top.length === 0 && <p className="text-sm text-muted-foreground">Geen externe betalingen geboekt op {d.ontvangenGister.datum}.</p>}
              <div className="max-h-80 overflow-y-auto">
                {d.ontvangenGister.top.map((b) => (
                  <div key={`${b.co}-${b.klant}`} className="flex items-baseline justify-between gap-2 border-b border-border/40 py-1 text-xs">
                    <a href={b.bcUrl} target="_blank" rel="noreferrer" className="min-w-0 truncate font-medium text-foreground underline decoration-dotted underline-offset-2 hover:text-primary">
                      {b.klant} <span className="font-normal text-muted-foreground">· {b.co}</span>
                    </a>
                    <span className="shrink-0 tabular-nums text-positive">{eurS(b.bedrag)}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Dalende outstandings — de trend" period="laatste 30 dagen"
              hint="Elke dag één punt (07:15-cron). Doel: de rode lijn (vervallen) elke dag lager."
              onSource={() => setKpiSrc({ label: "Trend", value: "", bron: d.sources[3].detail })}>
              {d.trend.length < 2 ? (
                <p className="text-sm text-muted-foreground">Trend start vandaag — vanaf morgen zie je hier de daling (of stijging) per dag.{!d.dbOk && " LET OP: dagstand kon niet worden opgeslagen (database)."}</p>
              ) : (
                <EChart height={260} ariaLabel="Outstandings-trend"
                  option={{
                    tooltip: { ...echartsTooltip(pal), trigger: "axis", valueFormatter: (v) => (v == null ? "—" : eur(Number(v))) },
                    legend: { textStyle: { color: pal.text, fontSize: 10 }, bottom: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10 },
                    grid: { left: 64, right: 16, top: 16, bottom: 52 },
                    xAxis: echartsCategoryAxis(pal, { data: d.trend.map((t) => `${t.dag.slice(8, 10)}/${t.dag.slice(5, 7)}`) }),
                    yAxis: echartsValueAxis(pal, (v) => eurAxis(v)),
                    series: [
                      { name: "Open extern", type: "line", data: d.trend.map((t) => t.openExtern), lineStyle: { width: 2.5, color: pal.info }, itemStyle: { color: pal.info }, symbolSize: 5 },
                      { name: "Waarvan vervallen", type: "line", data: d.trend.map((t) => t.vervallen), lineStyle: { width: 2.5, color: pal.negative }, itemStyle: { color: pal.negative }, symbolSize: 5 },
                    ],
                  }} />
              )}
            </Card>
          </div>

          <Card title="Blokkeeranalyse — wie zouden we blokkeren, en wat kost dat aan omzet?" period={`stand ${d.dag}`}
            hint="Beslisondersteuning, geen automatische blokkade: klanten met minstens één vervallen factuur ouder dan de drempel (en > €500 vervallen)."
            onSource={() => setKpiSrc({ label: "Blokkeeranalyse", value: "", bron: d.sources[2].detail })}>
            <div className="mb-3 flex items-center gap-1.5">
              {([["d60", "≥ 60 dagen"], ["d75", "≥ 75 dagen"]] as const).map(([k, lbl]) => (
                <button key={k} onClick={() => setBlokTab(k)}
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ring-1 transition ${blokTab === k ? "bg-primary text-primary-foreground ring-primary" : "bg-muted text-muted-foreground ring-border hover:text-foreground"}`}>
                  {lbl}
                </button>
              ))}
            </div>
            <BlokTabel b={d.blok[blokTab]} drempel={blokTab === "d60" ? 60 : 75} />
          </Card>

          <Card title="Leeswijzer" period="dagelijks proces">
            <ul className="list-disc space-y-1.5 pl-4 text-[11px] leading-snug text-muted-foreground">
              {d.notes.map((n, i) => <li key={i}>{n}</li>)}
              <li>Betaaldatum = boekdatum in BC — hoe sneller finance de bankbestanden verwerkt, hoe actueler dit beeld (CODA-automatisering = fase 2).</li>
            </ul>
          </Card>
        </>
      )}
      {kpiSrc && <KpiSourceModal src={kpiSrc} onClose={() => setKpiSrc(null)} />}
    </div>
  );
}
