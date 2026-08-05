"use client";

// Klanten & Cash — de DSO/factoring/betaalgedrag-deep-dive (CFO-meeting 08/2026).
// Data: /api/cfo/receivables + /api/cfo/vat. Beide zijn zware BC-pulls: bij een
// koude cache antwoordt de API 202 {building:true} en pollt deze pagina tot de
// data klaar is. Grafieken op ECharts met het gedeelde thema-palet, drill-downs
// met BC-deeplinks — zelfde conventies als de CFO-cockpit.

import { useMemo, useState } from "react";
import * as echarts from "echarts";
import type { CfoReceivables, CfoVat, RcvCustomerRow, RcvInvoiceItem } from "@/lib/types";
import type { CfoBank } from "@/lib/bank";
import type { CfoAgingCheck } from "@/lib/aging-check";
import type { CfoUnits } from "@/lib/units";
import { EChart } from "./echart";
import { formatCurrency, formatCurrencyCompact } from "@/lib/utils";
import { useChartPalette } from "@/lib/chart-theme";
import { usePolledData, Card, Kpi, KpiSourceModal, type KpiSource, eurAxis, fmtStamp, fmtMonth, fmtDate, fmtDM, weekRange } from "./cfo-ui";
import { glAccountLink } from "@/lib/bc-links";
import {
  Loader2, RefreshCcw, Info, ExternalLink,
  AlertTriangle, Search, ArrowUpDown, Receipt, Undo2, X, ArrowLeft, ShieldCheck,
  CalendarClock, FileSpreadsheet,
} from "lucide-react";

type LP = echarts.DefaultLabelFormatterCallbackParams;

// Uitleg per DSO-categorie — verschijnt als tooltip op de legenda én in de kaart,
// omdat de termen zonder uitleg niet intuïtief zijn (CFO-feedback 04/08/2026).
const CAT_UITLEG: Record<string, string> = {
  "DSO extern totaal": "Alle externe klanten samen (factoring + niet-factoring, zonder intercompany).<br/>Hoeveel dagen omzet staat er gemiddeld open? Lager = sneller geld.<br/><i>AR-eindsaldo van de maand ÷ omzet van die maand × dagen in de maand.</i>",
  "DSO via factoring": "Klanten waarvan de facturen via een factor (KBC/Belfius/BNP) afgewikkeld worden.<br/>Dit meet <b>time-to-cash</b>: hoe snel de factuur geld wordt — niet hoe snel de eindklant betaalt.",
  "DSO niet-factoring": "Klanten die rechtstreeks aan ons betalen, buiten factoring om.<br/>Dit is het <b>echte betaalgedrag</b> van die klanten. Hoger dan de factoring-lijn = hier zit de cash vast.",
  "DSO countback": "Zelfde vraag, andere rekenwijze: vanaf het openstaand saldo maand per maand terugtellen tegen de werkelijke omzet.<br/>Robuuster bij schommelende omzet; de meeste CFO's gebruiken deze naast de balansmethode.",
  "DPO (leveranciers)": "Spiegelbeeld aan de inkoopzijde: na hoeveel dagen betalen wíj onze leveranciers (extern).<br/>DPO hoger dan DSO = de groep wordt sneller betaald dan ze betaalt.",
};

