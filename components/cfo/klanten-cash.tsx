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

      {/* ---- DSO-verloop + YoY ---- */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card
          title="DSO-verloop per categorie"
          hint="Balansmethode per maand: AR-eindsaldo ÷ gefactureerd × dagen. Categorieën: via factoring vs niet-factoring (extern); IC uitgesloten."
          source="Cust_LedgerEntries (alle historie) + factor-dagboekherkenning. De lijn 'via factoring' meet time-to-cash van de factor-afwikkeling, niet het gedrag van de eindklant. Maanden waarvan de facturatie nog niet volledig geboekt is tonen géén punt (anders zou één onvolledige maand de schaal opblazen). Zweef over een categorie in de legenda voor uitleg; klik een maand voor de onderliggende bedragen."
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
          hint="Zelfde kalendermaand vergeleken met vorig jaar (externe DSO, balansmethode)."
          source="Zelfde reeks als links, geknipt per kalenderjaar. Stippellijn = vorig jaar."
        >
          {dsoYoY ? <EChart option={dsoYoY} height={300} ariaLabel="DSO year-over-year" /> : <p className="py-10 text-center text-xs text-muted-foreground">Nog geen twee jaargangen beschikbaar.</p>}
        </Card>
      </div>

      {/* ---- betaalsnelheid + facturatie per week ---- */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card
          title="Hoe laat betalen klanten? (vs vervaldag)"
          hint={`Bedrag-gewogen verdeling van betaald volume. Gemiddeld ${d.dsoInvoiceLevel.avgDays ?? "—"}d van factuur tot geld. Context BE: werkelijke B2B-termijn ±61d, wettelijk max 60d; transport = slechtst betalende sector 2024.`}
          source={d.dsoInvoiceLevel.note}
        >
          {speedHist && <EChart option={speedHist} height={244} ariaLabel="Betaalsnelheid vs vervaldag" />}
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Kpi
              label="CEI (inningseffectiviteit)"
              value={crfSel.cei != null ? `${crfSel.cei}%` : "—"}
              sub={`${fmtMonth(selMonth)}${d.crfKpis.cei12mAvg != null ? ` · 12m-gem. ${d.crfKpis.cei12mAvg}%` : ""} · 100% = alles geïnd wat inbaar was`}
              tone={crfSel.cei == null ? "neutral" : crfSel.cei >= 90 ? "pos" : crfSel.cei >= 75 ? "neutral" : "warn"}
            />
            <Kpi label="Best Possible DSO" value={crfSel.bpdso != null ? `${crfSel.bpdso}d` : "—"} sub={`de DSO als élke klant exact op de vervaldag betaalde · ${fmtMonth(selMonth)}`} />
            <Kpi label="Achterstalligheid (ADD)" value={crfSel.add != null ? `${crfSel.add}d` : "—"} sub={`DSO − BPDSO = dagen puur te laat · ${fmtMonth(selMonth)}`} tone={crfSel.add != null && crfSel.add > 20 ? "warn" : "neutral"} />
          </div>
          <p className="mt-2 text-[10px] leading-snug text-muted-foreground">{d.crfKpis.note}</p>
        </Card>
        <Card
          title="Facturatie per week (excl. IC)"
          hint="Wat er wekelijks gefactureerd wordt en welk deel meteen richting factoring gaat — incl. btw."
          source="Facturen (Cust_LedgerEntries, Document_Type=Invoice) per week van factuurdatum, laatste 26 weken. Groen = klanten die via factoring afwikkelen (≥40% van betaald volume via factor-dagboek). LET OP: facturen van de vorige maand worden vaak doorheen de maand geboekt — de laatste 1–2 weken zijn dus nog niet compleet."
        >
          {weekFlow && <EChart option={weekFlow} height={280} ariaLabel="Facturatie per week" />}
        </Card>
      </div>

      {/* ---- factoring ---- */}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Card
            title="Factoring per bank"
            hint="Afgewikkeld volume, snelheid factuur→geld en open posities per factor (laatste 12m)."
            source="Herkenning op afwikkelings-dagboek (KBCF = KBC Commercial Finance; BELF = Belfius; BNPF = BNP). 'Open >90d' = vervallen posten bij factoring-klanten — kandidaten voor terugname (recourse) of niet-financierbaarheid."
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-1.5 text-left">Factor</th>
                    <th className="px-2 py-1.5 text-left">Firma&apos;s</th>
                    <th className="px-2 py-1.5 text-right">Afgewikkeld 12m</th>
                    <th className="px-2 py-1.5 text-right">Mediaan dgn tot geld</th>
                    <th className="px-2 py-1.5 text-right">Gem.</th>
                    <th className="px-2 py-1.5 text-right">Open (factoring-klanten)</th>
                    <th className="px-2 py-1.5 text-right">Open &gt;90d</th>
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
          <Card title="Factoringkost per maand" hint={`Commissie + rente · ${formatCurrencyCompact(d.factoringCost.total12m)} laatste 12m`} source="Split per CBN-advies 2011/23: factorcommissie op 613340 (klasse 61) + rente/disconto op 653x 'Discontokosten op vorderingen' (klasse 65). Alle vennootschappen, excl. btw. 653x kan ook niet-factoring-disconto bevatten.">
            {factoringCost && <EChart option={factoringCost} height={170} ariaLabel="Factoringkost per maand (commissie + rente)" />}
          </Card>
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <Undo2 className="h-4 w-4 text-warning" />
              <h2 className="text-sm font-semibold text-foreground">Teruggeboekte inningen (12m)</h2>
            </div>
            <p className="mt-2 text-xl font-bold tabular-nums text-foreground">{d.bounceBacks.count} <span className="text-sm font-semibold text-muted-foreground">· {formatCurrencyCompact(d.bounceBacks.amount)}</span></p>
            <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">{d.bounceBacks.note}</p>
          </div>
        </div>
      </div>

      {/* ---- klantentabel ---- */}
      <Card
        title="Klantbetaalgedrag"
        hint="Top-klanten op gefactureerd volume (12m). Positief 'vs vervaldag' = betaalt te laat."
        source="Per klant (naam-genormaliseerd over alle firma's): bedrag-gewogen dagen factuur→betaling en t.o.v. vervaldag, op volledig betaalde facturen in de meetperiode. Open/vervallen = stand van vandaag, incl. btw."
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
        hint={unitsData.data ? `YTD ${unitsData.data.year} · P&L-perspectief; het te-innen-perspectief (incl. btw) staat in de klantentabel hierboven.` : unitsData.building ? "Grootboek met tegenpartijen wordt opgehaald…" : "Laden…"}
        source="70x-omzetregels uit Grootboekposten_Excel, gegroepeerd op de klant achter de boeking (Source_Type=Customer, 99% dekking). IC-klanten gemarkeerd. Marge per klant vergt de kostenkant per klant — die koppeling zit niet in BC (TMS/job-costing nodig); daarom hier bewust alleen omzet."
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
        hint="Open externe posten, ingepland op het historische betaalgedrag per klant (balken) vs de theoretische vervaldatum (stippellijn)."
        source="Per open factuur: verwachte betaaldag = factuurdatum + de gewogen gemiddelde betaaltermijn van díe klant (fallback: groepsmediaan). Vervallen verwachtingen schuiven naar week 1. Bedragen incl. btw; IC uitgesloten."
      >
        {cashExp && <EChart option={cashExp} height={260} ariaLabel="Verwachte inning 13 weken" />}
      </Card>

      {/* ---- banken ---- */}
      <Card
        title="Banken — werkelijke geldstromen"
        hint={bank.data ? `Saldo nu ${formatCurrencyCompact(bank.data.totals.cashNow)} · in 12m ${formatCurrencyCompact(bank.data.totals.in12m)} · uit 12m ${formatCurrencyCompact(bank.data.totals.out12m)}` : bank.building ? "Bankmutaties worden opgehaald uit BC…" : "Bankmutaties laden…"}
        source="BankAccountLedgerEntries — de échte mutaties per bankrekening (geen heuristiek). Boven de as = inkomend, onder = uitgaand, gestapeld per bankgroep. Interne overboekingen tellen bruto aan beide kanten mee."
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
                  <th className="px-2 py-1 text-right">Saldo</th>
                  <th className="px-2 py-1 text-right">In 12m</th>
                  <th className="px-2 py-1 text-right">Uit 12m</th>
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
        hint={vat.data ? `YTD ${vat.data.ytd.year}: saldo ${formatCurrencyCompact(Math.abs(vat.data.ytd.net))} ${vat.data.ytd.net >= 0 ? "te betalen" : "te vorderen"} · zelfde periode ${vat.data.prevYtd.year}: ${formatCurrencyCompact(Math.abs(vat.data.prevYtd.net))} ${vat.data.prevYtd.net >= 0 ? "te betalen" : "te vorderen"}` : "BTW-posten worden geladen…"}
        source="Btw_posten_Excel per btw-aangifteperiode (VAT_Reporting_Date): verschuldigde btw op verkopen − aftrekbare btw op aankopen = maandsaldo. Positief = te betalen aan de overheid, negatief = te vorderen. De groep werkt met een btw-eenheid — het saldo wordt op eenheidsniveau afgerekend."
      >
        {vat.building && <p className="flex items-center gap-2 py-8 text-center text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />BTW-posten worden opgehaald uit BC…</p>}
        {vat.error && <p className="py-6 text-center text-xs text-warning">BTW-data kon niet geladen worden: {vat.error}</p>}
        {vatChart && <EChart option={vatChart} height={260} ariaLabel="BTW-positie per maand" />}
        {vat.data && (
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label={`BTW-saldo YTD ${vat.data.ytd.year}`} value={formatCurrencyCompact(vat.data.ytd.net)} sub="verschuldigd − aftrekbaar" />
            <Kpi label="Terug te vorderen" value={formatCurrencyCompact(vat.data.ytd.recoverable)} sub="som van negatieve maandsaldi YTD" tone="pos" />
            <Kpi label="Gem. voorfinanciering/mnd" value={formatCurrencyCompact(vat.data.prefinance.avgMonthlyNet)} sub={vat.data.prefinance.note} tone="warn" />
            <Kpi label="IC-aandeel btw-basis" value={`${vat.data.icVat.basePct}%`} sub={vat.data.icVat.note} />
          </div>
        )}
        {vat.data && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-1 text-left">Vennootschap</th>
                  <th className="px-2 py-1 text-right">Verschuldigd YTD</th>
                  <th className="px-2 py-1 text-right">Aftrekbaar YTD</th>
                  <th className="px-2 py-1 text-right">Saldo YTD</th>
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
        source={agingChk.data?.sources?.[0]?.detail || "agedAccountsReceivables/Payables (BC-rapport) vs som open klant-/leveranciersposten."}
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
                <p className="mt-0.5 text-[11px] text-muted-foreground">Actief in {pickedCustomer.companies.join(", ")} · {pickedCustomer.paidCount} betaalde facturen in de meetperiode</p>
              </div>
              <button onClick={() => setPickedCustomer(null)} className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Kpi label="Gefactureerd 12m" value={formatCurrencyCompact(pickedCustomer.invoiced12m)} sub="incl. btw" />
              <Kpi label="Open nu" value={formatCurrencyCompact(pickedCustomer.openNow)} sub={`waarvan vervallen ${formatCurrencyCompact(pickedCustomer.overdueNow)}`} tone={pickedCustomer.overdueNow > 0 ? "warn" : "neutral"} />
              <Kpi label="Betaaltermijn" value={pickedCustomer.avgDaysToPay != null ? `${pickedCustomer.avgDaysToPay}d` : "—"} sub={pickedCustomer.avgDaysVsDue != null ? `${pickedCustomer.avgDaysVsDue > 0 ? "+" : ""}${pickedCustomer.avgDaysVsDue}d vs vervaldag` : undefined} tone={pickedCustomer.avgDaysVsDue != null && pickedCustomer.avgDaysVsDue > 15 ? "neg" : "neutral"} />
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
