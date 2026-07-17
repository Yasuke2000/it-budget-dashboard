"use client";

import { useMemo, useState } from "react";
import * as echarts from "echarts";
import type { CfoFinancials, CfoPnlLine, CfoEntityRow, CfoAgingBucket } from "@/lib/types";
import { EChart, type EChartClick } from "./echart";
import { formatCurrency, formatCurrencyCompact } from "@/lib/utils";
import {
  TrendingUp, Wallet, ArrowDownCircle, ArrowUpCircle, Activity, Landmark,
  Info, X, ChevronRight, CalendarClock, Scale, AlertTriangle, Download, Loader2,
} from "lucide-react";

// ---- palette (IBCS-ish) ----
const C = { income: "#2dd4bf", expense: "#fb7185", ebitda: "#f59e0b", ebit: "#34d399", budget: "#94a3b8" };
const DONUT = ["#38bdf8", "#a78bfa", "#2dd4bf", "#f59e0b", "#fb7185", "#94a3b8"];
const AGING = ["#34d399", "#a3e635", "#fbbf24", "#fb923c", "#f43f5e", "#94a3b8"];
const AX = "#334155", GRID = "#1e293b", TXT = "#94a3b8", TXT2 = "#64748b";

type LP = echarts.DefaultLabelFormatterCallbackParams;
function eurAxis(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `€${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `€${Math.round(v / 1e3)}k`;
  return `€${Math.round(v)}`;
}

function fmtStamp(isoStr: string): string {
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("nl-BE", {
    timeZone: "Europe/Brussels", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(d);
}

function agingValue(b: CfoAgingBucket, eliminateIC: boolean): number {
  return eliminateIC && b.extern != null ? b.extern : b.amount;
}

// Pure (module-scope) zodat useMemo stabiel kan memoizen op [buckets, eliminateIC].
function buildAgingOption(buckets: CfoAgingBucket[], eliminateIC: boolean): echarts.EChartsOption {
  return {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => formatCurrency(Number(v)) },
    grid: { top: 24, left: 6, right: 8, bottom: 20, containLabel: true },
    xAxis: { type: "category", data: buckets.map((a) => a.label), axisLabel: { color: TXT, fontSize: 10 }, axisLine: { lineStyle: { color: AX } }, axisTick: { show: false } },
    yAxis: { type: "value", axisLabel: { color: TXT2, formatter: (v: number) => eurAxis(v) }, splitLine: { lineStyle: { color: GRID } } },
    series: [{
      type: "bar", barMaxWidth: 40, data: buckets.map((a, i) => ({ value: agingValue(a, eliminateIC), itemStyle: { color: AGING[i % AGING.length], borderRadius: [3, 3, 0, 0] } })),
      label: { show: true, position: "top", color: TXT, fontSize: 9, formatter: (p: LP) => eurAxis(Number(p.value)) },
    }],
  };
}

interface DrillRow { label: string; value: number }
interface Drill { title: string; subtitle?: string; total?: number; rows: DrillRow[]; note?: string }

export function CfoCockpit({ data }: { data: CfoFinancials }) {
  const [drill, setDrill] = useState<Drill | null>(null);
  const [eliminateIC, setEliminateIC] = useState(false);
  const k = data.kpis;

  const agingVal = (b: CfoAgingBucket) => (eliminateIC && b.extern != null ? b.extern : b.amount);

  // ---------- chart options ----------
  const waterfall = useMemo<echarts.EChartsOption>(() => {
    const labels: string[] = []; const base: number[] = [];
    const vals: { value: number; itemStyle: { color: string } }[] = [];
    let running = 0;
    for (const line of data.pnl) {
      labels.push(line.label);
      if (line.kind === "income") { base.push(0); vals.push({ value: line.amount, itemStyle: { color: C.income } }); running += line.amount; }
      else if (line.kind === "expense") { const mag = -line.amount; base.push(running - mag); vals.push({ value: mag, itemStyle: { color: C.expense } }); running -= mag; }
      else { base.push(0); vals.push({ value: line.amount, itemStyle: { color: line.key === "ebit" || line.key === "net" ? C.ebit : C.ebitda } }); }
    }
    return {
      grid: { top: 28, left: 6, right: 14, bottom: 88, containLabel: true },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => formatCurrency(Number(v)) },
      xAxis: { type: "category", data: labels, axisLabel: { color: TXT, interval: 0, rotate: 36, fontSize: 9.5 }, axisLine: { lineStyle: { color: AX } }, axisTick: { show: false } },
      yAxis: { type: "value", axisLabel: { color: TXT2, formatter: (v: number) => eurAxis(v) }, splitLine: { lineStyle: { color: GRID } } },
      series: [
        { name: "base", type: "bar", stack: "t", itemStyle: { color: "transparent" }, emphasis: { disabled: true }, data: base, silent: true, tooltip: { show: false } },
        { name: "P&L", type: "bar", stack: "t", data: vals, barMaxWidth: 46, label: { show: true, position: "top", color: "#cbd5e1", fontSize: 10, formatter: (p: LP) => eurAxis(Number(p.value)) } },
      ],
    };
  }, [data.pnl]);

  const donut = useMemo<echarts.EChartsOption>(() => ({
    tooltip: { trigger: "item", valueFormatter: (v) => formatCurrency(Number(v)) },
    series: [{
      type: "pie", radius: ["54%", "80%"], center: ["50%", "48%"], avoidLabelOverlap: true,
      itemStyle: { borderColor: "#0b1220", borderWidth: 2 },
      label: { color: "#cbd5e1", fontSize: 10, formatter: (p: LP) => `${p.name}\n${eurAxis(Number(p.value))}` },
      data: data.costStructure.map((c, i) => ({ name: c.accountName, value: c.amount, _class: c.accountNumber, itemStyle: { color: DONUT[i % DONUT.length] } })),
    }],
  }), [data.costStructure]);

  const monthly = useMemo<echarts.EChartsOption>(() => {
    const series: echarts.SeriesOption[] = [
      { name: "Opbrengsten", type: "bar", data: data.monthly.map((m) => m.revenue), itemStyle: { color: C.income, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 20 },
      { name: "Kosten", type: "bar", data: data.monthly.map((m) => m.costs), itemStyle: { color: C.expense, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 20 },
      { name: "Resultaat", type: "line", data: data.monthly.map((m) => m.result), itemStyle: { color: C.ebit }, lineStyle: { width: 2 }, symbol: "circle", symbolSize: 6 },
    ];
    const legend = ["Opbrengsten", "Kosten", "Resultaat"];
    if (data.budget?.configured && data.budget.monthlyRevenueTarget) {
      series.push({ name: "Doel omzet", type: "line", data: data.monthly.map(() => data.budget!.monthlyRevenueTarget), itemStyle: { color: C.budget }, lineStyle: { width: 1.5, type: "dashed" }, symbol: "none" });
      legend.push("Doel omzet");
    }
    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => formatCurrency(Number(v)) },
      legend: { data: legend, textStyle: { color: TXT }, top: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10 },
      grid: { top: 36, left: 6, right: 8, bottom: 20, containLabel: true },
      xAxis: { type: "category", data: data.monthly.map((m) => m.month.slice(5)), axisLabel: { color: TXT }, axisLine: { lineStyle: { color: AX } }, axisTick: { show: false } },
      yAxis: { type: "value", axisLabel: { color: TXT2, formatter: (v: number) => eurAxis(v) }, splitLine: { lineStyle: { color: GRID } } },
      series,
    };
  }, [data.monthly, data.budget]);

  const apAging = useMemo(() => buildAgingOption(data.apAging, eliminateIC), [data.apAging, eliminateIC]);
  const arAging = useMemo(() => (data.arAging ? buildAgingOption(data.arAging, eliminateIC) : null), [data.arAging, eliminateIC]);

  const forecast = useMemo<echarts.EChartsOption | null>(() => {
    const f = data.cashForecast; if (!f) return null;
    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => formatCurrency(Number(v)) },
      legend: { data: ["Inkomend", "Uitgaand", "Eindsaldo"], textStyle: { color: TXT }, top: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10 },
      grid: { top: 36, left: 6, right: 8, bottom: 20, containLabel: true },
      xAxis: { type: "category", data: f.weeks.map((w) => w.label), axisLabel: { color: TXT, fontSize: 9 }, axisLine: { lineStyle: { color: AX } }, axisTick: { show: false } },
      yAxis: { type: "value", axisLabel: { color: TXT2, formatter: (v: number) => eurAxis(v) }, splitLine: { lineStyle: { color: GRID } } },
      series: [
        { name: "Inkomend", type: "bar", stack: "cf", data: f.weeks.map((w) => w.inflow), itemStyle: { color: C.income } },
        { name: "Uitgaand", type: "bar", stack: "cf", data: f.weeks.map((w) => -w.outflow), itemStyle: { color: C.expense } },
        {
          name: "Eindsaldo", type: "line", data: f.weeks.map((w) => w.closing), itemStyle: { color: C.ebit }, lineStyle: { width: 2 }, symbol: "circle", symbolSize: 5,
          markLine: { silent: true, symbol: "none", lineStyle: { color: "#f43f5e", type: "dashed" }, data: [{ yAxis: 0 }] },
        },
      ],
    };
  }, [data.cashForecast]);

  // ---------- drill handlers ----------
  const drillLine = (line: CfoPnlLine) => setDrill({
    title: line.label,
    subtitle: line.pnlClass ? `PCMN-klasse ${line.pnlClass} · bron: Business Central grootboek` : "Subtotaal",
    total: Math.abs(line.amount),
    rows: line.accounts.map((a) => ({ label: `${a.accountNumber} · ${a.accountName}`, value: a.amount })),
    note: line.accounts.length ? "De grootboekrekeningen die deze regel vormen — dit is de brondata." : "Subtotaal — berekend uit de regels erboven.",
  });
  const onWaterfall = (p: EChartClick) => { if (typeof p.dataIndex === "number" && data.pnl[p.dataIndex]) drillLine(data.pnl[p.dataIndex]); };
  const onDonut = (p: EChartClick) => { const cls = (p.data as { _class?: string } | undefined)?._class; const line = data.pnl.find((l) => l.pnlClass === cls); if (line) drillLine(line); };
  const onApAging = (p: EChartClick) => { const b = data.apAging.find((x) => x.label === p.name); if (b) setDrill({ title: `Leveranciers — ${b.label}`, subtitle: "Open leveranciersposten (VendorLedgerEntries)", total: agingVal(b), rows: b.extern != null ? [{ label: "Extern", value: b.extern }, { label: "Intercompany", value: b.amount - b.extern }] : [], note: "Detail per leverancier: export 'Leveranciersaging'." }); };
  const onArAging = (p: EChartClick) => { const b = data.arAging?.find((x) => x.label === p.name); if (b) setDrill({ title: `Klanten — ${b.label}`, subtitle: "Open verkoopfacturen (salesInvoices)", total: agingVal(b), rows: b.extern != null ? [{ label: "Extern", value: b.extern }, { label: "Intercompany", value: b.amount - b.extern }] : [], note: "Te ontvangen van klanten op vervaldatum." }); };
  const onForecastWeek = (p: EChartClick) => {
    const f = data.cashForecast; if (!f || typeof p.dataIndex !== "number") return; const w = f.weeks[p.dataIndex]; if (!w) return;
    setDrill({ title: `Cashflow ${w.label}`, subtitle: `week van ${w.weekStart}`, total: w.closing, rows: [{ label: "Inkomend (klanten)", value: w.inflow }, { label: "Uitgaand (leveranciers + loon)", value: -w.outflow }, { label: "Netto", value: w.net }, { label: "Verwacht eindsaldo", value: w.closing }], note: "Projectie op basis van vervaldata." });
  };
  const onEntity = (e: CfoEntityRow) => setDrill({
    title: e.companyName, subtitle: `${e.code} · operationeel resultaat`, total: e.revenue,
    rows: [{ label: "Bedrijfsopbrengsten", value: e.revenue }, { label: "Bedrijfskosten", value: -e.costs }, { label: "Resultaat (EBIT)", value: e.result }],
    note: `Operationele marge ${e.marginPct}%`,
  });

  const apShown = eliminateIC ? k.apOpenExtern : k.apOpen;
  const arShown = eliminateIC ? k.arOpenExtern : k.arOpen;
  // ΔPY: elke resultaat-KPI draagt een vergelijking met dezelfde periode vorig jaar.
  const py = data.prevYear;
  const pct = (cur: number, prev?: number): number | null =>
    prev ? Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10 : null;
  const kpis: { label: string; value: string; sub: string; icon: typeof Wallet; accent: string; ring: string; glow: string; delta?: number | null }[] = [
    { label: "Bedrijfsopbrengsten", value: formatCurrencyCompact(k.revenue), sub: data.period.label, icon: ArrowUpCircle, accent: "text-teal-300", ring: "ring-teal-400/20", glow: "from-teal-500/15", delta: pct(k.revenue, py?.revenue) },
    { label: "EBITDA", value: formatCurrencyCompact(k.ebitda), sub: `${k.revenue ? Math.round((k.ebitda / k.revenue) * 1000) / 10 : 0}% van omzet`, icon: Activity, accent: "text-amber-300", ring: "ring-amber-400/20", glow: "from-amber-500/15", delta: pct(k.ebitda, py?.ebitda) },
    { label: "EBIT", value: formatCurrencyCompact(k.operatingResult), sub: `marge ${k.operatingMarginPct}%`, icon: TrendingUp, accent: "text-emerald-300", ring: "ring-emerald-400/20", glow: "from-emerald-500/15", delta: pct(k.operatingResult, py?.ebit) },
    { label: "Nettoresultaat", value: formatCurrencyCompact(k.netResult), sub: "na financieel & belastingen", icon: Landmark, accent: "text-lime-300", ring: "ring-lime-400/20", glow: "from-lime-500/15", delta: pct(k.netResult, py?.netResult) },
    { label: "Cashpositie", value: formatCurrencyCompact(k.cash), sub: "banksaldo (klasse 55)", icon: Wallet, accent: "text-sky-300", ring: "ring-sky-400/20", glow: "from-sky-500/15" },
    { label: "Te betalen (AP)", value: formatCurrencyCompact(apShown), sub: eliminateIC ? "extern" : "incl. intercompany", icon: ArrowDownCircle, accent: "text-rose-300", ring: "ring-rose-400/20", glow: "from-rose-500/15" },
    { label: "Te ontvangen (AR)", value: arShown ? formatCurrencyCompact(arShown) : "—", sub: eliminateIC ? "extern" : "incl. intercompany", icon: ArrowUpCircle, accent: "text-violet-300", ring: "ring-violet-400/20", glow: "from-violet-500/15" },
  ];

  const r = data.ratios;
  const ratioTiles = r ? [
    { label: "Current ratio", value: r.currentRatio.toFixed(2), tone: r.currentRatio >= 1.2 ? "emerald" : r.currentRatio >= 1 ? "amber" : "rose" },
    { label: "Quick ratio", value: r.quickRatio.toFixed(2), tone: r.quickRatio >= 1 ? "emerald" : r.quickRatio >= 0.8 ? "amber" : "rose" },
    { label: "Solvabiliteit", value: `${r.solvencyPct}%`, tone: r.solvencyPct >= 30 ? "emerald" : r.solvencyPct >= 20 ? "amber" : "rose" },
    { label: "DSO (klanten)", value: `${r.dso} d`, tone: "sky" },
    { label: "DPO (leveranciers)", value: `${r.dpo} d`, tone: "sky" },
    { label: "Cash conversion", value: `${r.ccc} d`, tone: r.ccc <= 0 ? "emerald" : "amber" },
  ] : [];
  const toneClass: Record<string, string> = { emerald: "text-emerald-300", amber: "text-amber-300", rose: "text-rose-300", sky: "text-sky-300" };

  const bs = data.balanceSheet;
  const bsMax = bs ? Math.max(bs.totalAssets, bs.totalClaims, 1) : 1;

  return (
    <div className="min-h-full -m-6 p-6 bg-[radial-gradient(1200px_600px_at_20%_-10%,rgba(45,212,191,0.08),transparent),radial-gradient(1000px_500px_at_100%_0%,rgba(56,189,248,0.08),transparent)]">
      {/* Hero */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-400/20 to-sky-500/20 ring-1 ring-white/10">
            <Landmark className="h-6 w-6 text-teal-300" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Financiële Cockpit</h1>
            <p className="text-sm text-slate-400">
              {data.company === "all" ? "Alle vennootschappen · geconsolideerd (bruto)" : `Vennootschap ${data.company}`} · {data.period.label}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {data.isLive ? `Data opgehaald: ${fmtStamp(data.generatedAt)}` : "Voorbeelddata"}
              {" · "}
              <a href="/cfo?refresh=1" className="text-teal-400 hover:text-teal-300 underline underline-offset-2">vernieuwen</a>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setEliminateIC((v) => !v)}
            className={`rounded-full px-3 py-1 text-[11px] font-semibold ring-1 transition ${eliminateIC ? "bg-teal-500/20 text-teal-200 ring-teal-400/40" : "bg-white/5 text-slate-400 ring-white/10 hover:text-white"}`}
            title="Intercompany-posten uit AP/AR verwijderen"
          >
            {eliminateIC ? "✓ Intercompany geëlimineerd" : "Intercompany elimineren"}
          </button>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide ${data.isLive ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30" : "bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/30"}`}>
            {data.isLive ? "LIVE · Business Central" : "DEMO · voorbeelddata"}
          </span>
          <span className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] font-medium text-slate-400 ring-1 ring-white/10">ECharts · IBCS</span>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        {kpis.map((t) => (
          <div key={t.label} className={`relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-4 ring-1 ${t.ring} backdrop-blur`}>
            <div className={`pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-gradient-to-br ${t.glow} to-transparent blur-2xl`} />
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{t.label}</span>
              <t.icon className={`h-4 w-4 ${t.accent}`} />
            </div>
            <div className={`mt-2 text-xl font-bold ${t.accent}`}>{t.value}</div>
            <div className="mt-0.5 text-[11px] text-slate-500">{t.sub}</div>
            {t.delta != null && (
              <div className={`mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${t.delta >= 0 ? "bg-emerald-500/10 text-emerald-300" : "bg-rose-500/10 text-rose-300"}`}>
                {t.delta >= 0 ? "▲" : "▼"} {Math.abs(t.delta)}% vs vorig jaar
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Ratio tiles */}
      {ratioTiles.length > 0 && (
        <div className="mt-4 grid grid-cols-3 gap-3 lg:grid-cols-6">
          {ratioTiles.map((t) => (
            <div key={t.label} className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">{t.label}</div>
              <div className={`mt-1 text-lg font-bold ${toneClass[t.tone]}`}>{t.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Cash-crunch banner */}
      {data.cashForecast && data.cashForecast.lowestClosing < 0 && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Verwacht negatief kassaldo in {data.cashForecast.lowestWeekLabel} ({formatCurrency(data.cashForecast.lowestClosing)}) — cashkrap.
        </div>
      )}

      {/* Main grid */}
      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Winst & verlies — brug naar bedrijfsresultaat" hint="Klik een balk voor de brongegevens" source="PCMN-klasse 6 & 7 · BC grootboek">
            <EChart option={waterfall} height={360} onSelect={onWaterfall} ariaLabel="P&L waterfall" />
            <Legend items={[["Opbrengsten", C.income], ["Kosten", C.expense], ["EBITDA", C.ebitda], ["EBIT", C.ebit]]} />
          </Card>

          {forecast && (
            <Card title="13-weken cashflowprognose (directe methode)" hint="Klik een week" source="Openstaande AR/AP op vervaldatum + loon">
              <EChart option={forecast} height={300} onSelect={onForecastWeek} ariaLabel="13-week cash forecast" />
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                <span>Openingssaldo: <span className="text-slate-300">{formatCurrency(data.cashForecast!.openingCash)}</span></span>
                <span>Laagste punt: <span className={data.cashForecast!.lowestClosing < 0 ? "text-rose-300" : "text-slate-300"}>{formatCurrency(data.cashForecast!.lowestClosing)}</span> ({data.cashForecast!.lowestWeekLabel})</span>
              </div>
            </Card>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="Kostenstructuur" hint="Klik een segment" source="Klasse 60–64">
              <EChart option={donut} height={300} onSelect={onDonut} ariaLabel="Cost structure" />
            </Card>
            <Card title="Opbrengsten vs. kosten per maand" hint={data.budget?.configured ? `omzet vs doel ${data.budget.revenueVariancePct >= 0 ? "+" : ""}${data.budget.revenueVariancePct}%` : undefined} source="Klasse 6 & 7 per maand">
              <EChart option={monthly} height={300} ariaLabel="Monthly revenue vs cost" />
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="Leveranciersaging (te betalen)" hint="Klik een bucket" source="Open leveranciersposten · vervaldatum">
              <EChart option={apAging} height={260} onSelect={onApAging} ariaLabel="AP aging" />
            </Card>
            {arAging && (
              <Card title="Klantenaging (te ontvangen)" hint="Klik een bucket" source="Open verkoopfacturen · vervaldatum">
                <EChart option={arAging} height={260} onSelect={onArAging} ariaLabel="AR aging" />
              </Card>
            )}
          </div>

          {bs && (
            <Card title="Balans (condensed)" source={`Momentopname ${bs.asOf} · betrouwbare posten`}>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <BalanceCol title="Activa" total={bs.totalAssets} lines={bs.assets} max={bsMax} color="#38bdf8" />
                <BalanceCol title="Passiva & eigen vermogen" total={bs.totalClaims} lines={bs.claims} max={bsMax} color="#a78bfa" />
              </div>
              {!bs.complete && <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500"><Scale className="h-3 w-3" /> Condensed — volledige balans (fin. schulden, overige) via de gematerialiseerde snapshot.</p>}
            </Card>
          )}

          <Card title="Per vennootschap" hint="Klik een rij" source="Operationeel resultaat per entiteit">
            <div className="max-h-[300px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-950/80 text-[11px] uppercase tracking-wider text-slate-500 backdrop-blur">
                  <tr><th className="px-2 py-1.5 text-left font-medium">Firma</th><th className="px-2 py-1.5 text-right font-medium">Omzet</th><th className="px-2 py-1.5 text-right font-medium">EBIT</th><th className="px-2 py-1.5 text-right font-medium">Marge</th></tr>
                </thead>
                <tbody>
                  {data.entities.map((e) => (
                    <tr key={e.code} onClick={() => onEntity(e)} className="cursor-pointer border-t border-white/5 hover:bg-white/5">
                      <td className="px-2 py-1.5 text-slate-300">{e.code}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{formatCurrencyCompact(e.revenue)}</td>
                      <td className={`px-2 py-1.5 text-right tabular-nums ${e.result >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{formatCurrencyCompact(e.result)}</td>
                      <td className={`px-2 py-1.5 text-right tabular-nums ${e.marginPct >= 0 ? "text-slate-300" : "text-rose-300"}`}>{e.marginPct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* Source / drill panel */}
        <div className="xl:col-span-1">
          <div className="sticky top-6 space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
            <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-white"><Download className="h-4 w-4 text-teal-300" /> Exports — live uit Business Central</h3>
            <p className="mb-3 text-[11px] text-slate-500">Elke export bevat de pull-timestamp (bestandsnaam + titelblad), zodat altijd duidelijk is van wanneer de data is.</p>
            <div className="space-y-2">
              <ExportButton kind="ap" label="Leveranciersaging (Excel)" />
              <ExportButton kind="ar" label="Klantenaging (Excel)" />
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><Info className="h-4 w-4 text-teal-300" /> Bron &amp; detail</h3>
              {drill && <button onClick={() => setDrill(null)} className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Sluiten"><X className="h-4 w-4" /></button>}
            </div>
            {drill ? (
              <div>
                <div className="text-base font-bold text-white">{drill.title}</div>
                {drill.subtitle && <div className="mt-0.5 text-xs text-slate-400">{drill.subtitle}</div>}
                {typeof drill.total === "number" && <div className="mt-2 text-2xl font-bold text-teal-300">{formatCurrency(drill.total)}</div>}
                {drill.rows.length > 0 && (
                  <div className="mt-3 divide-y divide-white/5 rounded-xl border border-white/10">
                    {drill.rows.map((row, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span className="truncate text-slate-300">{row.label}</span>
                        <span className={`shrink-0 tabular-nums ${row.value >= 0 ? "text-slate-200" : "text-rose-300"}`}>{formatCurrency(row.value)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {drill.note && <p className="mt-3 text-xs leading-relaxed text-slate-500">{drill.note}</p>}
              </div>
            ) : (
              <div>
                <p className="text-xs leading-relaxed text-slate-400">Klik op een balk, segment, bucket, week of rij om door te klikken naar de onderliggende grootboekrekeningen en de exacte brondata.</p>
                <div className="mt-4 space-y-3">
                  {data.sources.map((s) => (
                    <div key={s.label} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200"><ChevronRight className="h-3 w-3 text-teal-300" />{s.label}</div>
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{s.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {data.budget?.configured && (
              <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200"><CalendarClock className="h-3 w-3 text-teal-300" /> Budget vs. actual</div>
                <p className="mt-1 text-[11px] text-slate-500">Omzet {data.budget.revenueVariancePct >= 0 ? "+" : ""}{data.budget.revenueVariancePct}% vs. pro-rata doel · resultaat {data.budget.resultVariancePct >= 0 ? "+" : ""}{data.budget.resultVariancePct}%.</p>
              </div>
            )}
            {data.notes.length > 0 && (
              <div className="mt-5 border-t border-white/10 pt-4">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Aannames</div>
                <ul className="space-y-1.5">
                  {data.notes.map((n, i) => <li key={i} className="flex gap-1.5 text-[11px] leading-relaxed text-slate-500"><span className="text-slate-600">•</span>{n}</li>)}
                </ul>
              </div>
            )}
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- exports (de "knop": live pull uit BC, met timestamp) ----
function ExportButton({ kind, label }: { kind: "ap" | "ar"; label: string }) {
  const [busy, setBusy] = useState(false);
  const [pulledAt, setPulledAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/cfo/export/${kind}`);
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || `Export mislukt (${res.status})`);
      }
      const stamp = res.headers.get("X-Pulled-At");
      const dispo = res.headers.get("Content-Disposition") || "";
      const m = dispo.match(/filename="([^"]+)"/);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = m?.[1] || `${kind === "ap" ? "Leveranciersaging" : "Klantenaging"}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      if (stamp) setPulledAt(new Date(stamp).toLocaleString("nl-BE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export mislukt");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button
        onClick={run}
        disabled={busy}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-left text-sm font-medium text-slate-200 transition hover:bg-teal-500/10 hover:text-teal-200 disabled:opacity-60"
      >
        <span>{label}</span>
        {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-teal-300" /> : <Download className="h-4 w-4 shrink-0 text-teal-300" />}
      </button>
      {busy && <p className="mt-1 text-[10px] text-slate-500">Live aan het trekken uit BC (alle vennootschappen) — kan ± 1 min duren…</p>}
      {pulledAt && !busy && <p className="mt-1 text-[10px] text-emerald-400">✓ Data getrokken op {pulledAt}</p>}
      {error && !busy && <p className="mt-1 text-[10px] text-rose-400">{error}</p>}
    </div>
  );
}

// ---- helpers ----
function Card({ title, hint, source, children }: { title: string; hint?: string; source?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        {hint && <span className="shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-slate-400 ring-1 ring-white/10">{hint}</span>}
      </div>
      {children}
      {source && <p className="mt-2 text-[10px] uppercase tracking-wider text-slate-600">Bron: {source}</p>}
    </section>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
      {items.map(([label, color]) => (
        <span key={label} className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />{label}
        </span>
      ))}
    </div>
  );
}

function BalanceCol({ title, total, lines, max, color }: { title: string; total: number; lines: { label: string; amount: number }[]; max: number; color: string }) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</span>
        <span className="text-sm font-bold text-white tabular-nums">{formatCurrencyCompact(total)}</span>
      </div>
      <div className="space-y-2">
        {lines.map((l) => (
          <div key={l.label}>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400">{l.label}</span>
              <span className="tabular-nums text-slate-300">{formatCurrencyCompact(l.amount)}</span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, (Math.abs(l.amount) / max) * 100)}%`, background: color }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