// ---- klantentabel: sorteerbaar + zoekbaar ----
type SortKey = "invoiced12m" | "openNow" | "overdueNow" | "avgDaysToPay" | "avgDaysVsDue" | "factoredSharePct" | "creditUsedPct";
function CustomerTable({ customers, onPick }: { customers: RcvCustomerRow[]; onPick: (c: RcvCustomerRow) => void }) {
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("invoiced12m");
  const [desc, setDesc] = useState(true);
  const rows = useMemo(() => {
    const f = q.trim().toUpperCase();
    const filtered = customers.filter((c) => !f || c.name.includes(f));
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? -1e15, bv = b[sortKey] ?? -1e15;
      return desc ? Number(bv) - Number(av) : Number(av) - Number(bv);
    });
  }, [customers, q, sortKey, desc]);
  // Gewone renderfunctie (geen inline component — react-hooks/static-components).
  const sortableTh = (k: SortKey, label: string, title?: string) => (
    <th
      key={k}
      className="cursor-pointer select-none whitespace-nowrap px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
      title={title}
      onClick={() => { if (sortKey === k) setDesc(!desc); else { setSortKey(k); setDesc(true); } }}
    >
      <span className="inline-flex items-center gap-0.5">{label}<ArrowUpDown className="h-2.5 w-2.5 opacity-60" /></span>
    </th>
  );
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="pointer-events-none absolute left-2 top-1.5 h-3.5 w-3.5 text-muted-foreground/60" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek klant…"
            className="w-full rounded-lg border border-border bg-background py-1 pl-7 pr-2 text-xs text-foreground placeholder:text-muted-foreground/60"
          />
        </div>
        <p className="text-[10px] text-muted-foreground">{rows.length} klanten · klik een rij voor detail</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Klant</th>
              {sortableTh("invoiced12m", "Gefact. 12m", "Gefactureerd laatste 12 maanden (incl. btw)")}
              {sortableTh("openNow", "Open")}
              {sortableTh("overdueNow", "Vervallen")}
              {sortableTh("avgDaysToPay", "Dgn tot betaling", "Bedrag-gewogen gemiddelde: factuurdatum → laatste betaling")}
              {sortableTh("avgDaysVsDue", "Vs vervaldag", "Positief = te laat betaald")}
              {sortableTh("factoredSharePct", "Factoring", "Aandeel betaald volume dat via een factor-dagboek liep")}
              {sortableTh("creditUsedPct", "Krediet", "Open saldo t.o.v. de kredietlimiet op de klantkaart(en)")}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 40).map((c) => (
              <tr key={c.name} onClick={() => onPick(c)} className="cursor-pointer border-b border-border/50 hover:bg-accent/50">
                <td className="max-w-[260px] truncate px-2 py-1.5 font-medium text-foreground" title={`${c.name} · ${c.companies.join(", ")}`}>
                  {c.name}
                  <span className="ml-1.5 text-[9px] text-muted-foreground">{c.companies.join("·")}</span>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrencyCompact(c.invoiced12m)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{c.openNow ? formatCurrencyCompact(c.openNow) : "—"}</td>
                <td className={`px-2 py-1.5 text-right tabular-nums ${c.overdueNow > 0 ? "text-negative" : ""}`}>{c.overdueNow ? formatCurrencyCompact(c.overdueNow) : "—"}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{c.avgDaysToPay != null ? `${c.avgDaysToPay}d` : "—"}</td>
                <td className={`px-2 py-1.5 text-right tabular-nums font-semibold ${c.avgDaysVsDue == null ? "" : c.avgDaysVsDue <= 0 ? "text-positive" : c.avgDaysVsDue <= 15 ? "text-warning" : "text-negative"}`}>
                  {c.avgDaysVsDue != null ? `${c.avgDaysVsDue > 0 ? "+" : ""}${c.avgDaysVsDue}d` : "—"}
                </td>
                <td className="px-2 py-1.5 text-right">
                  {c.factoredSharePct >= 40
                    ? <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">factor {Math.round(c.factoredSharePct)}%</span>
                    : c.factoredSharePct > 0
                      ? <span className="text-[10px] text-muted-foreground">{Math.round(c.factoredSharePct)}%</span>
                      : <span className="text-[10px] text-muted-foreground">—</span>}
                </td>
                <td className="px-2 py-1.5 text-right" title={c.creditLimit ? `Limiet ${formatCurrencyCompact(c.creditLimit)}` : "Geen kredietlimiet op de klantkaart"}>
                  {c.creditUsedPct != null
                    ? <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${c.creditUsedPct > 100 ? "bg-negative/15 text-negative" : c.creditUsedPct > 80 ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground"}`}>{Math.round(c.creditUsedPct)}%</span>
                    : <span className="text-[10px] text-muted-foreground">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- open-postenlijst met BC-links ----
function InvoiceList({ items, emptyLabel }: { items: RcvInvoiceItem[]; emptyLabel: string }) {
  if (!items.length) return <p className="py-3 text-center text-xs text-muted-foreground">{emptyLabel}</p>;
  return (
    <div className="max-h-80 overflow-y-auto overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-xs">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="px-2 py-1 text-left">Klant</th>
            <th className="px-2 py-1 text-left">Firma</th>
            <th className="px-2 py-1 text-left">Document</th>
            <th className="px-2 py-1 text-right">Factuurdatum</th>
            <th className="px-2 py-1 text-right">Vervaldag</th>
            <th className="px-2 py-1 text-right">Dgn over</th>
            <th className="px-2 py-1 text-right">Bedrag</th>
            <th className="px-2 py-1 text-right">Kanaal</th>
            <th className="px-2 py-1" />
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={`${it.company}-${it.docNo}-${i}`} className="border-b border-border/40">
              <td className="max-w-[220px] truncate px-2 py-1 text-foreground" title={it.customer}>{it.customer}</td>
              <td className="px-2 py-1 text-muted-foreground">{it.company}</td>
              <td className="px-2 py-1 font-mono text-[11px] text-muted-foreground">{it.docNo}</td>
              <td className="px-2 py-1 text-right tabular-nums">{fmtDate(it.invDate)}</td>
              <td className="px-2 py-1 text-right tabular-nums">{fmtDate(it.dueDate)}</td>
              <td className={`px-2 py-1 text-right tabular-nums ${it.daysVsDue != null && it.daysVsDue > 0 ? "text-negative font-semibold" : "text-muted-foreground"}`}>
                {it.daysVsDue != null ? (it.daysVsDue > 0 ? `+${it.daysVsDue}` : it.daysVsDue) : "—"}
              </td>
              <td className="px-2 py-1 text-right font-semibold tabular-nums text-foreground">{formatCurrency(it.amount)}</td>
              <td className="px-2 py-1 text-right">
                {it.via === "IC"
                  ? <span className="rounded bg-muted px-1 py-0.5 text-[9px] font-semibold text-muted-foreground">IC</span>
                  : it.via
                    ? <span className="rounded bg-primary/15 px-1 py-0.5 text-[9px] font-semibold text-primary">{it.via}</span>
                    : <span className="text-[9px] text-muted-foreground">bank</span>}
              </td>
              <td className="px-2 py-1 text-right">
                {it.bcUrl && (
                  <a href={it.bcUrl} target="_blank" rel="noreferrer" title="Open in Business Central" className="inline-flex text-primary hover:opacity-80">
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function KlantenCash({ exclude }: { exclude: string[] }) {
  const qs = exclude.length ? `?exclude=${exclude.join(",")}` : "";
  const rcv = usePolledData<CfoReceivables>(`/api/cfo/receivables${qs}`);
  const vat = usePolledData<CfoVat>(`/api/cfo/vat${qs}`);
  const bank = usePolledData<CfoBank>(`/api/cfo/bank${qs}`);
  const agingChk = usePolledData<CfoAgingCheck>(`/api/cfo/aging-check${qs}`);
  const unitsData = usePolledData<CfoUnits>(`/api/cfo/units${qs}`); // omzet per klant (excl. btw) uit het grootboek
  const p = useChartPalette();
  const [pickedCustomer, setPickedCustomer] = useState<RcvCustomerRow | null>(null);
  const [showOpenList, setShowOpenList] = useState(false);
  const [pickedMonth, setPickedMonth] = useState<number | null>(null); // index in dso.months (grafiek-drill)
  const [kpiMonth, setKpiMonth] = useState<number | null>(null);       // maand waarop de KPI-rij rekent
  const [chartRange, setChartRange] = useState<12 | 19>(19);           // getoond interval in de DSO-grafiek
  const [kpiSrc, setKpiSrc] = useState<KpiSource | null>(null);        // bronpaneel achter een KPI
  const [ageBucket, setAgeBucket] = useState<number>(1);               // gekozen blok in de bellijst
  const d = rcv.data;

  // ---------- grafiek-opties ----------
  const dsoTrend = useMemo<echarts.EChartsOption | null>(() => {
    if (!d) return null;
    const s = d.dso;
    const from = Math.max(0, s.months.length - chartRange);
    const months = s.months.slice(from);
    // Laatste vangnet: een dagenwaarde boven de 400 is per definitie een artefact van
    // een onvolledig geboekte maand. Die tonen we niet — ook niet als een oudere
    // payload hem ooit toch zou aanleveren (dan blijft de schaal leesbaar).
    const sane = (v: number | null) => (v == null || Math.abs(v) > 400 ? null : v);
    const cut = (a: (number | null)[]) => a.slice(from).map(sane);
    // Onzichtbare balk over de volledige kolombreedte: zo is élke maand aanklikbaar
    // (exact op een lijnpunt raken lukte niet — CFO-feedback "ik kan niet doorklikken").
    const clickCatcher: echarts.SeriesOption = {
      name: "kolom", type: "bar", barWidth: "100%",
      itemStyle: { color: "transparent" }, emphasis: { itemStyle: { color: `${p.text}12` } },
      data: months.map(() => 1), yAxisIndex: 1, z: 0,
    };
    const line = (name: string, data: (number | null)[], color: string, w: number, dash?: "dashed" | "dotted"): echarts.SeriesOption => ({
      name, type: "line", data: cut(data || []), itemStyle: { color },
      lineStyle: { width: w, ...(dash ? { type: dash } : {}) },
      symbol: dash ? "none" : "circle", symbolSize: w >= 2.5 ? 5 : 4, connectNulls: true, z: 3,
    });
    return {
      tooltip: {
        trigger: "axis",
        formatter: (prs: unknown) => {
          const arr = (prs as { seriesName: string; value: unknown; marker: string; dataIndex: number }[]).filter((x) => x.seriesName !== "kolom");
          const mi = arr[0]?.dataIndex ?? 0;
          const rows = arr.map((x) => `${x.marker}${x.seriesName}: <b>${x.value == null ? "n.b." : `${x.value} dagen`}</b>`).join("<br/>");
          return `<b>${fmtMonth(months[mi])}</b><br/>${rows}<br/><i style="opacity:.65">klik voor de onderliggende bedragen</i>`;
        },
      },
      legend: {
        data: ["DSO extern totaal", "DSO via factoring", "DSO niet-factoring", "DSO countback", "DPO (leveranciers)"],
        textStyle: { color: p.text, fontSize: 10 }, top: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10, type: "scroll",
        // Zweef over een categorie → uitleg in gewone taal.
        tooltip: {
          show: true,
          formatter: (pp: unknown) => CAT_UITLEG[(pp as { name: string }).name] || (pp as { name: string }).name,
          extraCssText: "max-width:360px;white-space:normal;line-height:1.5",
        },
      },
      grid: { top: 34, left: 6, right: 8, bottom: 20, containLabel: true },
      xAxis: { type: "category", data: months.map(fmtMonth), axisLabel: { color: p.text, fontSize: 9 }, axisLine: { lineStyle: { color: p.axis } }, axisTick: { show: false } },
      yAxis: [
        { type: "value", name: "dagen", nameTextStyle: { color: p.textMuted, fontSize: 9 }, axisLabel: { color: p.textMuted }, splitLine: { lineStyle: { color: p.grid } } },
        { type: "value", max: 1, show: false },
      ],
      series: [
        clickCatcher,
        line("DSO extern totaal", s.dsoTotal, p.result, 2.5),
        line("DSO via factoring", s.dsoExtFactoring, p.income, 1.8),
        line("DSO niet-factoring", s.dsoExtOther, p.warning, 1.8),
        line("DSO countback", s.dsoCountback, p.categorical[5], 1.5, "dotted"),
        line("DPO (leveranciers)", s.dpoTotal, p.textMuted, 1.5, "dashed"),
      ],
    };
  }, [d, p, chartRange]);

  // YoY: zelfde kalendermaand dit jaar vs vorig jaar (uit de doorlopende reeks geknipt).
  const dsoYoY = useMemo<echarts.EChartsOption | null>(() => {
    if (!d) return null;
    const s = d.dso;
    const byYear = new Map<string, (number | null)[]>();
    s.months.forEach((m, i) => {
      const [y, mo] = m.split("-");
      const arr = byYear.get(y) || new Array(12).fill(null);
      arr[Number(mo) - 1] = s.dsoTotal[i];
      byYear.set(y, arr);
    });
    const years = [...byYear.keys()].sort().slice(-2);
    if (years.length < 2) return null;
    return {
      tooltip: { trigger: "axis", valueFormatter: (v) => (v == null ? "—" : `${v} dagen`) },
      legend: { data: years, textStyle: { color: p.text, fontSize: 10 }, top: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10, type: "scroll" },
      grid: { top: 32, left: 6, right: 8, bottom: 20, containLabel: true },
      xAxis: { type: "category", data: ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"], axisLabel: { color: p.text, fontSize: 9 }, axisLine: { lineStyle: { color: p.axis } }, axisTick: { show: false } },
      yAxis: { type: "value", name: "dagen", nameTextStyle: { color: p.textMuted, fontSize: 9 }, axisLabel: { color: p.textMuted }, splitLine: { lineStyle: { color: p.grid } } },
      series: years.map((y, i) => ({
        name: y, type: "line" as const, data: byYear.get(y)!,
        itemStyle: { color: i === years.length - 1 ? p.result : p.textMuted },
        lineStyle: { width: i === years.length - 1 ? 2.5 : 1.5, type: i === years.length - 1 ? "solid" as const : "dashed" as const },
        symbol: "circle", symbolSize: 4, connectNulls: true,
      })),
    };
  }, [d, p]);

  const speedHist = useMemo<echarts.EChartsOption | null>(() => {
    if (!d) return null;
    const COLORS = [p.positive, p.result, p.warning, p.categorical[5], p.negative, p.budget];
    return {
      tooltip: {
        trigger: "axis", axisPointer: { type: "shadow" },
        formatter: (prs: unknown) => {
          const pr = (prs as { name: string; value: number; dataIndex: number }[])[0];
          const b = d.speedBuckets[pr.dataIndex];
          return `${pr.name}<br/><b>${formatCurrency(pr.value)}</b> · ${b?.count ?? 0} facturen`;
        },
      },
      grid: { top: 24, left: 6, right: 8, bottom: 20, containLabel: true },
      xAxis: { type: "category", data: d.speedBuckets.map((b) => b.label), axisLabel: { color: p.text, fontSize: 9, interval: 0, rotate: 18 }, axisLine: { lineStyle: { color: p.axis } }, axisTick: { show: false } },
      yAxis: { type: "value", axisLabel: { color: p.textMuted, formatter: (v: number) => eurAxis(v) }, splitLine: { lineStyle: { color: p.grid } } },
      series: [{
        type: "bar", barMaxWidth: 44,
        data: d.speedBuckets.map((b, i) => ({ value: b.amount, itemStyle: { color: COLORS[i % COLORS.length], borderRadius: [3, 3, 0, 0] } })),
        label: { show: true, position: "top", color: p.text, fontSize: 9, formatter: (pl: LP) => eurAxis(Number(pl.value)) },
      }],
    };
  }, [d, p]);

  const weekFlow = useMemo<echarts.EChartsOption | null>(() => {
    if (!d) return null;
    return {
      tooltip: {
        trigger: "axis", axisPointer: { type: "shadow" },
        formatter: (prs: unknown) => {
          const arr = prs as { name: string; seriesName: string; value: number; dataIndex: number }[];
          const w = d.weekFlow[arr[0].dataIndex];
          const tot = (w?.factored || 0) + (w?.other || 0);
          return `week ${weekRange(w?.weekStart || "")}<br/>${arr.map((x) => `${x.seriesName}: <b>${formatCurrency(x.value)}</b>`).join("<br/>")}<br/>totaal ${formatCurrency(tot)} · ${w?.count ?? 0} facturen`;
        },
      },
      legend: { data: ["Naar factoring-klanten", "Overige externe klanten"], textStyle: { color: p.text, fontSize: 10 }, top: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10, type: "scroll" },
      grid: { top: 32, left: 6, right: 8, bottom: 20, containLabel: true },
      xAxis: { type: "category", data: d.weekFlow.map((w) => fmtDM(w.weekStart)), axisLabel: { color: p.text, fontSize: 8.5, interval: 2 }, axisLine: { lineStyle: { color: p.axis } }, axisTick: { show: false } },
      yAxis: { type: "value", axisLabel: { color: p.textMuted, formatter: (v: number) => eurAxis(v) }, splitLine: { lineStyle: { color: p.grid } } },
      series: [
        { name: "Naar factoring-klanten", type: "bar", stack: "w", data: d.weekFlow.map((w) => w.factored), itemStyle: { color: p.income }, barMaxWidth: 18 },
        { name: "Overige externe klanten", type: "bar", stack: "w", data: d.weekFlow.map((w) => w.other), itemStyle: { color: p.categorical[3], borderRadius: [3, 3, 0, 0] }, barMaxWidth: 18 },
      ],
    };
  }, [d, p]);

  const cashExp = useMemo<echarts.EChartsOption | null>(() => {
    if (!d) return null;
    return {
      tooltip: {
        trigger: "axis",
        formatter: (prs: unknown) => {
          const arr = prs as { seriesName: string; value: number; dataIndex: number; marker: string }[];
          const w = d.cashExpectation[arr[0]?.dataIndex ?? 0];
          return `${w?.label ?? ""} · ${weekRange(w?.weekStart || "")}<br/>${arr.map((x) => `${x.marker}${x.seriesName}: <b>${formatCurrency(Number(x.value))}</b>`).join("<br/>")}`;
        },
      },
      legend: { data: ["Verwacht (betaalgedrag)", "Op vervaldatum"], textStyle: { color: p.text, fontSize: 10 }, top: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10, type: "scroll" },
      grid: { top: 32, left: 6, right: 8, bottom: 20, containLabel: true },
      // Exacte datums op de as (maandag van de week) — geen ambigu weeknummer.
      xAxis: { type: "category", data: d.cashExpectation.map((w) => fmtDM(w.weekStart)), axisLabel: { color: p.text, fontSize: 9 }, axisLine: { lineStyle: { color: p.axis } }, axisTick: { show: false } },
      yAxis: { type: "value", axisLabel: { color: p.textMuted, formatter: (v: number) => eurAxis(v) }, splitLine: { lineStyle: { color: p.grid } } },
      series: [
        { name: "Verwacht (betaalgedrag)", type: "bar", data: d.cashExpectation.map((w) => w.expected), itemStyle: { color: p.income, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 22 },
        { name: "Op vervaldatum", type: "line", data: d.cashExpectation.map((w) => w.onDueDate), itemStyle: { color: p.textMuted }, lineStyle: { width: 1.5, type: "dashed" }, symbol: "none" },
      ],
    };
  }, [d, p]);

  const factoringCost = useMemo<echarts.EChartsOption | null>(() => {
    if (!d) return null;
    const months = d.factoringCost.months.slice(-12);
    const fee = (d.factoringCost.fee || d.factoringCost.amounts).slice(-12);
    const interest = (d.factoringCost.interest || months.map(() => 0)).slice(-12);
    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => formatCurrency(Number(v)) },
      legend: { data: ["Commissie (61)", "Rente/disconto (653)"], textStyle: { color: p.text, fontSize: 9 }, top: 0, icon: "roundRect", itemWidth: 8, itemHeight: 8 },
      grid: { top: 24, left: 6, right: 8, bottom: 20, containLabel: true },
      xAxis: { type: "category", data: months.map(fmtMonth), axisLabel: { color: p.text, fontSize: 9 }, axisLine: { lineStyle: { color: p.axis } }, axisTick: { show: false } },
      yAxis: { type: "value", axisLabel: { color: p.textMuted, formatter: (v: number) => eurAxis(v) }, splitLine: { lineStyle: { color: p.grid } } },
      series: [
        { name: "Commissie (61)", type: "bar", stack: "fc", data: fee, itemStyle: { color: p.expense }, barMaxWidth: 22 },
        { name: "Rente/disconto (653)", type: "bar", stack: "fc", data: interest, itemStyle: { color: p.warning, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 22 },
      ],
    };
  }, [d, p]);

  const vatChart = useMemo<echarts.EChartsOption | null>(() => {
    const v = vat.data; if (!v) return null;
    return {
      tooltip: {
        trigger: "axis", axisPointer: { type: "shadow" },
        formatter: (prs: unknown) => {
          const pr = (prs as { dataIndex: number }[])[0];
          const m = v.months[pr.dataIndex];
          if (!m) return "";
          return `${fmtMonth(m.month)}<br/>Verschuldigd op verkopen: <b>${formatCurrency(m.saleVat)}</b><br/>Aftrekbaar op aankopen: <b>${formatCurrency(m.purchVat)}</b><br/>Saldo: <b>${formatCurrency(m.net)}</b> ${m.net >= 0 ? "(te betalen)" : "(te vorderen)"}`;
        },
      },
      legend: { data: ["Saldo (te betalen / − te vorderen)"], textStyle: { color: p.text, fontSize: 10 }, top: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10, type: "scroll" },
      grid: { top: 32, left: 6, right: 8, bottom: 20, containLabel: true },
      xAxis: { type: "category", data: v.months.map((m) => fmtMonth(m.month)), axisLabel: { color: p.text, fontSize: 9 }, axisLine: { lineStyle: { color: p.axis } }, axisTick: { show: false } },
      yAxis: { type: "value", axisLabel: { color: p.textMuted, formatter: (vv: number) => eurAxis(vv) }, splitLine: { lineStyle: { color: p.grid } } },
      series: [{
        name: "Saldo (te betalen / − te vorderen)", type: "bar", barMaxWidth: 22,
        data: v.months.map((m) => ({ value: m.net, itemStyle: { color: m.net >= 0 ? p.expense : p.income, borderRadius: m.net >= 0 ? [3, 3, 0, 0] : [0, 0, 3, 3] } })),
        markLine: { silent: true, symbol: "none", lineStyle: { color: p.axis }, data: [{ yAxis: 0 }] },
      }],
    };
  }, [vat.data, p]);

  const bankChart = useMemo<echarts.EChartsOption | null>(() => {
    const b = bank.data; if (!b) return null;
    const brands = Object.keys(b.byBrand).filter((br) => b.byBrand[br].inflow.some((x) => x) || b.byBrand[br].outflow.some((x) => x));
    return {
      tooltip: {
        trigger: "axis", axisPointer: { type: "shadow" },
        // In- en uit-reeksen dragen dezelfde naam (één legend-item per bank) — de
        // standaard-tooltip zou elke bank dus dubbel tonen; groepeer per bank.
        formatter: (prs: unknown) => {
          const arr = prs as { dataIndex: number }[];
          const mi = arr[0]?.dataIndex ?? 0;
          const lines = brands
            .map((br) => ({ br, inV: b.byBrand[br].inflow[mi] || 0, outV: b.byBrand[br].outflow[mi] || 0 }))
            .filter((x) => x.inV || x.outV)
            .map((x) => `${x.br}: in <b>${formatCurrency(x.inV)}</b> · uit ${formatCurrency(x.outV)}`);
          return `${fmtMonth(b.months[mi])}<br/>${lines.join("<br/>")}`;
        },
      },
      legend: { data: brands, textStyle: { color: p.text, fontSize: 10 }, top: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10, type: "scroll" },
      grid: { top: 32, left: 6, right: 8, bottom: 20, containLabel: true },
      xAxis: { type: "category", data: b.months.map(fmtMonth), axisLabel: { color: p.text, fontSize: 9 }, axisLine: { lineStyle: { color: p.axis } }, axisTick: { show: false } },
      yAxis: { type: "value", axisLabel: { color: p.textMuted, formatter: (v: number) => eurAxis(v) }, splitLine: { lineStyle: { color: p.grid } } },
      series: brands.flatMap((br, i) => ([
        { name: br, type: "bar" as const, stack: "in", data: b.byBrand[br].inflow, itemStyle: { color: p.categorical[i % p.categorical.length] }, barMaxWidth: 16 },
        { name: br, type: "bar" as const, stack: "uit", data: b.byBrand[br].outflow.map((x) => -x), itemStyle: { color: p.categorical[i % p.categorical.length], opacity: 0.55 }, barMaxWidth: 16, tooltip: { valueFormatter: (v: unknown) => formatCurrency(Math.abs(Number(v))) } },
      ])),
    };
  }, [bank.data, p]);

  // Sales-beltool: openstaand geld per ouderdomsblok. Kleur loopt van groen (binnen de
  // norm) naar rood (>90d); klik een balk en de klantenlijst eronder volgt.
  const ageChart = useMemo<echarts.EChartsOption | null>(() => {
    const ag = d?.behaviour?.ageing; if (!ag?.length) return null;
    const COLORS = [p.positive, p.result, p.warning, p.categorical[5], p.negative, p.textMuted];
    return {
      tooltip: {
        trigger: "axis", axisPointer: { type: "shadow" },
        formatter: (prs: unknown) => {
          const i = (prs as { dataIndex: number }[])[0]?.dataIndex ?? 0;
          const b = ag[i];
          return `<b>${b.label}</b><br/>Openstaand: <b>${formatCurrency(b.amount)}</b><br/>${b.invoiceCount} facturen bij ${b.customerCount} klanten<br/><i style="opacity:.65">klik voor de bellijst</i>`;
        },
      },
      grid: { top: 16, left: 6, right: 8, bottom: 22, containLabel: true },
      xAxis: {
        type: "category", data: ag.map((b) => b.label.replace(" dagen", "d").replace(" (binnen de norm)", "")),
        axisLabel: { color: p.text, fontSize: 10 }, axisLine: { lineStyle: { color: p.axis } }, axisTick: { show: false },
        name: "ouderdom van de factuur", nameLocation: "middle", nameGap: 26, nameTextStyle: { color: p.textMuted, fontSize: 9 },
      },
      yAxis: { type: "value", name: "openstaand (€)", nameTextStyle: { color: p.textMuted, fontSize: 9 }, axisLabel: { color: p.textMuted, formatter: (v: number) => eurAxis(v) }, splitLine: { lineStyle: { color: p.grid } } },
      series: [{
        type: "bar", barMaxWidth: 64,
        data: ag.map((b, i) => ({ value: b.amount, itemStyle: { color: COLORS[i % COLORS.length], borderRadius: [4, 4, 0, 0], opacity: i === ageBucket ? 1 : 0.55 } })),
        label: { show: true, position: "top", color: p.text, fontSize: 10, fontWeight: "bold", formatter: (pl: LP) => eurAxis(Number(pl.value)) },
      }],
    };
  }, [d, p, ageBucket]);

  // Openstaand naast vrij-te-maken cash per ouderdomsblok. Het verschil tussen de
  // twee balken is precies wat de bank bij factoring al voorgeschoten heeft — zo
  // ziet sales in één blik waar bellen écht cash oplevert.
  const unlockChart = useMemo<echarts.EChartsOption | null>(() => {
    const c = d?.behaviour?.cashPotential; if (!c?.perBucket?.length) return null;
    return {
      tooltip: {
        trigger: "axis", axisPointer: { type: "shadow" },
        formatter: (prs: unknown) => {
          const i = (prs as { dataIndex: number }[])[0]?.dataIndex ?? 0;
          const b = c.perBucket[i];
          const held = b.open - b.unlock;
          return `<b>${b.label}</b><br/>Openstaand: <b>${formatCurrency(b.open)}</b><br/>`
            + `Komt vrij bij ${c.normDays} d: <b>${formatCurrency(b.unlock)}</b><br/>`
            + `<span style="opacity:.7">reeds voorgeschoten of binnen de norm: ${formatCurrency(held)}</span>`;
        },
      },
      legend: { data: ["Openstaand", `Vrij bij ${c.normDays} dagen`], textStyle: { color: p.text, fontSize: 10 }, top: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10 },
      grid: { top: 28, left: 6, right: 8, bottom: 22, containLabel: true },
      xAxis: {
        type: "category", data: c.perBucket.map((b) => b.label.replace(" dagen", "d").replace(" (binnen de norm)", "").replace(" (dossier)", "")),
        axisLabel: { color: p.text, fontSize: 9 }, axisLine: { lineStyle: { color: p.axis } }, axisTick: { show: false },
        name: "ouderdom van de factuur", nameLocation: "middle", nameGap: 24, nameTextStyle: { color: p.textMuted, fontSize: 9 },
      },
      yAxis: { type: "value", name: "€ incl. btw", nameTextStyle: { color: p.textMuted, fontSize: 9 }, axisLabel: { color: p.textMuted, formatter: (v: number) => eurAxis(v) }, splitLine: { lineStyle: { color: p.grid } } },
      series: [
        { name: "Openstaand", type: "bar", barMaxWidth: 26, itemStyle: { color: p.textMuted, opacity: 0.45, borderRadius: [3, 3, 0, 0] }, data: c.perBucket.map((b) => b.open) },
        {
          name: `Vrij bij ${c.normDays} dagen`, type: "bar", barMaxWidth: 26,
          itemStyle: { color: p.positive, borderRadius: [3, 3, 0, 0] }, data: c.perBucket.map((b) => b.unlock),
          label: { show: true, position: "top", color: p.text, fontSize: 9, formatter: (pl: LP) => (Number(pl.value) > 0 ? eurAxis(Number(pl.value)) : "") },
        },
      ],
    };
  }, [d, p]);

  // ---------- laad-/fouttoestanden ----------
  if (!d) {
    return (
      <div className="mx-auto mt-20 max-w-md rounded-2xl border border-border bg-card p-8 text-center">
        {rcv.error ? (
          <>
            <AlertTriangle className="mx-auto h-7 w-7 text-warning" />
            <h1 className="mt-3 text-base font-semibold text-foreground">Kon de data niet laden</h1>
            <p className="mt-1 text-xs text-muted-foreground">{rcv.error}</p>
            <button onClick={() => rcv.reload(false)} className="mt-4 rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground">Opnieuw proberen</button>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto h-7 w-7 animate-spin text-primary" />
            <h1 className="mt-3 text-base font-semibold text-foreground">
              {rcv.building ? "Klantposten worden opgehaald uit Business Central…" : "Laden…"}
            </h1>
            {rcv.building && (
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                Eerste opbouw van de dag: alle klantposten, betalings-toewijzingen en leveranciersposten
                van 11 vennootschappen (2–6 min). De pagina ververst zichzelf zodra de data klaar is.
              </p>
            )}
          </>
        )}
      </div>
    );
  }

  const overduePct = d.openInvoices.total ? Math.round((d.openInvoices.overdue / d.openInvoices.total) * 100) : 0;

  // Welke maand rekenen de kerncijfers? Standaard de laatste RIJPE maand (dsoNow), maar
  // de CFO kan elke maand kiezen — dan volgen alle DSO-/CRF-tegels mee. Zo is meteen
  // duidelijk dat "56 dagen" één maand is en niet een periode van 12 maanden.
  const defaultMi = Math.max(0, d.dso.months.indexOf(d.dsoNow.asOfMonth));
  const mi = kpiMonth != null && kpiMonth >= 0 && kpiMonth < d.dso.months.length ? kpiMonth : defaultMi;
  const selMonth = d.dso.months[mi];
  const dsoSel = {
    total: d.dso.dsoTotal[mi], extFactoring: d.dso.dsoExtFactoring[mi],
    extOther: d.dso.dsoExtOther[mi], countback: d.dso.dsoCountback?.[mi] ?? null, dpo: d.dso.dpoTotal[mi],
  };
  const crfSel = {
    cei: d.crfKpis.ceiSeries?.[mi] ?? (mi === defaultMi ? d.crfKpis.cei : null),
    bpdso: d.crfKpis.bpdsoSeries?.[mi] ?? (mi === defaultMi ? d.crfKpis.bpdso : null),
    add: d.crfKpis.addSeries?.[mi] ?? (mi === defaultMi ? d.crfKpis.add : null),
  };
  // Leesbare uitleg van wat die maand precies betekent (Laura's vraag: "is 56 dagen
  // tussen 04/08/2025 en 04/08/2026?" — nee, het is één maand).
  const monthEnd = (() => {
    const [y, m] = selMonth.split("-").map(Number);
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  })();
  const monthWindowLabel = `${fmtMonth(selMonth)}: openstaand op ${fmtDate(monthEnd)} ÷ omzet van die maand × ${monthEnd.slice(8, 10)} dagen`;
  const arExtSel = d.dso.arEndByCat.extFactoring[mi] + d.dso.arEndByCat.extOther[mi];
  const salesExtSel = d.dso.salesByCat.extFactoring[mi] + d.dso.salesByCat.extOther[mi];
  // ---- PERIODES: elk cijfer draagt zichtbaar zijn eigen periode, met exacte datums.
  // "Ze moeten nooit moeten twijfelen over welke periode een cijfer gaat."
  const mStart = (m: string) => `01/${m.slice(5, 7)}/${m.slice(0, 4)}`;
  const mEnd = (m: string) => {
    const [y, mo] = m.split("-").map(Number);
    return `${new Date(Date.UTC(y, mo, 0)).getUTCDate()}/${m.slice(5, 7)}/${m.slice(0, 4)}`;
  };
  const vandaag = fmtDate(new Date().toISOString().slice(0, 10));
  const months = d.dso.months;
  const perVenster = `${mStart(months[0])} t/m ${mEnd(months[months.length - 1])}`;
  const per12m = `${mStart(months[Math.max(0, months.length - 12)])} t/m ${mEnd(months[months.length - 1])}`;
  const perNu = `momentopname ${vandaag}`;
  const perMaand = `${mStart(selMonth)} t/m ${mEnd(selMonth)}`;
  // Laatste btw-aangifteperiode waarvoor er effectief posten zijn — zo staat er nooit
  // een einddatum in het label van een maand die nog niet aangegeven is.
  // Vennootschappen in scope — voor de vindplaats-links in de maand-drill. We leiden
  // ze af uit data die al op de pagina staat (verificatie → units → klantposten),
  // zodat er geen tweede lijst is die uit sync kan lopen met de scope-selectie.
  const companiesInScope: string[] = (
    agingChk.data?.rows.map((r) => r.company)
    ?? unitsData.data?.perCompany.map((c) => c.code)
    ?? Array.from(new Set(d.customers.flatMap((c) => c.companies)))
  ).slice().sort();
  const cp = d.behaviour?.cashPotential;
  const vatMonths = vat.data?.months ?? [];
  const vatLastMonth =
    [...vatMonths].reverse().find((m) => m.saleVat !== 0 || m.purchVat !== 0)?.month
    ?? vatMonths[vatMonths.length - 1]?.month ?? selMonth;
  // Bouwt een bronpaneel dat altijd dezelfde vier vragen beantwoordt:
  // welke periode · wat staat er precies · hoe rekenen we het · waar in BC/Excel.
  const src = (
    label: string, value: string, periode: string, watStaatEr: string, hoeKomenWeEraan: string,
    delen?: { naam: string; waarde: string }[], excel?: string, caveat?: string,
  ): KpiSource => ({
    label: `${label} — ${periode}`,
    value,
    formule: { tekst: watStaatEr, delen: [{ naam: "PERIODE", waarde: periode }, ...(delen ?? [])] },
    bron: hoeKomenWeEraan,
    excel, caveat,
  });
  const nf = dsoSel.extOther != null && dsoSel.extFactoring != null ? dsoSel.extOther - dsoSel.extFactoring : null;

  return (
    <div className="space-y-4">
      {/* ---- hero ---- */}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <a href="/cfo" className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground ring-1 ring-border hover:text-foreground"><ArrowLeft className="h-3 w-3" />CFO-cockpit</a>
              <a href="/cfo/units" className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground ring-1 ring-border hover:text-foreground">Business Units →</a>
              <h1 className="text-lg font-bold text-foreground">Klanten & Cash</h1>
              {!d.isLive && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold uppercase text-warning">demo</span>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Hoe snel betalen klanten écht, wat loopt via factoring en wat betekent dat voor cash — {d.periodNote}.
            </p>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span title="Moment van de datapull uit Business Central">Data per <b className="text-foreground">{fmtStamp(d.asOf)}</b></span>
            {d.refreshing && <span className="inline-flex items-center gap-1 text-primary"><Loader2 className="h-3 w-3 animate-spin" />vernieuwt…</span>}
            <button onClick={() => rcv.reload(true)} title="Verse pull uit BC (achtergrond)" className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 font-semibold ring-1 ring-border hover:text-foreground">
              <RefreshCcw className="h-3 w-3" />Vernieuwen
            </button>
            <a
              href={`/api/cfo/export/klantencash${qs}`}
              title="Alle data achter deze pagina als Excel: DSO per maand, betaalgedrag per klant, open posten met BC-links, factoring, facturatie per week en een methodiek-blad"
              className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 font-semibold text-primary-foreground ring-1 ring-primary/40 transition hover:opacity-90"
            >
              <FileSpreadsheet className="h-3 w-3" />Excel met de brondata
            </a>
            <a href={`/api/cfo/ai-export${qs}`} title="Volledige CFO-dataset + methodiek als JSON — voor AI-analyse" className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 font-semibold ring-1 ring-border hover:text-foreground">
              <Receipt className="h-3 w-3" />Export voor AI
            </a>
          </div>
        </div>
      </div>

      {/* ---- maandkeuze voor de KPI-rij ---- */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-primary/30 bg-primary/5 px-3 py-2">
        <CalendarClock className="h-4 w-4 shrink-0 text-primary" />
        <span className="text-[11px] font-semibold text-foreground">Kerncijfers rekenen op de maand</span>
        <select
          value={mi}
          onChange={(e) => setKpiMonth(Number(e.target.value))}
          className="rounded-lg border border-primary/40 bg-card px-2 py-1 text-xs font-bold text-primary"
          aria-label="Maand voor de kerncijfers"
        >
          {d.dso.months.map((m, i) => (
            <option key={m} value={i} disabled={d.dso.dsoTotal[i] == null}>
              {fmtMonth(m)}{d.dso.dsoTotal[i] == null ? " — nog niet volledig geboekt" : ""}{i === defaultMi ? " (standaard)" : ""}
            </option>
          ))}
        </select>
        <span className="text-[11px] text-muted-foreground">
          = <b className="text-foreground">{monthWindowLabel}</b>. Elke tegel hieronder verandert mee; de tabellen en de facturatie-per-week-grafiek zijn rollend (12 resp. 26 perioden) en volgen deze keuze niet.
        </span>
        {mi !== defaultMi && (
          <button onClick={() => setKpiMonth(null)} className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground ring-1 ring-border hover:text-foreground">terug naar standaard</button>
        )}
      </div>

      {/* ---- KPI-rij — elke tegel is klikbaar en toont zijn eigen bron ---- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        <Kpi
          label="DSO extern" value={dsoSel.total != null ? `${dsoSel.total}d` : "—"}
          sub={`${monthWindowLabel} · countback ${dsoSel.countback != null ? `${dsoSel.countback}d` : "—"}`}
          onClick={() => setKpiSrc({
            label: `DSO extern — ${fmtMonth(selMonth)}`, value: dsoSel.total != null ? `${dsoSel.total} dagen` : "—",
            formule: {
              tekst: "openstaand op maandeinde ÷ gefactureerd die maand × dagen in de maand",
              delen: [
                { naam: `Openstaand extern op ${fmtDate(monthEnd)} (incl. btw)`, waarde: formatCurrency(arExtSel) },
                { naam: `Gefactureerd extern in ${fmtMonth(selMonth)} (incl. btw)`, waarde: formatCurrency(salesExtSel) },
                { naam: "Dagen in de maand", waarde: monthEnd.slice(8, 10) },
                { naam: "= DSO", waarde: dsoSel.total != null ? `${dsoSel.total} dagen` : "—" },
                { naam: "Countback-methode (controle)", waarde: dsoSel.countback != null ? `${dsoSel.countback} dagen` : "—" },
              ],
            },
            bron: "Klantposten uit BC (ODataV4 Cust_LedgerEntries), volledige historie van alle vennootschappen. Het openstaand saldo is de som van álle klantposten t/m die datum (facturen +, betalingen en creditnota's −); de noemer zijn de verkoopfacturen met documentdatum in die maand. Intercompany is uitgesloten (naam + IC-partnercode).",
            excel: "DSO per maand",
            caveat: "Teller én noemer zijn incl. btw — de dagratio is daardoor btw-neutraal, maar vergelijk het bedrag niet met de omzet in de P&L (die is excl. btw). Eenmalige, niet-operationele verkopen zijn uit de noemer gehouden.",
          })}
        />
        <Kpi
          label="DSO via factoring" value={dsoSel.extFactoring != null ? `${dsoSel.extFactoring}d` : "—"}
          sub={`time-to-cash factor · ${fmtMonth(selMonth)}`} tone="pos"
          onClick={() => setKpiSrc({
            label: `DSO via factoring — ${fmtMonth(selMonth)}`, value: dsoSel.extFactoring != null ? `${dsoSel.extFactoring} dagen` : "—",
            formule: {
              tekst: "zelfde formule, maar alleen klanten die via een factor afwikkelen",
              delen: [
                { naam: `Openstaand bij factoring-klanten op ${fmtDate(monthEnd)}`, waarde: formatCurrency(d.dso.arEndByCat.extFactoring[mi]) },
                { naam: `Gefactureerd aan die klanten in ${fmtMonth(selMonth)}`, waarde: formatCurrency(d.dso.salesByCat.extFactoring[mi]) },
                { naam: "= DSO via factoring", waarde: dsoSel.extFactoring != null ? `${dsoSel.extFactoring} dagen` : "—" },
              ],
            },
            bron: `Een klant geldt als factoring-klant zodra ≥40% van zijn betaald volume via een factor-dagboek liep. Die dagboeken zijn per vennootschap herkend: ${d.factors.map((f) => `${f.label} (${f.companies.join("/")})`).join(", ")}. De betaaldatum komt uit Gedetailleerde_klantenposten_Excel (Application-posten) — dat is de dag dat het geld binnenkwam.`,
            excel: "DSO per maand + Factoring",
            caveat: "Dit is time-to-cash: hoe snel de factuur geld wordt. Het zegt niets over wanneer de eindklant aan de factor betaalt — daarvoor zijn de maandrapporten van de factor nodig (openstaande vraag aan finance).",
          })}
        />
        <Kpi
          label="DSO niet-factoring" value={dsoSel.extOther != null ? `${dsoSel.extOther}d` : "—"}
          sub={nf != null ? `${nf > 0 ? "+" : ""}${nf}d vs factoring · echt klantgedrag` : `echt klantgedrag · ${fmtMonth(selMonth)}`}
          tone={nf != null && nf > 10 ? "warn" : "neutral"}
          onClick={() => setKpiSrc({
            label: `DSO niet-factoring — ${fmtMonth(selMonth)}`, value: dsoSel.extOther != null ? `${dsoSel.extOther} dagen` : "—",
            formule: {
              tekst: "zelfde formule, alleen klanten die rechtstreeks aan ons betalen",
              delen: [
                { naam: `Openstaand bij deze klanten op ${fmtDate(monthEnd)}`, waarde: formatCurrency(d.dso.arEndByCat.extOther[mi]) },
                { naam: `Gefactureerd aan deze klanten in ${fmtMonth(selMonth)}`, waarde: formatCurrency(d.dso.salesByCat.extOther[mi]) },
                { naam: "= DSO niet-factoring", waarde: dsoSel.extOther != null ? `${dsoSel.extOther} dagen` : "—" },
                { naam: "Verschil met de factoring-lijn", waarde: nf != null ? `${nf > 0 ? "+" : ""}${nf} dagen` : "—" },
              ],
            },
            bron: "Zelfde klantposten, maar de klanten waarvan minder dan 40% van het betaald volume via een factor liep. Dit is dus het zuiverste beeld van échte betaaldiscipline.",
            excel: "DSO per maand + Klantbetaalgedrag (kolom 'Dagen vs vervaldag' per klant)",
            caveat: "Belgische context: de wettelijke maximumtermijn B2B is 60 dagen (wet 2022) en de gemiddelde werkelijke betaaltermijn is ±61 dagen. Alles boven de 100 dagen is dus ver buiten de norm en geeft recht op verwijlinterest + €40 forfait.",
          })}
        />
        <Kpi
          label="DPO" value={dsoSel.dpo != null ? `${dsoSel.dpo}d` : "—"} sub={`leveranciers extern · ${fmtMonth(selMonth)}`}
          onClick={() => setKpiSrc({
            label: `DPO — ${fmtMonth(selMonth)}`, value: dsoSel.dpo != null ? `${dsoSel.dpo} dagen` : "—",
            formule: {
              tekst: "openstaand bij leveranciers op maandeinde ÷ inkoopfacturen die maand × dagen",
              delen: [{ naam: "= DPO", waarde: dsoSel.dpo != null ? `${dsoSel.dpo} dagen` : "—" }],
            },
            bron: "Leveranciersposten uit BC (ODataV4 VendorLedgerEntries), extern (intercompany uitgesloten). Alleen documenttype 'Factuur' in de noemer.",
            excel: "DSO per maand (kolom DPO extern)",
            caveat: "De noemer is bruto: leverancierscreditnota's verlagen wél het openstaand saldo maar niet de inkoop, waardoor de DPO iets te laag kan uitkomen. DPO op factuurniveau kan pas als BC de webservice 'Detailed Vendor Ledger Entries' publiceert (openstaand punt bij de BC-beheerder).",
          })}
        />
        <Kpi
          label="Mediane betaaltijd" value={d.dsoInvoiceLevel.medianDays != null ? `${d.dsoInvoiceLevel.medianDays}d` : "—"}
          sub={`factuur → geld · betaalde facturen sinds ${fmtMonth(d.dso.months[0])}`}
          onClick={() => setKpiSrc({
            label: "Mediane betaaltijd (factuurniveau)", value: d.dsoInvoiceLevel.medianDays != null ? `${d.dsoInvoiceLevel.medianDays} dagen` : "—",
            formule: {
              tekst: "per factuur: dagen tussen factuurdatum en de laatste betaling, bedrag-gewogen",
              delen: [
                { naam: "Mediaan", waarde: d.dsoInvoiceLevel.medianDays != null ? `${d.dsoInvoiceLevel.medianDays} dagen` : "—" },
                { naam: "Gemiddelde (bedrag-gewogen)", waarde: d.dsoInvoiceLevel.avgDays != null ? `${d.dsoInvoiceLevel.avgDays} dagen` : "—" },
                { naam: "Op tijd betaald (vs vervaldag)", waarde: d.dsoInvoiceLevel.onTimePct != null ? `${d.dsoInvoiceLevel.onTimePct}%` : "—" },
              ],
            },
            bron: "De échte betaaldatum per factuur komt uit Gedetailleerde_klantenposten_Excel (Entry_Type = 'Application'): de boekingsdatum van de toewijzing betaling ↔ factuur. Alleen externe facturen die volledig betaald zijn.",
            excel: "Klantbetaalgedrag (kolom 'Dagen tot betaling (gew.)' per klant)",
            caveat: d.dsoInvoiceLevel.note,
          })}
        />
        <Kpi
          label="Op tijd betaald" value={d.dsoInvoiceLevel.onTimePct != null ? `${d.dsoInvoiceLevel.onTimePct}%` : "—"}
          sub={`van betaald volume vs vervaldag · sinds ${fmtMonth(d.dso.months[0])}`}
          tone={d.dsoInvoiceLevel.onTimePct != null && d.dsoInvoiceLevel.onTimePct < 50 ? "warn" : "pos"}
          onClick={() => setKpiSrc({
            label: "Op tijd betaald", value: d.dsoInvoiceLevel.onTimePct != null ? `${d.dsoInvoiceLevel.onTimePct}%` : "—",
            formule: {
              tekst: "aandeel van het betaalde factuurbedrag dat op of vóór de vervaldag binnenkwam",
              delen: d.speedBuckets.map((b) => ({ naam: b.label, waarde: `${formatCurrency(b.amount)} · ${b.count} facturen` })),
            },
            bron: "Zelfde betaaldata als de mediane betaaltijd, vergeleken met de vervaldatum op de klantpost. Bedrag-gewogen, niet per stuk — één grote late factuur weegt dus zwaarder dan tien kleine tijdige.",
            excel: "Klantbetaalgedrag",
          })}
        />
        <Kpi
          label="Open klanten (extern)" value={formatCurrencyCompact(d.openInvoices.total)}
          sub={`stand vandaag · ${overduePct}% vervallen · incl. btw · IC apart ${formatCurrencyCompact(d.openInvoices.ic ?? 0)}`}
          tone={overduePct > 40 ? "neg" : "neutral"}
          onClick={() => setKpiSrc({
            label: "Open klanten (extern)", value: formatCurrency(d.openInvoices.total),
            formule: {
              tekst: "som van de openstaande bedragen van alle externe klantfacturen, stand vandaag",
              delen: [
                { naam: "Open externe facturen (bruto)", waarde: formatCurrency(d.openInvoices.total) },
                { naam: "Waarvan vervallen", waarde: `${formatCurrency(d.openInvoices.overdue)} (${overduePct}%)` },
                { naam: "Intercompany (apart gehouden)", waarde: formatCurrency(d.openInvoices.ic ?? 0) },
                { naam: "Grootboek-nettosaldo incl. IC", waarde: formatCurrency(d.openInvoices.netLedger ?? 0) },
              ],
            },
            bron: "Open klantposten (Cust_LedgerEntries met Open = true), per factuur. Dit is een BRUTO-cijfer: open creditnota's en betalingen zonder toewijzing netten er niet in — het grootboek-nettosaldo hierboven doet dat wél, en dát cijfer sluit exact aan op GL-rekening 400000/400001 (verificatiepaneel onderaan de pagina).",
            excel: "Open posten — met een doorkliklink naar elke boeking in Business Central",
          })}
        />
        <Kpi
          label={`Factoringkost ${d.factoringCost.ytdThrough ? `YTD t/m ${fmtMonth(d.factoringCost.ytdThrough)}` : "12m"}`}
          value={formatCurrencyCompact(d.factoringCost.totalYtd ?? d.factoringCost.total12m)}
          sub={`commissie ${formatCurrencyCompact(d.factoringCost.feeYtd ?? 0)} (613340) + rente ${formatCurrencyCompact(d.factoringCost.interestYtd ?? 0)} (650000) · 12m ${formatCurrencyCompact(d.factoringCost.total12m)}`}
          onClick={() => setKpiSrc({
            label: `Factoringkost YTD t/m ${fmtMonth(d.factoringCost.ytdThrough || selMonth)}`,
            value: formatCurrency(d.factoringCost.totalYtd ?? d.factoringCost.total12m),
            formule: {
              tekst: "factorcommissie + factoringrente, alle vennootschappen, excl. btw",
              delen: [
                { naam: "Commissie — GL 613340 (klasse 61)", waarde: formatCurrency(d.factoringCost.feeYtd ?? 0) },
                { naam: "Rente — GL 650000, enkel factorposten (klasse 65)", waarde: formatCurrency(d.factoringCost.interestYtd ?? 0) },
                { naam: "= Totaal YTD", waarde: formatCurrency(d.factoringCost.totalYtd ?? 0) },
                { naam: "12 maanden rollend", waarde: formatCurrency(d.factoringCost.total12m) },
              ],
            },
            bron: "Grootboekposten (Grootboekposten_Excel) op rekening 613340 en 650000. Op 650000 staat óók gewone financieringsrente (bv. €123k straight-loan-rente bij GPR), dus we nemen daar enkel de posten waarvan de tegenpartij of omschrijving de factormaatschappij aanwijst: BNP Paribas Fortis Factor bij GTR (inclusief de reclass op contract 0003946), Belfius Commercial Finance bij GDI en KBC Comm.Fin.Factoring bij WHS.",
            excel: "Factoring — met de maandreeks commissie/rente apart",
            caveat: "Conform CBN-advies 2011/23 hoort de commissie in klasse 61 en de rente/disconto in klasse 65; bij Gheeraert staat die rente op 650000 en niet op de door de CBN genoemde rekening 653. Laat de accountant bevestigen dat er op 650000 geen andere factoringkosten staan die wij nu missen.",
          })}
        />
      </div>

      {/* ---- SALES-BELTOOL ---- */}
      {d.behaviour?.ageing?.length ? (
        <Card
          title="Bellijst — welk geld zweeft er hoe lang, en bij wie"
          period={perNu}
          hint={`Openstaand extern per ouderdomsblok (dagen sinds factuurdatum), momentopname ${vandaag}. Totaal ${formatCurrency(d.behaviour.ageingTotal)} · incl. btw · norm ${d.behaviour.norm} dagen.`}
          onSource={() => setKpiSrc(src(
            "Bellijst — openstaand per ouderdomsblok", formatCurrency(d.behaviour!.ageingTotal), perNu,
            "Dit is GEEN periodecijfer maar een momentopname: alle externe klantfacturen die op dit moment nog open staan, gesorteerd op hoe oud ze zijn.",
            "Cust_LedgerEntries (ODataV4) met Open = true en Document_Type = Invoice, alle 11 vennootschappen. Ouderdom = aantal dagen tussen de factuurdatum en vandaag. Bedragen zijn Remaining_Amt_LCY, dus inclusief btw — dit is wat de klant nog moet overschrijven. Intercompany-klanten zijn uitgesloten. Telefoon en e-mail komen van de klantenkaart (Customer). De twee iconen achteraan de rij openen respectievelijk álle posten van die klant en zijn klantenkaart in Business Central.",
            [
              { naam: "Totaal openstaand extern (incl. btw)", waarde: formatCurrency(d.behaviour!.ageingTotal) },
              ...d.behaviour!.ageing.map((b) => ({ naam: b.label, waarde: `${formatCurrency(b.amount)} · ${b.customerCount} klanten` })),
            ],
            "Open posten",
            `De blokken meten dagen sinds FACTUURDATUM, niet sinds vervaldag. Een klant met 60 dagen betaaltermijn zit dus terecht in het blok 45–60 zonder te laat te zijn; de kolom "waarvan vervallen" toont wél het deel dat de vervaldag voorbij is.`,
          ))}
          right={
            <a
              href={`/api/cfo/export/klantencash${qs}`}
              className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[10px] font-semibold text-primary-foreground hover:opacity-90"
              title="Alle open posten met BC-doorkliklinks als Excel"
            >
              <FileSpreadsheet className="h-3 w-3" />Excel
            </a>
          }
        >
          <div className="grid gap-4 lg:grid-cols-5">
            <div className="lg:col-span-2">
              {ageChart && (
                <EChart
                  option={ageChart} height={260}
                  onSelect={(pt) => { if (typeof pt.dataIndex === "number") setAgeBucket(pt.dataIndex); }}
                  ariaLabel="Openstaand geld per ouderdomsblok"
                />
              )}
              <div className="mt-2 grid grid-cols-3 gap-1 sm:grid-cols-6">
                {d.behaviour.ageing.map((b, i) => (
                  <button
                    key={b.label}
                    onClick={() => setAgeBucket(i)}
                    className={`rounded-lg px-1 py-1 text-[9px] font-semibold leading-tight transition ${i === ageBucket ? "bg-primary/15 text-primary ring-1 ring-primary/40" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                  >
                    {b.label.replace(" dagen", "d").replace(" (binnen de norm)", "")}
                    <br />
                    <span className="font-normal">{b.customerCount} klanten</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="lg:col-span-3">
              <p className="mb-1.5 text-[11px] font-semibold text-foreground">
                {d.behaviour.ageing[ageBucket]?.label} — {formatCurrency(d.behaviour.ageing[ageBucket]?.amount || 0)} bij {d.behaviour.ageing[ageBucket]?.customerCount || 0} klanten
                <span className="ml-1 font-normal text-muted-foreground">(grootste eerst — dit is de belvolgorde)</span>
              </p>
              <div className="max-h-[300px] overflow-y-auto overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-xs">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-2 py-1 text-left">Klant</th>
                      <th className="px-2 py-1 text-right">Openstaand</th>
                      <th className="px-2 py-1 text-right">Waarvan vervallen</th>
                      <th className="px-2 py-1 text-right">Fact.</th>
                      <th className="px-2 py-1 text-right">Oudste</th>
                      <th className="px-2 py-1 text-left">Telefoon</th>
                      <th className="px-2 py-1 text-left">E-mail</th>
                      <th className="px-2 py-1 text-center" title="Alle posten van deze klant / zijn klantenkaart in Business Central">In BC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(d.behaviour.ageing[ageBucket]?.customers || []).map((c) => (
                      <tr key={c.name} className="border-b border-border/40">
                        <td className="max-w-[210px] truncate px-2 py-1 font-medium text-foreground" title={`${c.name} · ${c.companies.join(", ")}`}>
                          {c.name}
                          {c.factored && <span className="ml-1 rounded bg-primary/15 px-1 text-[9px] font-semibold text-primary">factor</span>}
                        </td>
                        <td className="px-2 py-1 text-right font-semibold tabular-nums">{formatCurrency(c.amount)}</td>
                        <td className={`px-2 py-1 text-right tabular-nums ${c.overdue > 0 ? "text-negative" : "text-muted-foreground"}`}>{c.overdue ? formatCurrency(c.overdue) : "—"}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{c.invoices}</td>
                        <td className="px-2 py-1 text-right font-semibold tabular-nums">{c.maxDays}d</td>
                        <td className="px-2 py-1">{c.phone ? <a href={`tel:${c.phone.replace(/\s/g, "")}`} className="text-primary hover:underline">{c.phone}</a> : <span className="text-muted-foreground">—</span>}</td>
                        <td className="max-w-[170px] truncate px-2 py-1">{c.email ? <a href={`mailto:${c.email}`} className="text-primary hover:underline">{c.email}</a> : <span className="text-muted-foreground">—</span>}</td>
                        <td className="whitespace-nowrap px-2 py-1 text-center">
                          {c.ledgerUrl ? (
                            <>
                              <a href={c.ledgerUrl} target="_blank" rel="noreferrer" title={`Alle openstaande en afgesloten posten van ${c.name} in BC (${c.company})`} className="mr-1.5 inline-flex text-primary hover:opacity-80">
                                <Receipt className="h-3.5 w-3.5" />
                              </a>
                              <a href={c.cardUrl} target="_blank" rel="noreferrer" title="Klantenkaart: betaalcondities, kredietlimiet, contactgegevens" className="inline-flex text-primary hover:opacity-80">
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            </>
                          ) : <span className="text-[10px] text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(d.behaviour.ageing[ageBucket]?.customerCount || 0) > (d.behaviour.ageing[ageBucket]?.customers.length || 0) && (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {d.behaviour.ageing[ageBucket].customers.length} grootste van {d.behaviour.ageing[ageBucket].customerCount} klanten getoond — de volledige lijst staat in de Excel.
                </p>
              )}
            </div>
          </div>
        </Card>
      ) : null}

      {/* ---- CASHPOTENTIEEL & TARGET (vraag Peter/Laura 05/08/2026) ---- */}
      {cp && (
        <Card
          title="Cashpotentieel — wat komt vrij als iedereen op 30 dagen betaalt"
          period={perNu}
          hint={`Momentopname ${vandaag}. Van het openstaande bedrag heeft de bank bij factoring-klanten al ${cp.advancePct}% voorgeschoten (aanname), dus daar levert sneller innen enkel de ${100 - cp.advancePct}%-retentie op; bij niet-factoring-klanten de volle factuur. Norm ${cp.normDays} dagen.`}
          onSource={() => setKpiSrc(src(
            "Cashpotentieel bij betaling op de norm", formatCurrency(cp.unlockAtNorm), perNu,
            `Het antwoord op "wat is de effectieve beschikbare cash t.o.v. de invorderingen": van alles wat vandaag open staat, hebben we bij factoring-klanten het voorschot al binnen en moet enkel de retentie nog komen; bij niet-factoring-klanten moet alles nog komen. De vrijmaking is wat er vandaag al op de rekening zou staan als niemand langer dan ${cp.normDays} dagen over de betaling deed.`,
            `Open klantposten (Cust_LedgerEntries, Open = true, Document_Type = Invoice) van alle vennootschappen, intercompany uitgesloten, bedragen incl. btw. Ouderdom = dagen tussen factuurdatum en vandaag. Factoring-klant = minstens 40% van zijn betaald volume wikkelt af via een factor-dagboek (KBCF/BELF/BNPF/KBCC/KBC).`,
            [
              { naam: "Openstaand extern totaal", waarde: formatCurrency(cp.openTotal) },
              { naam: `— bij factoring-klanten`, waarde: formatCurrency(cp.openFactored) },
              { naam: `— bij niet-factoring-klanten`, waarde: formatCurrency(cp.openNonFactored) },
              { naam: `Al voorgeschoten door de bank (${cp.advancePct}%, AANNAME)`, waarde: formatCurrency(cp.alreadyAdvanced) },
              { naam: `Retentie nog te ontvangen (${100 - cp.advancePct}%)`, waarde: formatCurrency(cp.retentionDue) },
              { naam: "= Effectief nog te innen cash", waarde: formatCurrency(cp.effectiveOutstanding) },
              { naam: `Eenmalige vrijmaking bij ${cp.normDays} dagen`, waarde: formatCurrency(cp.unlockAtNorm) },
              { naam: `— waarvan retentie bij factoring`, waarde: formatCurrency(cp.unlockFactored) },
              { naam: `— waarvan volle facturen niet-factoring`, waarde: formatCurrency(cp.unlockNonFactored) },
              { naam: `Rentewinst per maand daarna (${cp.ratePct.toFixed(1)}%/jaar)`, waarde: formatCurrency(cp.monthlyInterestSaved) },
              { naam: `Kruiscontrole: structureel bij DSO ${cp.dsoNow ?? "—"} → ${cp.normDays} d`, waarde: cp.structuralRelease != null ? formatCurrency(cp.structuralRelease) : "n.b." },
            ],
            "Open posten",
            cp.notes[0],
          ))}
        >
          {/* Stand vandaag: wat is er al binnen, wat moet nog komen */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              label="Openstaand extern" value={formatCurrencyCompact(cp.openTotal)}
              sub={`${perNu} · factoring ${formatCurrencyCompact(cp.openFactored)} · niet-factoring ${formatCurrencyCompact(cp.openNonFactored)}`}
            />
            <Kpi
              label={`Al voorgeschoten (${cp.advancePct}%)`} value={formatCurrencyCompact(cp.alreadyAdvanced)}
              sub="cash die we al van de bank hebben · AANNAME, niet uit BC" tone="pos"
            />
            <Kpi
              label="Effectief nog te innen" value={formatCurrencyCompact(cp.effectiveOutstanding)}
              sub={`retentie ${formatCurrencyCompact(cp.retentionDue)} + niet-factoring ${formatCurrencyCompact(cp.openNonFactored)}`}
              tone="warn"
            />
            <Kpi
              label={`Vrij bij ${cp.normDays} dagen`} value={formatCurrencyCompact(cp.unlockAtNorm)}
              sub={`EENMALIG · daarna ${formatCurrency(cp.monthlyInterestSaved)}/maand rentewinst`}
              tone="pos"
            />
          </div>

          {/* Waar zit die vrijmaking, en wat is het traject naar het maximum */}
          <div className="mt-4 grid gap-4 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <p className="mb-1.5 text-[11px] font-semibold text-foreground">
                Waar zweeft het geld — en wat komt daarvan vrij
                <span className="ml-1 font-normal text-muted-foreground">(grijs = openstaand, groen = vrij te maken cash)</span>
              </p>
              {unlockChart && <EChart option={unlockChart} height={210} ariaLabel="Openstaand en vrij te maken cash per ouderdomsblok" />}
            </div>
            <div className="lg:col-span-2">
              <p className="mb-1.5 text-[11px] font-semibold text-foreground">
                Verbetertraject — wat levert elk doel op
              </p>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-1 text-left">Doel</th>
                    <th className="px-2 py-1 text-right">Vrij (eenmalig)</th>
                    <th className="px-2 py-1 text-right">Facturen</th>
                  </tr>
                </thead>
                <tbody>
                  {[...cp.targets].sort((a, b) => b.normDays - a.normDays).map((t) => (
                    <tr key={t.normDays} className={`border-b border-border/40 ${t.normDays === cp.normDays ? "bg-primary/5" : ""}`}>
                      <td className="px-2 py-1.5 font-semibold text-foreground">
                        alles ≤ {t.normDays} d
                        {t.normDays === cp.normDays && <span className="ml-1 rounded bg-primary/15 px-1 text-[9px] font-semibold text-primary">max target</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-positive">{formatCurrency(t.unlock)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{t.invoices}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-2 space-y-1.5 rounded-lg bg-muted/60 p-2.5 text-[10px] leading-snug text-muted-foreground">
                <p>
                  <b className="text-foreground">Eenmalig, niet per maand.</b> De vrijmaking is cash die vandaag al binnen zou zijn.
                  Het terugkerende voordeel is de rente die je daarna niet meer betaalt: <b className="text-foreground">{formatCurrency(cp.monthlyInterestSaved)} per maand</b> aan {cp.ratePct.toFixed(1)}%/jaar.
                </p>
                {cp.structuralRelease != null && cp.dsoNow != null && (
                  <p>
                    <b className="text-foreground">Kruiscontrole:</b> een DSO van {cp.dsoNow} d naar {cp.normDays} d brengen betekent structureel {formatCurrency(cp.structuralRelease)} minder
                    uitstaand werkkapitaal. Dat is langs een andere weg gerekend (dagomzet × dagen) en hoort dezelfde grootteorde te geven als de {formatCurrency(cp.unlockAtNorm)} hiernaast.
                  </p>
                )}
                {cp.recourseOver90 > 0 && (
                  <p className="text-warning">
                    <b>Terugnamerisico:</b> {formatCurrency(cp.recourseOver90Gross)} staat bij factoring-klanten langer dan 90 dagen open.
                    Bij recourse kan de bank het voorschot terugvragen — dan verlaat er {formatCurrency(cp.recourseOver90)} cash het huis terwijl de vordering blijft staan.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Belijst met een €-target per klant */}
          <div className="mt-4">
            <p className="mb-1.5 text-[11px] font-semibold text-foreground">
              Wie bellen, en wat het per klant oplevert
              <span className="ml-1 font-normal text-muted-foreground">
                — gesorteerd op vrij te maken cash, niet op openstaand bedrag: bij een factoring-klant heb je {cp.advancePct}% al binnen
              </span>
            </p>
            <div className="max-h-[320px] overflow-y-auto overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-xs">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-1 text-left">Klant</th>
                    <th className="px-2 py-1 text-right">Openstaand</th>
                    <th className="px-2 py-1 text-right" title={`Bij factoring-klanten al voorgeschoten door de bank (${cp.advancePct}%, aanname)`}>Al voorgeschoten</th>
                    <th className="px-2 py-1 text-right" title="Cash die vrijkomt als deze klant naar de norm gaat">Target cash</th>
                    <th className="px-2 py-1 text-right">Oudste</th>
                    <th className="px-2 py-1 text-left">Telefoon</th>
                    <th className="px-2 py-1 text-center">In BC</th>
                  </tr>
                </thead>
                <tbody>
                  {cp.customers.map((c) => (
                    <tr key={c.name} className="border-b border-border/40">
                      <td className="max-w-[220px] truncate px-2 py-1 font-medium text-foreground" title={`${c.name} · ${c.companies.join(", ")}`}>
                        {c.name}
                        {c.factored
                          ? <span className="ml-1 rounded bg-primary/15 px-1 text-[9px] font-semibold text-primary" title={`${cp.advancePct}% al voorgeschoten — sneller betalen levert enkel de retentie op`}>factor</span>
                          : <span className="ml-1 rounded bg-positive/15 px-1 text-[9px] font-semibold text-positive" title="Volle factuur komt vrij bij sneller betalen">100%</span>}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{formatCurrency(c.open)}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{c.alreadyAdvanced ? formatCurrency(c.alreadyAdvanced) : "—"}</td>
                      <td className="px-2 py-1 text-right font-semibold tabular-nums text-positive">{formatCurrency(c.unlockAtNorm)}</td>
                      <td className="px-2 py-1 text-right font-semibold tabular-nums">{c.maxDays}d</td>
                      <td className="px-2 py-1">{c.phone ? <a href={`tel:${c.phone.replace(/\s/g, "")}`} className="text-primary hover:underline">{c.phone}</a> : <span className="text-muted-foreground">—</span>}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-center">
                        {c.ledgerUrl ? (
                          <>
                            <a href={c.ledgerUrl} target="_blank" rel="noreferrer" title={`Alle posten van ${c.name} in BC (${c.company})`} className="mr-1.5 inline-flex text-primary hover:opacity-80"><Receipt className="h-3.5 w-3.5" /></a>
                            <a href={c.cardUrl} target="_blank" rel="noreferrer" title="Klantenkaart" className="inline-flex text-primary hover:opacity-80"><ExternalLink className="h-3.5 w-3.5" /></a>
                          </>
                        ) : <span className="text-[10px] text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <details className="mt-3">
            <summary className="cursor-pointer text-[11px] font-semibold text-foreground">Aannames en beperkingen van dit model</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[10px] leading-snug text-muted-foreground">
              {cp.notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          </details>
        </Card>
      )}

      {/* ---- DSO-verloop + YoY ---- */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card
          title="DSO-verloop per categorie"
          period={`${chartRange} maanden t/m ${mEnd(months[months.length - 1])}`}
          hint={`Balansmethode per maand: AR-eindsaldo ÷ gefactureerd × dagen in die maand. Getoond venster: ${mStart(months[Math.max(0, months.length - chartRange)])} t/m ${mEnd(months[months.length - 1])}. Categorieën: via factoring vs niet-factoring (extern); IC uitgesloten.`}
          onSource={() => setKpiSrc(src(
            "DSO-verloop per categorie", `${d.dso.dsoTotal[mi] ?? "—"}d in ${fmtMonth(selMonth)}`,
            `elke maand apart, venster ${mStart(months[Math.max(0, months.length - chartRange)])} t/m ${mEnd(months[months.length - 1])}`,
            "Elk punt is één kalendermaand op zich (geen rollend gemiddelde): het openstaande bedrag op de laatste dag van die maand, gedeeld door wat er in díe maand gefactureerd is, maal het aantal dagen van die maand. Het antwoord: 'hoeveel dagen omzet staat er open?'",
            `Cust_LedgerEntries (volledige historie, alle 11 vennootschappen) voor zowel de openstaande stand per maandeinde als de facturatie per maand. Factoring-klanten worden herkend op het dagboek waarmee hun facturen afgewikkeld worden (KBCF/BELF/BNPF/KBCC/KBC). Klik een maandpunt in de grafiek voor de opbouw van die maand per categorie, met daaronder een vindplaats-link per vennootschap naar de klantencontrolerekening 400000 in Business Central; de factuurregels één per één staan in het Excel-blad "Open posten".`,
            [
              { naam: `Openstaand extern op ${mEnd(selMonth)}`, waarde: formatCurrency(arExtSel) },
              { naam: `Gefactureerd extern in ${fmtMonth(selMonth)}`, waarde: formatCurrency(salesExtSel) },
              { naam: "Dagen in die maand", waarde: `${new Date(Date.UTC(Number(selMonth.slice(0, 4)), Number(selMonth.slice(5, 7)), 0)).getUTCDate()}` },
              { naam: "= DSO totaal", waarde: d.dso.dsoTotal[mi] != null ? `${d.dso.dsoTotal[mi]} dagen` : "n.b." },
            ],
            "DSO per maand",
            `De laatste 2 à 3 maanden hebben BEWUST geen punt: facturen van maand M worden bij Gheeraert nog tot diep in M+1 geboekt, dus die maanden zijn nog niet volledig en zouden een veel te hoge DSO tonen. De lijn "via factoring" meet de snelheid waarmee de factor afrekent, niet het betaalgedrag van de eindklant.`,
          ))}
          right={
            <div className="flex items-center gap-1">
              {([12, 19] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setChartRange(r)}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 transition ${chartRange === r ? "bg-primary/15 text-primary ring-primary/40" : "bg-muted text-muted-foreground ring-border hover:text-foreground"}`}
                >
                  {r} mnd
                </button>
              ))}
            </div>
          }
        >
          {dsoTrend && (
            <EChart
              option={dsoTrend}
              height={300}
              onSelect={(pt) => {
                if (typeof pt.dataIndex !== "number" || !d) return;
                const from = Math.max(0, d.dso.months.length - chartRange);
                setPickedMonth(from + pt.dataIndex);
              }}
              ariaLabel="DSO-verloop per categorie"
            />
          )}
        </Card>
        <Card
          title="DSO year-over-year"
          period={`kalenderjaren, venster ${mStart(months[0])} t/m ${mEnd(months[months.length - 1])}`}
          hint="Elke kalendermaand vergeleken met exact dezelfde kalendermaand vorig jaar (externe DSO, balansmethode). Volle lijn = dit jaar, stippellijn = vorig jaar."
          onSource={() => setKpiSrc(src(
            "DSO year-over-year", `${d.dso.dsoTotal[mi] ?? "—"}d in ${fmtMonth(selMonth)}`, perVenster,
            "Exact dezelfde cijfers als de grafiek links, maar per kalenderjaar over elkaar gelegd zodat januari met januari vergeleken wordt en niet met december. Zo zie je of we structureel beter of slechter innen, los van seizoenseffecten.",
            "Cust_LedgerEntries, dezelfde reeks als 'DSO-verloop per categorie', enkel anders geknipt. Er verschijnt alleen een vergelijking waar wij van beide jaargangen een volledige maand hebben; ontbrekende maanden blijven leeg in plaats van geraden te worden.",
            undefined, "DSO per maand",
            "Vergelijk alleen maanden waar béide lijnen een punt hebben. Een maand die dit jaar nog niet volledig geboekt is heeft geen punt, dus dan is er ook geen YoY-uitspraak.",
          ))}
        >
          {dsoYoY ? <EChart option={dsoYoY} height={300} ariaLabel="DSO year-over-year" /> : <p className="py-10 text-center text-xs text-muted-foreground">Nog geen twee jaargangen beschikbaar.</p>}
        </Card>
      </div>

      {/* ---- betaalsnelheid + facturatie per week ---- */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card
          title="Hoe laat betalen klanten? (vs vervaldag)"
          period={per12m}
          hint={`Bedrag-gewogen verdeling van álle facturen die in de periode ${per12m} volledig betaald zijn. Gemiddeld ${d.dsoInvoiceLevel.avgDays ?? "—"}d van factuur tot geld. Context BE: werkelijke B2B-termijn ±61d, wettelijk max 60d; transport = slechtst betalende sector 2024.`}
          onSource={() => setKpiSrc(src(
            "Betaalsnelheid vs vervaldag", `gemiddeld ${d.dsoInvoiceLevel.avgDays ?? "—"} dagen factuur → geld`, per12m,
            "Anders dan de DSO-grafiek kijkt dit naar de WERKELIJK betaalde facturen, één per één: hoeveel dagen na de factuurdatum kwam het geld, en hoeveel dagen vóór of ná de vervaldag was dat. De balken zijn gewogen op bedrag, niet op aantal facturen — één factuur van €100k weegt dus zwaarder dan tien van €1k.",
            `Gedetailleerde_klantenposten_Excel met Entry_Type = 'Application': dat is de enige plek in BC waar de échte betaaldatum per factuur staat (de toewijzing van betaling aan factuur). Enkel facturen die in de meetperiode volledig afgewikkeld zijn, tellen mee — half betaalde facturen zouden het gemiddelde vervalsen. ${d.dsoInvoiceLevel.note}`,
            [
              { naam: "Gemiddeld factuur → geld", waarde: d.dsoInvoiceLevel.avgDays != null ? `${d.dsoInvoiceLevel.avgDays} dagen` : "n.b." },
              { naam: "Mediaan factuur → geld", waarde: d.dsoInvoiceLevel.medianDays != null ? `${d.dsoInvoiceLevel.medianDays} dagen` : "n.b." },
              { naam: "Op tijd betaald (van betaald volume)", waarde: d.dsoInvoiceLevel.onTimePct != null ? `${d.dsoInvoiceLevel.onTimePct}%` : "n.b." },
            ],
            "Klantbetaalgedrag",
            "Facturen die vandaag nog open staan zitten hier NIET in — die kant staat in de bellijst. Deze grafiek beschrijft dus het gedrag op afgeronde facturen; een klant die al 200 dagen niet betaalt, verschijnt hier pas als hij ooit betaalt.",
          ))}
        >
          {speedHist && <EChart option={speedHist} height={244} ariaLabel="Betaalsnelheid vs vervaldag" />}
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Kpi
              label="CEI (inningseffectiviteit)"
              value={crfSel.cei != null ? `${crfSel.cei}%` : "—"}
              sub={`${perMaand}${d.crfKpis.cei12mAvg != null ? ` · 12m-gem. ${d.crfKpis.cei12mAvg}%` : ""} · 100% = alles geïnd wat inbaar was`}
              tone={crfSel.cei == null ? "neutral" : crfSel.cei >= 90 ? "pos" : crfSel.cei >= 75 ? "neutral" : "warn"}
              onClick={() => setKpiSrc(src(
                "CEI — Collection Effectiveness Index", crfSel.cei != null ? `${crfSel.cei}%` : "n.b.", perMaand,
                "Van al het geld dat we in deze maand hádden kunnen innen (openstaand bij het begin + wat we die maand factureerden, min wat nog niet vervallen was), welk deel hebben we effectief geïnd? 100% = we hebben alles binnengehaald wat inbaar was. Dit is de standaard van de Credit Research Foundation en is eerlijker dan de DSO, omdat het niet gestraft wordt door een groeiende omzet.",
                "Cust_LedgerEntries: openstaand extern op de laatste dag van de vorige maand, de externe facturatie van deze maand, het openstaand extern op de laatste dag van deze maand, en het deel daarvan dat op die dag nog niet vervallen was (op basis van de vervaldatum per post). Deze KPI wordt per maand apart berekend, niet rollend.",
                [
                  { naam: "Formule (CRF-standaard)", waarde: "(begin-AR + omzet − eind-AR) ÷ (begin-AR + omzet − niet-vervallen eind-AR) × 100" },
                  { naam: `Openstaand extern op ${mEnd(selMonth)}`, waarde: formatCurrency(arExtSel) },
                  { naam: `Gefactureerd extern in ${fmtMonth(selMonth)}`, waarde: formatCurrency(salesExtSel) },
                  { naam: "12-maands gemiddelde CEI", waarde: d.crfKpis.cei12mAvg != null ? `${d.crfKpis.cei12mAvg}%` : "n.b." },
                ],
                "Methodiek & bronnen",
                "Wij berekenen de CEI per maand (N=1). De CRF laat ook een kwartaal- of jaarvariant toe; die geeft een ander (meestal hoger) getal. Vergelijk dus nooit onze maand-CEI met een jaar-CEI van een andere bron. Maanden waarvan de facturatie nog niet volledig geboekt is, geven geen CEI.",
              ))}
            />
            <Kpi
              label="Best Possible DSO"
              value={crfSel.bpdso != null ? `${crfSel.bpdso}d` : "—"}
              sub={`de DSO als élke klant exact op de vervaldag betaalde · ${perMaand}`}
              onClick={() => setKpiSrc(src(
                "Best Possible DSO (BPDSO)", crfSel.bpdso != null ? `${crfSel.bpdso} dagen` : "n.b.", perMaand,
                "De DSO die we zouden hebben als geen enkele klant te laat was: enkel de facturen die op de laatste dag van de maand nog niet vervallen waren, gedeeld door de omzet van die maand. Dit is de ondergrens die met onze huidige betaalcondities haalbaar is — het verschil met de echte DSO is puur achterstalligheid.",
                "Cust_LedgerEntries: per open post wordt de vervaldatum (Due_Date) vergeleken met de laatste dag van de gekozen maand. Alleen posten die op dat moment nog niet vervallen waren, zitten in de teller. Noemer = dezelfde externe facturatie als bij de DSO, over dezelfde maand.",
                [
                  { naam: "Formule", waarde: "niet-vervallen openstaand op maandeinde ÷ omzet van die maand × dagen in die maand" },
                  { naam: "Echte DSO in deze maand", waarde: d.dso.dsoTotal[mi] != null ? `${d.dso.dsoTotal[mi]} dagen` : "n.b." },
                  { naam: "BPDSO (haalbare ondergrens)", waarde: crfSel.bpdso != null ? `${crfSel.bpdso} dagen` : "n.b." },
                  { naam: "= verschil (achterstalligheid)", waarde: crfSel.add != null ? `${crfSel.add} dagen` : "n.b." },
                ],
                "Methodiek & bronnen",
                "De BPDSO daalt niet door beter te innen maar door kórtere betaalcondities af te spreken. Wil je de DSO verlagen zonder de contracten te wijzigen, dan is de ADD hiernaast het cijfer om op te sturen.",
              ))}
            />
            <Kpi
              label="Achterstalligheid (ADD)"
              value={crfSel.add != null ? `${crfSel.add}d` : "—"}
              sub={`DSO − BPDSO = dagen puur te laat · ${perMaand}`}
              tone={crfSel.add != null && crfSel.add > 20 ? "warn" : "neutral"}
              onClick={() => setKpiSrc(src(
                "ADD — Average Days Delinquent", crfSel.add != null ? `${crfSel.add} dagen` : "n.b.", perMaand,
                "Het aantal dagen dat onze klanten gemiddeld TE LAAT zijn, los van de afgesproken betaaltermijn. Dit is het deel van de DSO dat we met bellen en aanmanen kunnen wegwerken: de rest van de DSO zit in de contractuele betaalcondities zelf.",
                "Rechtstreeks afgeleid uit de twee cijfers hiernaast, beide over exact dezelfde maand en dezelfde noemer (dat is belangrijk — vergelijk nooit een DSO en een BPDSO van verschillende periodes). Onderliggende bron: Cust_LedgerEntries met de vervaldatum per post.",
                [
                  { naam: "Formule (CRF-standaard)", waarde: "DSO − Best Possible DSO" },
                  { naam: `DSO ${fmtMonth(selMonth)}`, waarde: d.dso.dsoTotal[mi] != null ? `${d.dso.dsoTotal[mi]} dagen` : "n.b." },
                  { naam: `BPDSO ${fmtMonth(selMonth)}`, waarde: crfSel.bpdso != null ? `${crfSel.bpdso} dagen` : "n.b." },
                  { naam: "= ADD", waarde: crfSel.add != null ? `${crfSel.add} dagen` : "n.b." },
                ],
                "Methodiek & bronnen",
                "Elke dag ADD is werkkapitaal dat onnodig vastzit: ruwweg de dagomzet × het aantal dagen ADD. Bij factoring-klanten meet dit de snelheid van de factor, niet van de eindklant.",
              ))}
            />
          </div>
          <p className="mt-2 text-[10px] leading-snug text-muted-foreground">{d.crfKpis.note}</p>
        </Card>
        <Card
          title="Facturatie per week (excl. IC)"
          period={d.weekFlow.length ? `${weekRange(d.weekFlow[0].weekStart).replace(/^ma /, "").split(" t/m ")[0]} t/m ${weekRange(d.weekFlow[d.weekFlow.length - 1].weekStart).split(" t/m ")[1]}` : "laatste 26 weken"}
          hint={`Wat er per kalenderweek gefactureerd wordt en welk deel meteen richting factoring gaat — incl. btw. Elke balk draagt zijn exacte datumbereik in de tooltip.${d.weekFlow.length ? ` Getoond: ${weekRange(d.weekFlow[0].weekStart)} tot ${weekRange(d.weekFlow[d.weekFlow.length - 1].weekStart)}.` : ""}`}
          onSource={() => setKpiSrc(src(
            "Facturatie per week", `${d.weekFlow.length} weken getoond`,
            d.weekFlow.length ? `${weekRange(d.weekFlow[0].weekStart)} tot en met ${weekRange(d.weekFlow[d.weekFlow.length - 1].weekStart)}` : "laatste 26 weken",
            "Per kalenderweek (maandag t/m zondag) het totaal gefactureerde bedrag, opgesplitst in klanten die via factoring afwikkelen (groen) en de rest. Dit toont het facturatieritme: hoeveel omzet er per week de deur uit gaat en hoeveel daarvan direct financierbaar is.",
            "Cust_LedgerEntries met Document_Type = Invoice, gegroepeerd op de kalenderweek van de FACTUURDATUM (niet de boekingsdatum). Bedragen incl. btw. Intercompany uitgesloten. Een klant geldt als factoring-klant wanneer minstens 40% van zijn betaalde volume via een factor-dagboek afgewikkeld is.",
            d.weekFlow.slice(-4).map((w) => ({
              naam: weekRange(w.weekStart),
              waarde: `${formatCurrency(w.factored + w.other)} (${w.count} facturen, waarvan ${formatCurrency(w.factored)} via factoring)`,
            })),
            "Facturatie per week",
            "De laatste 1 à 2 weken zijn NOG NIET COMPLEET: facturen van de vorige maand worden bij Gheeraert doorheen de hele volgende maand geboekt. Een dalende laatste balk betekent dus niet dat er minder gefactureerd is.",
          ))}
        >
          {weekFlow && <EChart option={weekFlow} height={280} ariaLabel="Facturatie per week" />}
        </Card>
      </div>

      {/* ---- factoring ---- */}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Card
            title="Factoring per bank"
            period={`afgewikkeld ${per12m} · open = ${perNu}`}
            hint={`Twee verschillende periodes in één tabel, elk in de kolomtitel benoemd: het afgewikkelde volume en de snelheid gaan over ${per12m}, de open posities zijn een momentopname van ${vandaag}.`}
            onSource={() => setKpiSrc(src(
              "Factoring per bank", formatCurrency(d.factors.reduce((s, f) => s + f.settled12m, 0)),
              `afgewikkeld volume en snelheid: ${per12m} · open posities: momentopname ${vandaag}`,
              "Per factormaatschappij: hoeveel facturatie er in de afgelopen twaalf maanden via die factor is afgewikkeld, hoe snel dat ging (factuurdatum → geld), en hoeveel er op dit moment nog open staat bij klanten die via die factor lopen. LET OP dat de eerste drie kolommen over een periode gaan en de laatste twee over vandaag.",
              "Cust_LedgerEntries + Gedetailleerde_klantenposten_Excel: de factor wordt herkend aan het DAGBOEK waarmee de factuur afgewikkeld is — KBCF en KBCC = KBC Commercial Finance, BELF = Belfius Commercial Finance, BNPF = BNP Paribas Fortis Factor, KBC bij De Rudder. Er is geen veld 'factoring' in BC; deze dagboekherkenning is de enige betrouwbare route en is nagerekend op de toewijzingen van januari tot juli 2026.",
              d.factors.map((f) => ({
                naam: `${f.label} (${f.companies.join(", ")})`,
                waarde: `${formatCurrency(f.settled12m)} afgewikkeld · mediaan ${f.medianDaysToSettle ?? "n.b."}d · ${formatCurrency(f.openFactored)} open`,
              })),
              "Factoring",
              "De 15%-retentie (het deel dat de factor niet voorschiet) staat NIET in BC — in BC wordt elke factuur in één keer voor 100% afgewikkeld, en grootboekrekening 499200 vertoont geen beweging. Dat cijfer moet uit de maandrapporten van de factor-portalen komen. 'Open >90d' zijn kandidaten voor terugname (recourse).",
            ))}
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-1.5 text-left">Factor</th>
                    <th className="px-2 py-1.5 text-left">Firma&apos;s</th>
                    <th className="px-2 py-1.5 text-right" title={`Periode ${per12m}`}>Afgewikkeld<br /><span className="font-normal normal-case">{per12m}</span></th>
                    <th className="px-2 py-1.5 text-right" title={`Facturen afgewikkeld in ${per12m}`}>Mediaan dgn tot geld</th>
                    <th className="px-2 py-1.5 text-right" title={`Facturen afgewikkeld in ${per12m}`}>Gem.</th>
                    <th className="px-2 py-1.5 text-right" title={`Momentopname ${vandaag}`}>Open<br /><span className="font-normal normal-case">stand {vandaag}</span></th>
                    <th className="px-2 py-1.5 text-right" title={`Momentopname ${vandaag} — meer dan 90 dagen vervallen`}>Open &gt;90d<br /><span className="font-normal normal-case">stand {vandaag}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {d.factors.map((f) => (
                    <tr key={f.key} className="border-b border-border/50">
                      <td className="px-2 py-2 font-semibold text-foreground">{f.label} <span className="ml-1 font-mono text-[9px] text-muted-foreground">{f.key}</span></td>
                      <td className="px-2 py-2 text-muted-foreground">{f.companies.join(", ") || "—"}</td>
                      <td className="px-2 py-2 text-right font-semibold tabular-nums">{formatCurrencyCompact(f.settled12m)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{f.medianDaysToSettle != null ? `${f.medianDaysToSettle}d` : "—"}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{f.avgDaysToSettle != null ? `${f.avgDaysToSettle}d` : "—"}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatCurrencyCompact(f.openFactored)}</td>
                      <td className={`px-2 py-2 text-right tabular-nums ${f.openFactoredOver90 > 0 ? "font-semibold text-negative" : "text-muted-foreground"}`}>{f.openFactoredOver90 ? formatCurrencyCompact(f.openFactoredOver90) : "—"}</td>
                    </tr>
                  ))}
                  {!d.factors.length && <tr><td colSpan={7} className="py-4 text-center text-muted-foreground">Geen factor-afwikkelingen herkend in de meetperiode.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-muted/60 p-2 text-[10px] leading-snug text-muted-foreground">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              De 15%-retentie (het niet-voorgeschoten deel) staat niet in BC — dat vergt de maandrapporten uit de factor-portalen. Zodra finance die aanlevert, komt hier de retentie-doorlooptijd bij.
            </p>
          </Card>
        </div>
        <div className="space-y-4">
          <Card
            title="Factoringkost per maand"
            period={d.factoringCost.months.length ? `${mStart(d.factoringCost.months[0])} t/m ${mEnd(d.factoringCost.months[d.factoringCost.months.length - 1])}` : per12m}
            hint={`Commissie + rente per kalendermaand, excl. btw. ${formatCurrency(d.factoringCost.total12m)} over ${per12m}${d.factoringCost.ytdThrough ? ` · YTD t/m ${mEnd(d.factoringCost.ytdThrough)}: ${formatCurrency(d.factoringCost.totalYtd ?? 0)}` : ""}.`}
            onSource={() => setKpiSrc(src(
              "Factoringkost per maand", formatCurrency(d.factoringCost.total12m),
              d.factoringCost.months.length ? `elke kalendermaand apart, ${mStart(d.factoringCost.months[0])} t/m ${mEnd(d.factoringCost.months[d.factoringCost.months.length - 1])}` : per12m,
              "Wat factoring ons per maand werkelijk kost, gesplitst in twee soorten kost: de commissie die de factor aanrekent voor de dienst, en de rente/disconto voor het voorschieten van het geld. Beide zijn bedragen excl. btw, over alle vennootschappen samen.",
              "Grootboekposten_Excel op rekening 613340 (commissie, klasse 61) en 650000 (rente, klasse 65). Op 650000 staat óók gewone financieringsrente — bijvoorbeeld ±€123k straight-loan-rente bij GPR — dus daar nemen we uitsluitend de posten waarvan de tegenpartij of de omschrijving de factormaatschappij aanwijst: BNP Paribas Fortis Factor bij GTR (inclusief de reclass op contract 0003946), Belfius Commercial Finance bij GDI en KBC Comm.Fin.Factoring bij WHS.",
              [
                { naam: `Commissie 613340 (YTD t/m ${d.factoringCost.ytdThrough ? mEnd(d.factoringCost.ytdThrough) : "—"})`, waarde: formatCurrency(d.factoringCost.feeYtd ?? 0) },
                { naam: "Rente 650000, enkel factorposten (zelfde YTD)", waarde: formatCurrency(d.factoringCost.interestYtd ?? 0) },
                { naam: "= Totaal YTD", waarde: formatCurrency(d.factoringCost.totalYtd ?? 0) },
                { naam: `Totaal over ${per12m}`, waarde: formatCurrency(d.factoringCost.total12m) },
              ],
              "Factoring",
              "Conform CBN-advies 2011/23 hoort de commissie in klasse 61 en de rente/disconto in klasse 65; bij Gheeraert staat die rente op 650000 en niet op de door de CBN genoemde rekening 653. Laat de accountant bevestigen dat er op 650000 geen andere factoringkosten staan die wij nu missen.",
            ))}
          >
            {factoringCost && <EChart option={factoringCost} height={170} ariaLabel="Factoringkost per maand (commissie + rente)" />}
          </Card>
          <Card
            title="Teruggeboekte inningen"
            period={per12m}
            hint="Facturen die al afgewikkeld waren en daarna opnieuw open kwamen te staan — het recourse-signaal (voorbeeld: Painting & Decorating Services)."
            onSource={() => setKpiSrc(src(
              "Teruggeboekte inningen", `${d.bounceBacks.count} facturen · ${formatCurrency(d.bounceBacks.amount)}`, per12m,
              "Facturen waarvan de inning is teruggedraaid: ze waren afgewikkeld (door de klant of door de factor voorgeschoten) en zijn daarna opnieuw als openstaand geboekt. Bij factoring is dat het recourse-signaal: de factor neemt de vordering terug omdat de eindklant niet betaalde.",
              `Gedetailleerde_klantenposten_Excel: toewijzingsregels (Entry_Type = 'Application') die naderhand teruggedraaid zijn (Unapplied), geteld over ${per12m}. ${d.bounceBacks.note}`,
              [
                { naam: "Aantal teruggeboekte facturen", waarde: `${d.bounceBacks.count}` },
                { naam: "Totaalbedrag (incl. btw)", waarde: formatCurrency(d.bounceBacks.amount) },
                ...d.bounceBacks.examples.slice(0, 4).map((e) => ({ naam: `bv. ${e.customer}`, waarde: formatCurrency(e.amount) })),
              ],
              "Open posten",
              "Een terugboeking kan ook een gewone correctie van de boekhouding zijn (verkeerd toegewezen betaling). Elk geval hier hoort dus individueel bekeken te worden vóór je het als recourse rapporteert.",
            ))}
          >
            <div className="flex items-center gap-2">
              <Undo2 className="h-4 w-4 text-warning" />
              <p className="text-xl font-bold tabular-nums text-foreground">{d.bounceBacks.count} <span className="text-sm font-semibold text-muted-foreground">· {formatCurrency(d.bounceBacks.amount)}</span></p>
            </div>
            <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">{d.bounceBacks.note}</p>
          </Card>
        </div>
      </div>

      {/* ---- klantentabel ---- */}
      <Card
        title="Klantbetaalgedrag"
        period={`gefactureerd + betaalgedrag: ${per12m} · open: ${perNu}`}
        hint={`Grootste klanten op gefactureerd volume over ${per12m}. Positief 'vs vervaldag' = betaalt te laat. De kolommen open/vervallen zijn een momentopname van ${vandaag}, de rest gaat over de volledige twaalf maanden.`}
        onSource={() => setKpiSrc(src(
          "Klantbetaalgedrag per klant", `${d.customers.length} klanten getoond`,
          `gefactureerd volume en betaalgedrag: ${per12m} · openstaand en vervallen: momentopname ${vandaag}`,
          "Per klant: hoeveel we hem in twaalf maanden gefactureerd hebben, hoeveel dagen hij er gemiddeld over doet om te betalen, hoeveel dagen dat vóór of ná zijn vervaldag is, en wat er vandaag nog van hem open staat. Klik een klantrij voor zijn facturen één per één, met doorklik naar de post in Business Central.",
          "Cust_LedgerEntries (facturatie en openstaand) + Gedetailleerde_klantenposten_Excel met Entry_Type = 'Application' (de echte betaaldatum). Klanten worden op genormaliseerde NAAM samengevoegd over alle 11 vennootschappen, want dezelfde klant heeft in elke firma een ander klantnummer. De gemiddelden zijn bedrag-gewogen en berekend op facturen die in de periode VOLLEDIG betaald zijn.",
          [
            { naam: `Gefactureerd extern over ${per12m}`, waarde: formatCurrency(d.customers.reduce((s, c) => s + c.invoiced12m, 0)) },
            { naam: `Waarvan vandaag nog open`, waarde: formatCurrency(d.customers.reduce((s, c) => s + c.openNow, 0)) },
            { naam: `Waarvan vandaag vervallen`, waarde: formatCurrency(d.customers.reduce((s, c) => s + c.overdueNow, 0)) },
          ],
          "Klantbetaalgedrag",
          "Bij klanten die via factoring lopen meet 'dagen tot betaling' het moment waarop de FACTOR afrekent, niet wanneer de eindklant betaalde. Die klanten lijken daardoor sneller dan ze zijn; de kolom met de factor-markering laat zien om welke het gaat.",
        ))}
        right={
          <button onClick={() => setShowOpenList((v) => !v)} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[10px] font-semibold text-muted-foreground ring-1 ring-border hover:text-foreground">
            <Receipt className="h-3 w-3" />{showOpenList ? "Verberg open posten" : `Open posten (${formatCurrencyCompact(d.openInvoices.total)})`}
          </button>
        }
      >
        {showOpenList && (
          <div className="mb-4 rounded-xl border border-border bg-background/40 p-2">
            <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {d.openInvoices.itemsShown ?? d.openInvoices.items.length} grootste van {d.openInvoices.itemsTotal ?? d.openInvoices.items.length} open posten (incl. IC-posten, gemarkeerd) · ↗ opent de post in Business Central
            </p>
            <p className="mb-1.5 px-1 text-[10px] leading-snug text-muted-foreground">
              Extern open (facturen, bruto) {formatCurrency(d.openInvoices.total)} · intercompany {formatCurrency(d.openInvoices.ic ?? 0)} · grootboek-nettosaldo incl. IC {formatCurrency(d.openInvoices.netLedger ?? 0)} — het verschil zijn open creditnota&apos;s en betalingen zonder toewijzing.
            </p>
            <InvoiceList items={d.openInvoices.items} emptyLabel="Geen open posten." />
          </div>
        )}
        <CustomerTable customers={d.customers} onPick={setPickedCustomer} />
      </Card>

      {/* ---- omzet per klant (excl. btw) ---- */}
      <Card
        title="Omzet per klant — excl. btw (grootboek)"
        period={unitsData.data ? `01/01/${unitsData.data.year} t/m ${vandaag} (YTD)` : "YTD"}
        hint={unitsData.data ? `Boekjaar ${unitsData.data.year} van 01/01/${unitsData.data.year} tot en met vandaag. Dit is het P&L-perspectief (excl. btw); het te-innen-perspectief (incl. btw) staat in de klantentabel hierboven — dezelfde klant heeft daar dus een hoger bedrag.` : unitsData.building ? "Grootboek met tegenpartijen wordt opgehaald…" : "Laden…"}
        onSource={() => setKpiSrc(src(
          "Omzet per klant (grootboek, excl. btw)",
          unitsData.data ? formatCurrency(unitsData.data.revenuePerCustomer.reduce((s, c) => s + c.amount, 0)) : "—",
          unitsData.data ? `01/01/${unitsData.data.year} tot en met vandaag (${vandaag}), year-to-date` : "year-to-date",
          "De omzet zoals ze in de resultatenrekening staat (dus excl. btw), toegewezen aan de klant achter elke boeking. Dit is een ánder cijfer dan de klantentabel hierboven: daar staat wat een klant moet overschrijven (incl. btw, alle openstaande facturen), hier staat wat hij dit boekjaar aan omzet heeft opgeleverd.",
          "Grootboekposten_Excel: alle boekingen op de 70x-omzetrekeningen, gegroepeerd op de tegenpartij van de boeking (Source_Type = Customer, ±99% dekking). Intercompany-klanten zijn gemarkeerd met een IC-label zodat je ziet welk deel groepsintern is. Deze pull wordt gedeeld met de pagina Business Units, waar dezelfde cijfers per vennootschap staan.",
          undefined, "Methodiek & bronnen",
          "Marge per klant kán hier niet bij: dat vergt de kostenkant per klant (welke rit, welke onderaannemer, welke chauffeur) en die koppeling bestaat niet in Business Central — dat vraagt gegevens uit het TMS of job-costing. We tonen daarom bewust alleen de omzetkant en verzinnen geen marge.",
        ))}
      >
        {unitsData.building && !unitsData.data && <p className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Wordt opgebouwd (deelt de pull met Business Units)…</p>}
        {unitsData.error && <p className="py-4 text-center text-xs text-warning">{unitsData.error}</p>}
        {unitsData.data && (
          <div className="grid gap-x-6 md:grid-cols-2">
            {[unitsData.data.revenuePerCustomer.slice(0, 10), unitsData.data.revenuePerCustomer.slice(10, 20)].map((half, hi) => (
              <table key={hi} className="w-full border-collapse text-xs">
                <tbody>
                  {half.map((c, i) => (
                    <tr key={c.name} className="border-b border-border/40">
                      <td className="w-6 px-1 py-1.5 text-right text-[10px] text-muted-foreground">{hi * 10 + i + 1}.</td>
                      <td className="max-w-[220px] truncate px-2 py-1.5 font-medium text-foreground" title={c.name}>
                        {c.name}
                        {c.ic && <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[9px] font-semibold text-muted-foreground">IC</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{formatCurrencyCompact(c.amount)}</td>
                      <td className="w-14 px-2 py-1.5 text-right text-[10px] tabular-nums text-muted-foreground">{c.sharePct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
          </div>
        )}
      </Card>

      {/* ---- inningsverwachting ---- */}
      <Card
        title="Verwachte inning — komende 13 weken"
        period={d.cashExpectation.length ? `${weekRange(d.cashExpectation[0].weekStart)} t/m ${weekRange(d.cashExpectation[d.cashExpectation.length - 1].weekStart).split(" t/m ")[1]}` : "komende 13 weken"}
        hint={`VOORUITBLIK (geen historiek): de facturen die vandaag ${vandaag} open staan, ingepland op het historische betaalgedrag per klant (balken) versus hun theoretische vervaldatum (stippellijn). Elke balk toont zijn exacte weekbereik in de tooltip.`}
        onSource={() => setKpiSrc(src(
          "Verwachte inning komende 13 weken",
          formatCurrency(d.cashExpectation.reduce((s, w) => s + w.expected, 0)),
          d.cashExpectation.length ? `vooruitblik ${weekRange(d.cashExpectation[0].weekStart)} tot en met ${weekRange(d.cashExpectation[d.cashExpectation.length - 1].weekStart)}, op basis van de openstaande posten van ${vandaag}` : "komende 13 weken",
          "Dit is het enige cijfer op deze pagina dat naar de TOEKOMST kijkt. We nemen elke factuur die vandaag nog open staat en schatten wanneer het geld komt: niet op de vervaldatum (die halen veel klanten niet), maar op het gemiddelde dat díe klant historisch nodig heeft. De stippellijn toont wat het zou zijn als iedereen wél op de vervaldag betaalde — het verschil tussen balk en lijn is het verwachte uitstel.",
          "Cust_LedgerEntries met Open = true voor de openstaande posten, plus het per-klant gewogen gemiddelde betaalgedrag uit Gedetailleerde_klantenposten_Excel. Verwachte betaaldag = factuurdatum + de gemiddelde betaaltermijn van die klant; voor klanten zonder betaalhistoriek gebruiken we de groepsmediaan. Facturen waarvan de verwachte betaaldag al voorbij is, worden in week 1 gezet (we doen niet alsof dat geld al binnen is). Bedragen incl. btw, intercompany uitgesloten.",
          d.cashExpectation.slice(0, 4).map((w) => ({ naam: weekRange(w.weekStart), waarde: `${formatCurrency(w.expected)} verwacht (op vervaldag zou het ${formatCurrency(w.onDueDate)} zijn)` })),
          "Open posten",
          "Dit is een PROGNOSE op basis van gedrag uit het verleden, geen toezegging van klanten. Nieuwe facturatie van de komende weken zit er niet in — de reeks loopt dus naar rechts af, en dat is normaal, niet een verwachte cash-daling.",
        ))}
      >
        {cashExp && <EChart option={cashExp} height={260} ariaLabel="Verwachte inning 13 weken" />}
      </Card>

      {/* ---- banken ---- */}
      <Card
        title="Banken — werkelijke geldstromen"
        period={`saldo: ${perNu} · stromen: ${per12m}`}
        hint={bank.data ? `Saldo op ${vandaag}: ${formatCurrency(bank.data.totals.cashNow)}. Geldstromen over ${per12m}: ${formatCurrency(bank.data.totals.in12m)} in, ${formatCurrency(bank.data.totals.out12m)} uit. Twee verschillende periodes — de saldokolom is een momentopname, de in/uit-kolommen zijn twaalf maanden.` : bank.building ? "Bankmutaties worden opgehaald uit BC…" : "Bankmutaties laden…"}
        onSource={() => setKpiSrc(src(
          "Banken — werkelijke geldstromen",
          bank.data ? formatCurrency(bank.data.totals.cashNow) : "—",
          `saldo per rekening: momentopname ${vandaag} · inkomend en uitgaand: ${per12m}`,
          "De échte bewegingen op onze bankrekeningen, niet een schatting uit de resultatenrekening. Boven de as staat wat er binnenkwam, onder de as wat eruit ging, gestapeld per bankgroep zodat je ziet welke bank welk deel van het verkeer draagt. De tabel eronder geeft per individuele rekening het saldo van vandaag naast de stromen van twaalf maanden.",
          "BankAccountLedgerEntries (ODataV4) van alle 11 vennootschappen, met Amount_LCY zodat vreemde valuta correct in euro staat. Elke bankrekening wordt aan zijn bankgroep toegewezen op basis van de IBAN/rekeningnaam; factor-rekeningen krijgen bewust de eigen groep 'Factor' zodat het factoringverkeer niet als gewoon bankverkeer meetelt.",
          bank.data ? [
            { naam: `Totaal saldo op ${vandaag}`, waarde: formatCurrency(bank.data.totals.cashNow) },
            { naam: `Inkomend over ${per12m}`, waarde: formatCurrency(bank.data.totals.in12m) },
            { naam: `Uitgaand over ${per12m}`, waarde: formatCurrency(bank.data.totals.out12m) },
            { naam: "Aantal rekeningen in scope", waarde: `${bank.data.accounts.length}` },
          ] : undefined,
          "Methodiek & bronnen",
          "Interne overboekingen tussen onze eigen rekeningen tellen BRUTO mee aan beide kanten: ze verhogen dus zowel 'in' als 'uit' zonder dat er groepsgeld bijkomt of weggaat. Gebruik deze cijfers om het verkeer per bank te wegen, niet als netto-cashflow — die staat in de cashflow-export.",
        ))}
      >
        {bank.error && <p className="py-4 text-center text-xs text-warning">Bankdata kon niet geladen worden: {bank.error}</p>}
        {bank.building && !bank.data && <p className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Alle bankmutaties van 11 vennootschappen worden opgehaald…</p>}
        {bankChart && <EChart option={bankChart} height={280} ariaLabel="Geldstromen per bank per maand" />}
        {bank.data && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-1 text-left">Rekening</th>
                  <th className="px-2 py-1 text-left">Firma</th>
                  <th className="px-2 py-1 text-left">Groep</th>
                  <th className="px-2 py-1 text-right" title={`Momentopname ${vandaag}`}>Saldo<br /><span className="font-normal normal-case">stand {vandaag}</span></th>
                  <th className="px-2 py-1 text-right" title={`Periode ${per12m}`}>In<br /><span className="font-normal normal-case">{per12m}</span></th>
                  <th className="px-2 py-1 text-right" title={`Periode ${per12m}`}>Uit<br /><span className="font-normal normal-case">{per12m}</span></th>
                </tr>
              </thead>
              <tbody>
                {bank.data.accounts.filter((a) => Math.abs(a.balance) > 100 || a.in12m > 1000).slice(0, 18).map((a) => (
                  <tr key={`${a.company}-${a.code}`} className="border-b border-border/40">
                    <td className="max-w-[240px] truncate px-2 py-1 text-foreground" title={a.name}>{a.name}</td>
                    <td className="px-2 py-1 text-muted-foreground">{a.company}</td>
                    <td className="px-2 py-1"><span className={`rounded px-1 py-0.5 text-[9px] font-semibold ${a.brand === "Factor" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>{a.brand}</span></td>
                    <td className={`px-2 py-1 text-right font-semibold tabular-nums ${a.balance < 0 ? "text-negative" : "text-foreground"}`}>{formatCurrency(a.balance)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{formatCurrencyCompact(a.in12m)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{formatCurrencyCompact(a.out12m)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ---- BTW ---- */}
      <Card
        title="BTW-positie per maand"
        period={vat.data ? `YTD 01/01/${vat.data.ytd.year} t/m ${mEnd(vatLastMonth)} · YoY vs ${vat.data.prevYtd.year}` : "YTD"}
        hint={vat.data ? `Volledig afgesloten btw-aangifteperiodes van 01/01/${vat.data.ytd.year} tot en met ${mEnd(vatLastMonth)}: saldo ${formatCurrency(Math.abs(vat.data.ytd.net))} ${vat.data.ytd.net >= 0 ? "te betalen" : "te vorderen"}. Vergeleken met exact dezelfde maanden van ${vat.data.prevYtd.year}${vat.data.prevYtd.monthsCompared ? ` (${vat.data.prevYtd.monthsCompared})` : ""}: ${formatCurrency(Math.abs(vat.data.prevYtd.net))} ${vat.data.prevYtd.net >= 0 ? "te betalen" : "te vorderen"}.` : "BTW-posten worden geladen…"}
        onSource={() => setKpiSrc(src(
          "BTW-positie", vat.data ? formatCurrency(vat.data.ytd.net) : "—",
          vat.data ? `01/01/${vat.data.ytd.year} tot en met ${mEnd(vatLastMonth)} — enkel VOLLEDIG afgesloten aangifteperiodes` : "year-to-date",
          "Per btw-aangifteperiode: de btw die we op onze verkopen verschuldigd zijn, min de btw die we op onze aankopen mogen aftrekken. Positief saldo = te betalen aan de Staat, negatief = terug te vorderen. De maand die nu loopt zit er BEWUST niet in, want die aangifte is nog niet afgesloten en zou een vals beeld geven.",
          "Btw_posten_Excel (VAT Entries), gegroepeerd op VAT_Reporting_Date — dat is de aangifteperiode, niet de boekingsdatum, dus dit sluit aan op wat er effectief aangegeven is. Tekenafspraak: verkoop-btw komt in BC negatief binnen en wordt omgedraaid, aankoop-btw is positief. De groep werkt met een btw-eenheid, dus het werkelijke betaalsaldo wordt op eenheidsniveau afgerekend en niet per vennootschap.",
          vat.data ? [
            { naam: `Verschuldigd op verkopen YTD ${vat.data.ytd.year}`, waarde: formatCurrency(vat.data.perCompany.reduce((s, c) => s + c.ytdSaleVat, 0)) },
            { naam: "Aftrekbaar op aankopen YTD", waarde: formatCurrency(vat.data.perCompany.reduce((s, c) => s + c.ytdPurchVat, 0)) },
            { naam: "= Saldo YTD (te betalen aan de Staat)", waarde: formatCurrency(vat.data.ytd.net) },
            { naam: "Waarvan al betaald YTD", waarde: formatCurrency(vat.data.ytd.paid) },
            { naam: `Zelfde maanden van ${vat.data.prevYtd.year}${vat.data.prevYtd.monthsCompared ? ` (${vat.data.prevYtd.monthsCompared})` : ""}`, waarde: formatCurrency(vat.data.prevYtd.net) },
          ] : undefined,
          "Methodiek & bronnen",
          `De YoY-vergelijking gebruikt uitsluitend de kalendermaanden die in BEIDE jaren volledig zijn${vat.data?.prevYtd.monthsCompared ? ` (${vat.data.prevYtd.monthsCompared})` : ""} — anders zou je een half jaar tegen een vol jaar afzetten. Het saldo per vennootschap in de tabel is informatief: door de btw-eenheid wordt er op groepsniveau afgerekend, niet per firma.`,
        ))}
      >
        {vat.building && <p className="flex items-center gap-2 py-8 text-center text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />BTW-posten worden opgehaald uit BC…</p>}
        {vat.error && <p className="py-6 text-center text-xs text-warning">BTW-data kon niet geladen worden: {vat.error}</p>}
        {vatChart && <EChart option={vatChart} height={260} ariaLabel="BTW-positie per maand" />}
        {vat.data && (
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              label={`BTW-saldo YTD ${vat.data.ytd.year}`}
              value={formatCurrencyCompact(vat.data.ytd.net)}
              sub={`01/01/${vat.data.ytd.year} t/m ${mEnd(vatLastMonth)} · verschuldigd − aftrekbaar`}
              onClick={() => setKpiSrc(src(
                "BTW-saldo year-to-date", formatCurrency(vat.data!.ytd.net),
                `01/01/${vat.data!.ytd.year} tot en met ${mEnd(vatLastMonth)} — enkel volledig afgesloten aangifteperiodes`,
                "Alle btw die we dit jaar verschuldigd zijn op onze verkopen, min alle btw die we mogen aftrekken op onze aankopen. Positief betekent dat we netto aan de Staat moeten betalen.",
                "Btw_posten_Excel (VAT Entries) van alle 11 vennootschappen, gegroepeerd op VAT_Reporting_Date (de aangifteperiode). De lopende maand zit er niet in.",
                [
                  { naam: "Verschuldigd op verkopen", waarde: formatCurrency(vat.data!.perCompany.reduce((s, c) => s + c.ytdSaleVat, 0)) },
                  { naam: "Aftrekbaar op aankopen", waarde: formatCurrency(vat.data!.perCompany.reduce((s, c) => s + c.ytdPurchVat, 0)) },
                  { naam: "= Saldo", waarde: formatCurrency(vat.data!.ytd.net) },
                  { naam: "Waarvan al effectief betaald", waarde: formatCurrency(vat.data!.ytd.paid) },
                ],
                "Methodiek & bronnen",
                "Door de btw-eenheid wordt dit saldo op groepsniveau afgerekend; de bedragen per vennootschap in de tabel eronder zijn dus informatief en niet wat elke firma apart overschrijft.",
              ))}
            />
            <Kpi
              label="Terug te vorderen"
              value={formatCurrencyCompact(vat.data.ytd.recoverable)}
              sub={`01/01/${vat.data.ytd.year} t/m ${mEnd(vatLastMonth)} · som van de negatieve maandsaldi`}
              tone="pos"
              onClick={() => setKpiSrc(src(
                "Terug te vorderen btw", formatCurrency(vat.data!.ytd.recoverable),
                `01/01/${vat.data!.ytd.year} tot en met ${mEnd(vatLastMonth)}`,
                "De som van alle maanden waarin we méér aftrekbare btw hadden dan verschuldigde btw. In die maanden hebben we een vordering op de Staat in plaats van een schuld. Dit is geen saldo op één moment maar een optelling over het jaar.",
                "Btw_posten_Excel: we nemen per aangifteperiode het nettosaldo en tellen enkel de negatieve maanden op. Positieve maanden worden hier niet mee gesaldeerd — dat cijfer staat in de tegel links.",
                undefined, "Methodiek & bronnen",
                "Of dit bedrag effectief teruggevraagd of overgedragen is naar de volgende periode, staat niet in deze data; dat volgt uit de aangiftes zelf.",
              ))}
            />
            <Kpi
              label="Gem. voorfinanciering/mnd"
              value={formatCurrencyCompact(vat.data.prefinance.avgMonthlyNet)}
              sub={`gemiddeld per maand over 01/01/${vat.data.ytd.year} t/m ${mEnd(vatLastMonth)}`}
              tone="warn"
              onClick={() => setKpiSrc(src(
                "Gemiddelde btw-voorfinanciering per maand", formatCurrency(vat.data!.prefinance.avgMonthlyNet),
                `gemiddelde per maand over 01/01/${vat.data!.ytd.year} tot en met ${mEnd(vatLastMonth)}`,
                "Hoeveel geld we gemiddeld elke maand aan de Staat voorschieten. We moeten de btw op een verkoopfactuur afdragen zodra ze aangegeven is, ook al heeft de klant ons nog niet betaald — bij een DSO van 60 dagen financieren we die btw dus twee maanden lang zelf.",
                `Btw_posten_Excel: het gemiddelde van de maandelijkse nettosaldi over de afgesloten aangifteperiodes van dit jaar. ${vat.data!.prefinance.note}`,
                undefined, "Methodiek & bronnen",
                "Dit is een gemiddelde: individuele maanden kunnen fors afwijken (denk aan een maand met een grote investering, waar de aftrekbare btw plots hoog is). Kijk voor de piekbelasting naar de maandgrafiek hierboven, niet naar dit gemiddelde.",
              ))}
            />
            <Kpi
              label="IC-aandeel btw-basis"
              value={`${vat.data.icVat.basePct}%`}
              sub={`01/01/${vat.data.ytd.year} t/m ${mEnd(vatLastMonth)} · aandeel met groeps-tegenpartij`}
              onClick={() => setKpiSrc(src(
                "IC-aandeel in de btw-basis", `${vat.data!.icVat.basePct}%`,
                `01/01/${vat.data!.ytd.year} tot en met ${mEnd(vatLastMonth)}`,
                "Welk deel van onze btw-maatstaf tussen groepsvennootschappen onderling loopt. Dat is relevant omdat die btw binnen de btw-eenheid grotendeels neutraal is: de ene firma draagt af, de andere trekt af.",
                `Btw_posten_Excel gematcht op btw-nummer van de tegenpartij tegen de btw-nummers van de eigen groepsvennootschappen. ${vat.data!.icVat.note}`,
                undefined, "Methodiek & bronnen",
                `${vat.data!.vatUnit.note} Waar het btw-nummer van de tegenpartij niet ingevuld staat, kan een IC-transactie gemist worden — dit is dus een ondergrens.`,
              ))}
            />
          </div>
        )}
        {vat.data && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-1 text-left">Vennootschap</th>
                  <th className="px-2 py-1 text-right" title={`01/01/${vat.data.ytd.year} t/m ${mEnd(vatLastMonth)}`}>Verschuldigd<br /><span className="font-normal normal-case">01/01 t/m {mEnd(vatLastMonth)}</span></th>
                  <th className="px-2 py-1 text-right" title={`01/01/${vat.data.ytd.year} t/m ${mEnd(vatLastMonth)}`}>Aftrekbaar<br /><span className="font-normal normal-case">01/01 t/m {mEnd(vatLastMonth)}</span></th>
                  <th className="px-2 py-1 text-right" title={`01/01/${vat.data.ytd.year} t/m ${mEnd(vatLastMonth)}`}>Saldo<br /><span className="font-normal normal-case">01/01 t/m {mEnd(vatLastMonth)}</span></th>
                </tr>
              </thead>
              <tbody>
                {vat.data.perCompany.map((c) => (
                  <tr key={c.code} className="border-b border-border/40">
                    <td className="px-2 py-1 font-semibold text-foreground">{c.code}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{formatCurrencyCompact(c.ytdSaleVat)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{formatCurrencyCompact(c.ytdPurchVat)}</td>
                    <td className={`px-2 py-1 text-right font-semibold tabular-nums ${c.ytdNet >= 0 ? "text-foreground" : "text-positive"}`}>{formatCurrencyCompact(c.ytdNet)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ---- aging-verificatie ---- */}
      <Card
        title="Verificatie — BC's eigen aged-rapporten vs dit dashboard"
        hint={
          agingChk.data
            ? agingChk.data.allGreen
              ? `Alles groen: beide wegen geven exact hetzelfde open saldo (${agingChk.data.comparisons ?? agingChk.data.rows.length}/${agingChk.data.rows.length} vennootschappen vergeleken).`
              : agingChk.data.unchecked?.length
                ? `NIET VOLLEDIG GECONTROLEERD: BC's rapport gaf geen antwoord voor ${agingChk.data.unchecked.join(", ")} — die rijen zijn onbekend, niet groen. Overige rijen: zie de Δ-kolommen.`
                : "Er zijn verschillen — zie de rode cellen."
            : agingChk.building ? "Verificatie draait…" : "Verificatie laden…"
        }
        period={perNu}
        onSource={() => setKpiSrc(src(
          "Verificatie — BC's aged-rapporten vs dit dashboard",
          agingChk.data ? (agingChk.data.allGreen ? "Δ €0 — alles sluit" : "zie de Δ-kolommen") : "—",
          `momentopname ${vandaag}, beide wegen op exact hetzelfde moment herrekend`,
          "Een controle die wij niet zelf kunnen 'winnen': we vragen Business Central om zijn EIGEN ouderdomsanalyse van klanten en leveranciers, en vergelijken dat met wat dit dashboard uit de onderliggende posten optelt. Als de Δ nul is, kan het dashboard onmogelijk posten dubbel of te weinig geteld hebben. Deze test draait live bij elke pagina-opbouw, het is geen eenmalige controle uit het verleden.",
          `Weg 1: het BC-rapport agedAccountsReceivables en agedAccountsPayables per vennootschap. Weg 2: onze eigen som van open Cust_LedgerEntries en VendorLedgerEntries. ${agingChk.data?.sources?.[0]?.detail || ""}`,
          agingChk.data ? [
            { naam: "Vennootschappen vergeleken", waarde: `${agingChk.data.comparisons ?? agingChk.data.rows.length} van ${agingChk.data.rows.length}` },
            { naam: "AR volgens dit dashboard", waarde: formatCurrency(agingChk.data.rows.reduce((s, r) => s + r.arOwn, 0)) },
            { naam: "AP volgens dit dashboard", waarde: formatCurrency(agingChk.data.rows.reduce((s, r) => s + r.apOwn, 0)) },
            { naam: "Resultaat", waarde: agingChk.data.allGreen ? "alle Δ = €0" : "verschillen — zie de rode cellen" },
          ] : undefined,
          undefined,
          "Een rij met 'n.g.' is NIET groen: daar gaf BC's eigen rapport geen antwoord, dus die vennootschap is onbekend en niet gecontroleerd. Alleen rijen met een echte Δ zijn een bewijs.",
        ))}
        right={agingChk.data?.allGreen ? <ShieldCheck className="h-4 w-4 text-positive" /> : agingChk.data?.unchecked?.length ? <AlertTriangle className="h-4 w-4 text-warning" /> : undefined}
      >
        {agingChk.building && !agingChk.data && <p className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Beide wegen worden live herrekend…</p>}
        {agingChk.error && <p className="py-4 text-center text-xs text-warning">Verificatie kon niet draaien: {agingChk.error}</p>}
        {agingChk.data && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-1 text-left">Firma</th>
                  <th className="px-2 py-1 text-right">AR (BC-rapport)</th>
                  <th className="px-2 py-1 text-right">AR (dashboard)</th>
                  <th className="px-2 py-1 text-right">Δ</th>
                  <th className="px-2 py-1 text-right">AP (BC-rapport)</th>
                  <th className="px-2 py-1 text-right">AP (dashboard)</th>
                  <th className="px-2 py-1 text-right">Δ</th>
                </tr>
              </thead>
              <tbody>
                {agingChk.data.rows.map((r) => (
                  <tr key={r.company} className="border-b border-border/40">
                    <td className="px-2 py-1 font-semibold text-foreground">{r.company}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{r.arBcAged != null ? formatCurrency(r.arBcAged) : "—"}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{formatCurrency(r.arOwn)}</td>
                    <td className={`px-2 py-1 text-right font-semibold tabular-nums ${r.arDelta == null ? "text-muted-foreground" : Math.abs(r.arDelta) > 1 ? "text-negative" : "text-positive"}`} title={r.arDelta == null ? "BC-rapport gaf geen antwoord — niet gecontroleerd" : undefined}>{r.arDelta != null ? formatCurrency(r.arDelta) : "n.g."}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{r.apBcAged != null ? formatCurrency(r.apBcAged) : "—"}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{formatCurrency(r.apOwn)}</td>
                    <td className={`px-2 py-1 text-right font-semibold tabular-nums ${r.apDelta == null ? "text-muted-foreground" : Math.abs(r.apDelta) > 1 ? "text-negative" : "text-positive"}`} title={r.apDelta == null ? "BC-rapport gaf geen antwoord — niet gecontroleerd" : undefined}>{r.apDelta != null ? formatCurrency(r.apDelta) : "n.g."}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ---- datakwaliteit + bronnen ---- */}
      {d.dataQuality.length > 0 && (
        <div className="rounded-2xl border border-warning/30 bg-warning/10 p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <h2 className="text-sm font-semibold text-foreground">Datakwaliteit — actiepunten voor finance</h2>
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px] leading-snug text-muted-foreground">
            {d.dataQuality.map((q, i) => <li key={i}>{q}</li>)}
          </ul>
        </div>
      )}

      <details className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <summary className="cursor-pointer text-sm font-semibold text-foreground">Bronnen & methodiek — hoe komen we aan elk cijfer?</summary>
        <div className="mt-3 grid gap-2.5 md:grid-cols-2">
          {d.sources.map((s) => (
            <div key={s.label} className="rounded-xl border border-border bg-background/40 p-3">
              <p className="text-[11px] font-bold text-foreground">{s.label}</p>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{s.detail}</p>
            </div>
          ))}
          {(vat.data?.sources || []).map((s) => (
            <div key={`vat-${s.label}`} className="rounded-xl border border-border bg-background/40 p-3">
              <p className="text-[11px] font-bold text-foreground">BTW · {s.label}</p>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{s.detail}</p>
            </div>
          ))}
        </div>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-[11px] leading-snug text-muted-foreground">
          {d.notes.map((nte, i) => <li key={i}>{nte}</li>)}
          {(vat.data?.notes || []).map((nte, i) => <li key={`v${i}`}>{nte}</li>)}
        </ul>
      </details>

      {/* ---- bronpaneel achter een KPI ---- */}
      {kpiSrc && <KpiSourceModal src={kpiSrc} onClose={() => setKpiSrc(null)} />}

      {/* ---- maand-drill (DSO-grafiek) ---- */}
      {pickedMonth != null && d.dso.months[pickedMonth] && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setPickedMonth(null)}>
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-foreground">DSO-detail — {fmtMonth(d.dso.months[pickedMonth])}</h3>
                <p className="mt-0.5 text-[11px] text-muted-foreground">AR-eindsaldo en gefactureerd per categorie (incl. btw); DSO = saldo ÷ gefactureerd × dagen.</p>
              </div>
              <button onClick={() => setPickedMonth(null)} className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            <table className="mt-3 w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-1 text-left">Categorie</th>
                  <th className="px-2 py-1 text-right">AR eind maand</th>
                  <th className="px-2 py-1 text-right">Gefactureerd</th>
                  <th className="px-2 py-1 text-right">DSO</th>
                </tr>
              </thead>
              <tbody>
                {([
                  ["Extern via factoring", d.dso.arEndByCat.extFactoring[pickedMonth], d.dso.salesByCat.extFactoring[pickedMonth], d.dso.dsoExtFactoring[pickedMonth]],
                  ["Extern niet-factoring", d.dso.arEndByCat.extOther[pickedMonth], d.dso.salesByCat.extOther[pickedMonth], d.dso.dsoExtOther[pickedMonth]],
                  ["Intercompany", d.dso.arEndByCat.ic[pickedMonth], d.dso.salesByCat.ic[pickedMonth], null],
                ] as [string, number, number, number | null][]).map(([label, ar, sales, dso]) => (
                  <tr key={label} className="border-b border-border/40">
                    <td className="px-2 py-1.5 font-semibold text-foreground">{label}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(ar)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(sales)}</td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{dso != null ? `${dso}d` : "—"}</td>
                  </tr>
                ))}
                <tr>
                  <td className="px-2 py-1.5 font-bold text-foreground">Extern totaal</td>
                  <td className="px-2 py-1.5 text-right font-bold tabular-nums">{formatCurrency(d.dso.arEndByCat.extFactoring[pickedMonth] + d.dso.arEndByCat.extOther[pickedMonth])}</td>
                  <td className="px-2 py-1.5 text-right font-bold tabular-nums">{formatCurrency(d.dso.salesByCat.extFactoring[pickedMonth] + d.dso.salesByCat.extOther[pickedMonth])}</td>
                  <td className="px-2 py-1.5 text-right font-bold tabular-nums">{d.dso.dsoTotal[pickedMonth] != null ? `${d.dso.dsoTotal[pickedMonth]}d` : "—"}</td>
                </tr>
              </tbody>
            </table>
            {pickedMonth === d.dso.months.length - 1 && (
              <p className="mt-2 rounded-lg bg-warning/10 p-2 text-[10px] leading-snug text-warning">Lopende maand — facturatie is nog niet compleet (facturen worden tot in de volgende maand geboekt), het DSO-punt zakt nog.</p>
            )}
            {/* Laatste stap van de cascade: van deze maandcijfers naar de bron zelf.
                De maandtotalen zijn groepsbreed, dus per vennootschap één vindplaats
                op de AR-controlerekening; de factuurregels staan in de Excel. */}
            <div className="mt-3 border-t border-border pt-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Naar de bron in Business Central</p>
              <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
                Het AR-eindsaldo hierboven sluit aan op de klantencontrolerekeningen 400000/400001 (verificatiepaneel onderaan de pagina: Δ €0).
                Klik een vennootschap voor haar grootboekposten op die rekening; de facturen één per één, met een link per boeking, staan in het Excel-blad <b className="text-foreground">Open posten</b>.
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {companiesInScope.map((c) => (
                  <a
                    key={c}
                    href={glAccountLink(c, "400000")}
                    target="_blank"
                    rel="noreferrer"
                    title={`Grootboekposten van ${c} op rekening 400000 (handelsdebiteuren) in Business Central`}
                    className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-primary ring-1 ring-border transition hover:bg-primary/10 hover:ring-primary/40"
                  >
                    {c}<ExternalLink className="h-2.5 w-2.5" />
                  </a>
                ))}
              </div>
              <a
                href={`/api/cfo/export/klantencash${qs}`}
                className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[10px] font-semibold text-primary-foreground hover:opacity-90"
              >
                <FileSpreadsheet className="h-3 w-3" />Excel met de factuurregels
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ---- klant-detailmodal ---- */}
      {pickedCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setPickedCustomer(null)}>
          <div className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-foreground">{pickedCustomer.name}</h3>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Actief in {pickedCustomer.companies.join(", ")} · {pickedCustomer.paidCount} betaalde facturen in de meetperiode {per12m}
                </p>
              </div>
              <button onClick={() => setPickedCustomer(null)} className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Kpi label="Gefactureerd" value={formatCurrencyCompact(pickedCustomer.invoiced12m)} sub={`${per12m} · incl. btw`} />
              <Kpi label="Open" value={formatCurrencyCompact(pickedCustomer.openNow)} sub={`${perNu} · waarvan vervallen ${formatCurrencyCompact(pickedCustomer.overdueNow)}`} tone={pickedCustomer.overdueNow > 0 ? "warn" : "neutral"} />
              <Kpi label="Betaaltermijn" value={pickedCustomer.avgDaysToPay != null ? `${pickedCustomer.avgDaysToPay}d` : "—"} sub={`${per12m}${pickedCustomer.avgDaysVsDue != null ? ` · ${pickedCustomer.avgDaysVsDue > 0 ? "+" : ""}${pickedCustomer.avgDaysVsDue}d vs vervaldag` : ""}`} tone={pickedCustomer.avgDaysVsDue != null && pickedCustomer.avgDaysVsDue > 15 ? "neg" : "neutral"} />
            </div>
            <div className="mt-3 rounded-xl bg-muted/60 p-3 text-[11px] leading-snug text-muted-foreground">
              {pickedCustomer.factoredSharePct >= 40
                ? <>Deze klant wikkelt <b className="text-foreground">{Math.round(pickedCustomer.factoredSharePct)}%</b> van zijn betaald volume af via factoring — de betaaltermijn hierboven meet dus vooral de factor-afwikkeling (time-to-cash), niet het gedrag van de klant zelf.</>
                : <>Deze klant betaalt (vrijwel) volledig buiten factoring om — de betaaltermijn weerspiegelt het echte betaalgedrag.</>}
              {pickedCustomer.ic && <> <b className="text-foreground">Intercompany-tegenpartij.</b></>}
            </div>
            <p className="mt-3 text-[10px] text-muted-foreground">Individuele open posten: knop &quot;Open posten&quot; boven de klantentabel (met BC-doorklik), of de export Klantenaging in de CFO-cockpit.</p>
          </div>
        </div>
      )}
    </div>
  );
}
