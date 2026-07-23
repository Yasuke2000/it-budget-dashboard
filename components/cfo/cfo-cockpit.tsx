"use client";

import { useMemo, useState } from "react";
import * as echarts from "echarts";
import type { CfoFinancials, CfoPnlLine, CfoEntityRow, CfoAgingBucket, CfoAgingItem } from "@/lib/types";
import { EChart, type EChartClick } from "./echart";
import { formatCurrency, formatCurrencyCompact } from "@/lib/utils";
import { useChartPalette, type ChartPalette } from "@/lib/chart-theme";
import {
  TrendingUp, Wallet, ArrowDownCircle, ArrowUpCircle, Activity, Landmark,
  Info, X, ChevronRight, CalendarClock, Scale, AlertTriangle, Download, Loader2,
  Building2, ChevronDown, Check, ExternalLink, History, Camera,
} from "lucide-react";

// ---- palette (IBCS-ish) ----
// Colours come from the shared, theme-aware chart palette (useChartPalette) so
// the cockpit adapts to both light and dark. Colours are read straight from `p`
// inside the component from `p`; module-scope helpers receive `p` as a param.

type LP = echarts.DefaultLabelFormatterCallbackParams;

// Kostenklasse-labels voor de heatmap (client-kopie; de servervariant zit in lib/cfo).
const CLASS_LABEL: Record<string, string> = {
  "60": "Aankopen & handelsgoederen",
  "61": "Diensten & diverse goederen",
  "62": "Bezoldigingen & sociale lasten",
  "63": "Afschrijvingen & waardeverm.",
  "64": "Andere bedrijfskosten",
};
const HEAT_CLASSES = ["60", "61", "62", "63", "64"];
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

// Pure (module-scope) zodat useMemo stabiel kan memoizen op [buckets, eliminateIC, p].
// Krijgt het thema-palet `p` als parameter zodat de aging-ramp mee kleurt met light/dark.
function buildAgingOption(buckets: CfoAgingBucket[], eliminateIC: boolean, p: ChartPalette): echarts.EChartsOption {
  // Goed → slecht ramp: op tijd (groen) tot ver vervallen (rood), rest neutraal.
  const AGING = [p.positive, p.result, p.warning, p.categorical[5], p.negative, p.budget];
  return {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => formatCurrency(Number(v)) },
    grid: { top: 24, left: 6, right: 8, bottom: 20, containLabel: true },
    xAxis: { type: "category", data: buckets.map((a) => a.label), axisLabel: { color: p.text, fontSize: 10 }, axisLine: { lineStyle: { color: p.axis } }, axisTick: { show: false } },
    yAxis: { type: "value", axisLabel: { color: p.textMuted, formatter: (v: number) => eurAxis(v) }, splitLine: { lineStyle: { color: p.grid } } },
    series: [{
      type: "bar", barMaxWidth: 40, data: buckets.map((a, i) => ({ value: agingValue(a, eliminateIC), itemStyle: { color: AGING[i % AGING.length], borderRadius: [3, 3, 0, 0] } })),
      label: { show: true, position: "top", color: p.text, fontSize: 9, formatter: (pl: LP) => eurAxis(Number(pl.value)) },
    }],
  };
}

interface DrillRow { label: string; value: number; accountNumber?: string }
interface Drill {
  title: string; subtitle?: string; total?: number; rows: DrillRow[]; note?: string;
  // Open AP/AR-posten in een aging-bucket, elk met BC-deeplink.
  items?: CfoAgingItem[]; itemsCount?: number;
}

// Onderste drill-niveau: de individuele boekingen achter één rekening (via
// /api/cfo/gl), elk met een BC-deeplink (vindplaats — zelfde conventie als de exports).
interface GlEntry { company: string; date: string; documentNumber: string; description: string; amount: number; bcUrl: string }
interface GlDrill {
  loading: boolean; error?: string;
  entries?: GlEntry[]; count?: number; total?: number; capped?: boolean;
  accountLinks?: { company: string; url: string }[]; note?: string;
}

// Navigeer met bijgewerkte querystring; behoudt de overige cockpit-parameters.
function navigateWith(params: Record<string, string | null>) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  url.searchParams.delete("snapshot"); // een nieuwe view is altijd live, nooit een momentopname
  window.location.href = url.toString();
}

// Periode-kiezer: YTD (default), kwartalen, halfjaar of een vrije van/tot-range.
// Navigeert met ?from&to — de server rekent alles op de periode door.
function PeriodPicker({ label }: { label: string }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const year = new Date().getFullYear();
  const presets: { label: string; from: string | null; to: string | null }[] = [
    { label: `YTD ${year} (standaard)`, from: null, to: null },
    { label: `Q1 ${year}`, from: `${year}-01-01`, to: `${year}-03-31` },
    { label: `Q2 ${year}`, from: `${year}-04-01`, to: `${year}-06-30` },
    { label: `Q3 ${year}`, from: `${year}-07-01`, to: `${year}-09-30` },
    { label: `Q4 ${year}`, from: `${year}-10-01`, to: `${year}-12-31` },
    { label: `H1 ${year}`, from: `${year}-01-01`, to: `${year}-06-30` },
    { label: `Volledig ${year - 1}`, from: `${year - 1}-01-01`, to: `${year - 1}-12-31` },
  ];
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-[11px] font-semibold text-muted-foreground ring-1 ring-border transition hover:text-foreground"
        title="Periode van de cockpit wijzigen"
      >
        <CalendarClock className="h-3 w-3" />
        {label}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-64 rounded-xl border border-border bg-popover p-2 shadow-xl">
          <p className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Periode</p>
          {presets.map((pr) => (
            <button
              key={pr.label}
              onClick={() => navigateWith({ from: pr.from, to: pr.to })}
              className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent"
            >
              {pr.label}
            </button>
          ))}
          <div className="mt-1.5 border-t border-border px-2 pt-2 pb-1">
            <p className="pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Vrije periode</p>
            <div className="flex items-center gap-1.5">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                className="w-full rounded-md border border-border bg-card px-1.5 py-1 text-[11px] text-foreground" aria-label="Van" />
              <span className="text-[10px] text-muted-foreground">→</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                className="w-full rounded-md border border-border bg-card px-1.5 py-1 text-[11px] text-foreground" aria-label="Tot" />
            </div>
            <button
              onClick={() => from && to && from <= to && navigateWith({ from, to })}
              disabled={!from || !to || from > to}
              className="mt-1.5 w-full rounded-lg bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground transition disabled:opacity-40"
            >
              Toepassen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Momentopnames: dagelijkse auto-snapshots + handmatig vastleggen; een klik opent
// de cockpit exact zoals de cijfers er op dat moment uitzagen (?snapshot=<id>).
interface SnapMeta { id: number; takenAt: string; takenOn: string; company: string; excluded: string; manual: boolean; revenue: number }
function SnapshotPicker() {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<SnapMeta[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch("/api/cfo/snapshots");
      const d = await r.json();
      setEnabled(d.enabled !== false);
      setList(d.snapshots || []);
    } catch { setErr("Lijst laden mislukt"); }
  }
  function toggle() {
    setOpen((v) => {
      const next = !v;
      if (next && list === null) void load();
      return next;
    });
  }
  async function capture() {
    setBusy(true); setErr(null);
    try {
      const url = new URL(window.location.href);
      const exclude = (url.searchParams.get("exclude") || "").split(",").filter(Boolean);
      const r = await fetch("/api/cfo/snapshots", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: url.searchParams.get("company") || "all", exclude }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
      await load();
    } catch (e) { setErr(String(e).slice(0, 120)); }
    finally { setBusy(false); }
  }

  return (
    <div className="relative">
      <button
        onClick={toggle}
        className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-[11px] font-semibold text-muted-foreground ring-1 ring-border transition hover:text-foreground"
        title="Momentopnames: cijfers zoals op een eerdere dag"
      >
        <History className="h-3 w-3" />
        Momentopnames
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-80 rounded-xl border border-border bg-popover p-2 shadow-xl">
          <div className="flex items-center justify-between px-2 pb-1.5 pt-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Momentopnames</p>
            <button
              onClick={capture}
              disabled={busy || !enabled}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground transition disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Camera className="h-2.5 w-2.5" />}
              Nu vastleggen
            </button>
          </div>
          {!enabled && <p className="px-2 py-1 text-[11px] text-warning">Vereist Postgres (DATABASE_URL) — niet actief in deze omgeving.</p>}
          {err && <p className="px-2 py-1 text-[11px] text-negative">{err}</p>}
          {list === null && enabled && <p className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Laden…</p>}
          {list?.length === 0 && enabled && <p className="px-2 py-2 text-xs text-muted-foreground">Nog geen momentopnames — er komt er automatisch één per dag bij, of leg er nu één vast.</p>}
          {!!list?.length && (
            <div className="max-h-64 overflow-y-auto">
              {list.map((s) => (
                <button
                  key={s.id}
                  onClick={() => { const u = new URL(window.location.href); u.search = `?snapshot=${s.id}`; window.location.href = u.toString(); }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
                  title={`Bekijk de cockpit zoals op ${fmtStamp(s.takenAt)}`}
                >
                  <span className="tabular-nums text-foreground">{s.takenOn.slice(8, 10)}/{s.takenOn.slice(5, 7)}/{s.takenOn.slice(0, 4)}</span>
                  <span className={`rounded px-1 text-[9px] font-semibold uppercase ${s.manual ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>{s.manual ? "handmatig" : "auto"}</span>
                  {s.excluded && <span className="truncate text-[10px] text-warning" title={`excl. ${s.excluded}`}>excl. {s.excluded}</span>}
                  <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{eurAxis(s.revenue)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Consolidatiescope-kiezer: vennootschappen aan/uit in de groepsview. Toepassen
// navigeert met ?exclude=… — de server rekent ALLE cijfers op de scope door
// (per-vennootschap gecachet, dus een scopewissel op warme cache is meteen klaar).
function ScopePicker({ scope }: { scope: NonNullable<CfoFinancials["scope"]> }) {
  const [open, setOpen] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set(scope.excluded));
  const includedCount = scope.all.length - excluded.size;
  const dirty =
    excluded.size !== scope.excluded.length || scope.excluded.some((c) => !excluded.has(c));

  function apply() {
    const codes = [...excluded].sort();
    navigateWith({ exclude: codes.length ? codes.join(",") : null });
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold ring-1 transition ${
          scope.excluded.length
            ? "bg-warning/15 text-warning ring-warning/40"
            : "bg-muted text-muted-foreground ring-border hover:text-foreground"
        }`}
        title="Vennootschappen in/uit de consolidatie"
      >
        <Building2 className="h-3 w-3" />
        Scope {includedCount}/{scope.all.length}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-72 rounded-xl border border-border bg-popover p-2 shadow-xl">
          <p className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Consolidatiescope
          </p>
          <div className="max-h-64 overflow-y-auto">
            {scope.all.map((c) => {
              const included = !excluded.has(c.code);
              return (
                <button
                  key={c.code}
                  onClick={() =>
                    setExcluded((prev) => {
                      const next = new Set(prev);
                      if (next.has(c.code)) next.delete(c.code);
                      else next.add(c.code);
                      return next;
                    })
                  }
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      included ? "border-primary bg-primary text-primary-foreground" : "border-border-strong"
                    }`}
                  >
                    {included && <Check className="h-3 w-3" />}
                  </span>
                  <span className={`truncate ${included ? "text-foreground" : "text-muted-foreground line-through"}`}>
                    {c.name}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">{c.code}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-border px-2 pt-2 pb-1">
            <button
              onClick={() => setExcluded(new Set())}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Alles aan
            </button>
            <button
              onClick={apply}
              disabled={!dirty || includedCount === 0}
              className="rounded-lg bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground transition disabled:opacity-40"
            >
              Toepassen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function CfoCockpit({ data }: { data: CfoFinancials }) {
  const [drill, setDrill] = useState<Drill | null>(null);
  const [eliminateIC, setEliminateIC] = useState(false);
  // P&L-weergave: "brug" = klassieke resultaatbrug (balken zweven op het lopende
  // totaal); "nul" = elke balk vanaf 0 (pure groottes, geen cumulatief verloop).
  const [pnlView, setPnlView] = useState<"brug" | "nul">("brug");
  const k = data.kpis;

  // Thema-bewust palet (light/dark) — kleuren rechtstreeks uit p; helpers krijgen p mee.
  const p = useChartPalette();

  const agingVal = (b: CfoAgingBucket) => (eliminateIC && b.extern != null ? b.extern : b.amount);

  // ---------- chart options ----------
  const waterfall = useMemo<echarts.EChartsOption>(() => {
    const labels: string[] = []; const base: number[] = [];
    const vals: { value: number; itemStyle: { color: string } }[] = [];
    let running = 0;
    for (const line of data.pnl) {
      labels.push(line.label);
      const subColor = line.key === "ebit" || line.key === "net" ? p.positive : p.result;
      if (pnlView === "nul") {
        // "Vanaf nul": elke balk vanaf 0 — hoogte = absolute grootte, kleur = soort.
        base.push(0);
        vals.push({ value: Math.abs(line.amount), itemStyle: { color: line.kind === "income" ? p.income : line.kind === "expense" ? p.expense : subColor } });
        continue;
      }
      // "Brug" (standaard resultaatbrug): balken zweven op het lopende totaal.
      if (line.kind === "income") { base.push(running); vals.push({ value: line.amount, itemStyle: { color: p.income } }); running += line.amount; }
      else if (line.kind === "expense") { const mag = -line.amount; base.push(running - mag); vals.push({ value: mag, itemStyle: { color: p.expense } }); running -= mag; }
      else { base.push(0); vals.push({ value: line.amount, itemStyle: { color: subColor } }); }
    }
    return {
      grid: { top: 28, left: 6, right: 14, bottom: 88, containLabel: true },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => formatCurrency(Number(v)) },
      xAxis: { type: "category", data: labels, axisLabel: { color: p.text, interval: 0, rotate: 36, fontSize: 9.5 }, axisLine: { lineStyle: { color: p.axis } }, axisTick: { show: false } },
      yAxis: { type: "value", axisLabel: { color: p.textMuted, formatter: (v: number) => eurAxis(v) }, splitLine: { lineStyle: { color: p.grid } } },
      series: [
        { name: "base", type: "bar", stack: "t", itemStyle: { color: "transparent" }, emphasis: { disabled: true }, data: base, silent: true, tooltip: { show: false } },
        { name: "P&L", type: "bar", stack: "t", data: vals, barMaxWidth: 46, label: { show: true, position: "top", color: p.text, fontSize: 10, formatter: (pl: LP) => eurAxis(Number(pl.value)) } },
      ],
    };
  }, [data.pnl, pnlView, p]);

  const donut = useMemo<echarts.EChartsOption>(() => ({
    tooltip: { trigger: "item", valueFormatter: (v) => formatCurrency(Number(v)) },
    series: [{
      type: "pie", radius: ["54%", "80%"], center: ["50%", "48%"], avoidLabelOverlap: true,
      itemStyle: { borderColor: p.surface, borderWidth: 2 },
      label: { color: p.text, fontSize: 10, formatter: (pl: LP) => `${pl.name}\n${eurAxis(Number(pl.value))}` },
      data: data.costStructure.map((c, i) => ({ name: c.accountName, value: c.amount, _class: c.accountNumber, itemStyle: { color: p.categorical[i % p.categorical.length] } })),
    }],
  }), [data.costStructure, p]);

  const monthly = useMemo<echarts.EChartsOption>(() => {
    const series: echarts.SeriesOption[] = [
      { name: "Opbrengsten", type: "bar", data: data.monthly.map((m) => m.revenue), itemStyle: { color: p.income, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 20 },
      { name: "Kosten", type: "bar", data: data.monthly.map((m) => m.costs), itemStyle: { color: p.expense, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 20 },
      { name: "Resultaat", type: "line", data: data.monthly.map((m) => m.result), itemStyle: { color: p.positive }, lineStyle: { width: 2 }, symbol: "circle", symbolSize: 6 },
    ];
    const legend = ["Opbrengsten", "Kosten", "Resultaat"];
    if (data.budget?.configured && data.budget.monthlyRevenueTarget) {
      series.push({ name: "Doel omzet", type: "line", data: data.monthly.map(() => data.budget!.monthlyRevenueTarget), itemStyle: { color: p.budget }, lineStyle: { width: 1.5, type: "dashed" }, symbol: "none" });
      legend.push("Doel omzet");
    }
    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => formatCurrency(Number(v)) },
      legend: { data: legend, textStyle: { color: p.text }, top: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10 },
      grid: { top: 36, left: 6, right: 8, bottom: 20, containLabel: true },
      xAxis: { type: "category", data: data.monthly.map((m) => m.month.slice(5)), axisLabel: { color: p.text }, axisLine: { lineStyle: { color: p.axis } }, axisTick: { show: false } },
      yAxis: { type: "value", axisLabel: { color: p.textMuted, formatter: (v: number) => eurAxis(v) }, splitLine: { lineStyle: { color: p.grid } } },
      series,
    };
  }, [data.monthly, data.budget, p]);

  // Maand × kostenklasse heatmap. Kleur = aandeel binnen de eigen klasse-rij
  // (elke rij zijn eigen schaal — 61 is 20× groter dan 64), label = echt bedrag.
  const heat = useMemo<echarts.EChartsOption | null>(() => {
    const months = data.monthly.filter((m) => m.byClass && Object.keys(m.byClass).length);
    if (months.length < 2) return null;
    const xLabels = months.map((m) => m.month.slice(5));
    const rows = HEAT_CLASSES.filter((c) => months.some((m) => (m.byClass?.[c] || 0) !== 0));
    const cells: { value: [number, number, number]; raw: number }[] = [];
    for (let yi = 0; yi < rows.length; yi++) {
      const rowMax = Math.max(...months.map((m) => Math.abs(m.byClass?.[rows[yi]] || 0)), 1);
      for (let xi = 0; xi < months.length; xi++) {
        const raw = months[xi].byClass?.[rows[yi]] || 0;
        cells.push({ value: [xi, yi, Math.round((Math.abs(raw) / rowMax) * 100) / 100], raw });
      }
    }
    return {
      tooltip: {
        formatter: (pr: unknown) => {
          const v = (pr as { data: { value: [number, number, number]; raw: number } }).data;
          const cls = rows[v.value[1]];
          const mo = months[v.value[0]];
          const share = mo.costs ? Math.round((v.raw / mo.costs) * 1000) / 10 : 0;
          return `${CLASS_LABEL[cls] || cls} · ${mo.month}<br/><b>${formatCurrency(v.raw)}</b> · ${share}% van de maandkosten`;
        },
      },
      grid: { top: 8, left: 6, right: 8, bottom: 20, containLabel: true },
      xAxis: { type: "category", data: xLabels, axisLabel: { color: p.text, fontSize: 10 }, axisLine: { lineStyle: { color: p.axis } }, axisTick: { show: false }, splitArea: { show: false } },
      yAxis: { type: "category", data: rows.map((c) => `${c} · ${CLASS_LABEL[c] || c}`), axisLabel: { color: p.text, fontSize: 10 }, axisLine: { lineStyle: { color: p.axis } }, axisTick: { show: false } },
      visualMap: { show: false, min: 0, max: 1, inRange: { color: [p.surface, p.income] } },
      series: [{
        type: "heatmap", data: cells,
        label: { show: true, fontSize: 9, formatter: (pr: LP) => eurAxis((pr.data as { raw: number }).raw), color: p.text },
        itemStyle: { borderColor: p.surface, borderWidth: 2, borderRadius: 3 },
        emphasis: { itemStyle: { shadowBlur: 8, shadowColor: "rgba(0,0,0,0.35)" } },
      }],
    };
  }, [data.monthly, p]);

  const apAging = useMemo(() => buildAgingOption(data.apAging, eliminateIC, p), [data.apAging, eliminateIC, p]);
  const arAging = useMemo(() => (data.arAging ? buildAgingOption(data.arAging, eliminateIC, p) : null), [data.arAging, eliminateIC, p]);

  const forecast = useMemo<echarts.EChartsOption | null>(() => {
    const f = data.cashForecast; if (!f) return null;
    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => formatCurrency(Number(v)) },
      legend: { data: ["Inkomend", "Uitgaand", "Eindsaldo"], textStyle: { color: p.text }, top: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10 },
      grid: { top: 36, left: 6, right: 8, bottom: 20, containLabel: true },
      xAxis: { type: "category", data: f.weeks.map((w) => w.label), axisLabel: { color: p.text, fontSize: 9 }, axisLine: { lineStyle: { color: p.axis } }, axisTick: { show: false } },
      yAxis: { type: "value", axisLabel: { color: p.textMuted, formatter: (v: number) => eurAxis(v) }, splitLine: { lineStyle: { color: p.grid } } },
      series: [
        { name: "Inkomend", type: "bar", stack: "cf", data: f.weeks.map((w) => w.inflow), itemStyle: { color: p.income } },
        { name: "Uitgaand", type: "bar", stack: "cf", data: f.weeks.map((w) => -w.outflow), itemStyle: { color: p.expense } },
        {
          name: "Eindsaldo", type: "line", data: f.weeks.map((w) => w.closing), itemStyle: { color: p.positive }, lineStyle: { width: 2 }, symbol: "circle", symbolSize: 5,
          markLine: { silent: true, symbol: "none", lineStyle: { color: p.negative, type: "dashed" }, data: [{ yAxis: 0 }] },
        },
      ],
    };
  }, [data.cashForecast, p]);

  // ---------- drill handlers ----------
  // Rekening → boekingen (laziest niveau, per rekening gefetcht en gecachet in state).
  const [glOpenFor, setGlOpenFor] = useState<string | null>(null);
  const [glByAccount, setGlByAccount] = useState<Record<string, GlDrill>>({});
  const resetGl = () => setGlOpenFor(null);

  async function toggleGlEntries(accountNumber: string) {
    if (glOpenFor === accountNumber) { setGlOpenFor(null); return; }
    setGlOpenFor(accountNumber);
    if (glByAccount[accountNumber]?.entries || glByAccount[accountNumber]?.loading) return;
    setGlByAccount((m) => ({ ...m, [accountNumber]: { loading: true } }));
    try {
      const params = new URLSearchParams({ account: accountNumber, from: data.period.from, to: data.period.to });
      if (data.scope?.excluded.length) params.set("exclude", data.scope.excluded.join(","));
      const res = await fetch(`/api/cfo/gl?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setGlByAccount((m) => ({ ...m, [accountNumber]: { loading: false, entries: d.entries, count: d.count, total: d.total, capped: d.capped, accountLinks: d.accountLinks, note: d.note } }));
    } catch (e) {
      setGlByAccount((m) => ({ ...m, [accountNumber]: { loading: false, error: String(e).slice(0, 120) } }));
    }
  }

  const drillLine = (line: CfoPnlLine) => { resetGl(); setDrill({
    title: line.label,
    subtitle: line.pnlClass ? `PCMN-klasse ${line.pnlClass} · bron: Business Central grootboek` : "Subtotaal",
    total: Math.abs(line.amount),
    rows: line.accounts.map((a) => ({ label: `${a.accountNumber} · ${a.accountName}`, value: a.amount, accountNumber: a.accountNumber })),
    note: line.accounts.length ? "De grootboekrekeningen die deze regel vormen — klik een rekening voor de individuele boekingen, met doorklik naar Business Central." : "Subtotaal — berekend uit de regels erboven.",
  }); };
  const onWaterfall = (p: EChartClick) => { if (typeof p.dataIndex === "number" && data.pnl[p.dataIndex]) drillLine(data.pnl[p.dataIndex]); };
  const onDonut = (p: EChartClick) => { const cls = (p.data as { _class?: string } | undefined)?._class; const line = data.pnl.find((l) => l.pnlClass === cls); if (line) drillLine(line); };
  // Aging-buckets drillen tot op de open post, met BC-deeplink per document.
  const bucketItems = (b: CfoAgingBucket) => (b.items || []).filter((it) => !eliminateIC || !it.ic);
  const onApAging = (p: EChartClick) => { const b = data.apAging.find((x) => x.label === p.name); if (b) { resetGl(); setDrill({ title: `Leveranciers — ${b.label}`, subtitle: "Open leveranciersposten (VendorLedgerEntries)", total: agingVal(b), rows: b.extern != null ? [{ label: "Extern", value: b.extern }, { label: "Intercompany", value: b.amount - b.extern }] : [], items: bucketItems(b), itemsCount: b.itemCount, note: "Grootste open posten hieronder — ↗ opent de post in Business Central. Volledig detail: export 'Leveranciersaging'." }); } };
  const onArAging = (p: EChartClick) => { const b = data.arAging?.find((x) => x.label === p.name); if (b) { resetGl(); setDrill({ title: `Klanten — ${b.label}`, subtitle: "Open verkoopfacturen (salesInvoices)", total: agingVal(b), rows: b.extern != null ? [{ label: "Extern", value: b.extern }, { label: "Intercompany", value: b.amount - b.extern }] : [], items: bucketItems(b), itemsCount: b.itemCount, note: "Grootste open facturen hieronder — ↗ opent de factuur in Business Central." }); } };
  const onForecastWeek = (p: EChartClick) => {
    const f = data.cashForecast; if (!f || typeof p.dataIndex !== "number") return; const w = f.weeks[p.dataIndex]; if (!w) return;
    setDrill({ title: `Cashflow ${w.label}`, subtitle: `week van ${w.weekStart}`, total: w.closing, rows: [{ label: "Inkomend (klanten)", value: w.inflow }, { label: "Uitgaand (leveranciers + loon)", value: -w.outflow }, { label: "Netto", value: w.net }, { label: "Verwacht eindsaldo", value: w.closing }], note: "Projectie op basis van vervaldata." });
  };
  const onHeatCell = (pr: EChartClick) => {
    const v = (pr.data as { value?: [number, number, number]; raw?: number }) || {};
    if (!v.value) return;
    const months = data.monthly.filter((m) => m.byClass && Object.keys(m.byClass).length);
    const rows = HEAT_CLASSES.filter((c) => months.some((m) => (m.byClass?.[c] || 0) !== 0));
    const cls = rows[v.value[1]]; const mo = months[v.value[0]];
    if (!cls || !mo) return;
    const vals = months.map((m) => m.byClass?.[cls] || 0);
    const avg = vals.reduce((s, x) => s + x, 0) / Math.max(1, vals.length);
    resetGl();
    setDrill({
      title: `${CLASS_LABEL[cls] || cls} — ${mo.month}`,
      subtitle: `PCMN-klasse ${cls} in ${mo.month}`,
      total: Math.abs(v.raw || 0),
      rows: [
        { label: "Deze maand", value: v.raw || 0 },
        { label: "Gemiddelde per maand", value: Math.round(avg) },
        { label: "Afwijking vs gemiddelde", value: Math.round((v.raw || 0) - avg) },
      ],
      note: "De rekeningen achter deze klasse: klik de overeenkomstige balk in de P&L-brug (periode-totaal, met boekingen + BC-links).",
    });
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
    { label: "Bedrijfsopbrengsten", value: formatCurrencyCompact(k.revenue), sub: data.period.label, icon: ArrowUpCircle, accent: "text-primary", ring: "ring-primary/20", glow: "from-primary/15", delta: pct(k.revenue, py?.revenue) },
    { label: "EBITDA", value: formatCurrencyCompact(k.ebitda), sub: `${k.revenue ? Math.round((k.ebitda / k.revenue) * 1000) / 10 : 0}% van omzet`, icon: Activity, accent: "text-warning", ring: "ring-warning/20", glow: "from-warning/15", delta: pct(k.ebitda, py?.ebitda) },
    { label: "EBIT", value: formatCurrencyCompact(k.operatingResult), sub: `marge ${k.operatingMarginPct}%`, icon: TrendingUp, accent: "text-positive", ring: "ring-positive/20", glow: "from-positive/15", delta: pct(k.operatingResult, py?.ebit) },
    { label: "Nettoresultaat", value: formatCurrencyCompact(k.netResult), sub: "na financieel & belastingen", icon: Landmark, accent: "text-positive", ring: "ring-positive/20", glow: "from-positive/15", delta: pct(k.netResult, py?.netResult) },
    { label: "Cashpositie", value: formatCurrencyCompact(k.cash), sub: "banksaldo (klasse 55)", icon: Wallet, accent: "text-primary", ring: "ring-primary/20", glow: "from-primary/15" },
    { label: "Te betalen (AP)", value: formatCurrencyCompact(apShown), sub: eliminateIC ? "extern" : "incl. intercompany", icon: ArrowDownCircle, accent: "text-negative", ring: "ring-negative/20", glow: "from-negative/15" },
    { label: "Te ontvangen (AR)", value: arShown ? formatCurrencyCompact(arShown) : "—", sub: eliminateIC ? "extern" : "incl. intercompany", icon: ArrowUpCircle, accent: "text-primary", ring: "ring-primary/20", glow: "from-primary/15" },
  ];

  const r = data.ratios;
  // Elke ratio draagt zijn formule + benaderings-caveat als tooltip — een CFO moet
  // kunnen zien WAT er gedeeld wordt voor die op een ratio stuurt.
  const ratioTiles = r ? [
    { label: "Current ratio", value: r.currentRatio.toFixed(2), tone: r.currentRatio >= 1.2 ? "emerald" : r.currentRatio >= 1 ? "amber" : "rose",
      hint: "(kas + handelsvorderingen + voorraad) ÷ handelsschulden. LET OP: kortlopende financiële/fiscale schulden (43x/45x) zitten niet in de noemer — werkelijke ratio ligt lager." },
    { label: "Quick ratio", value: r.quickRatio.toFixed(2), tone: r.quickRatio >= 1 ? "emerald" : r.quickRatio >= 0.8 ? "amber" : "rose",
      hint: "(kas + handelsvorderingen) ÷ handelsschulden, zonder voorraad. Zelfde caveat als current ratio." },
    { label: "Solvabiliteit", value: `${r.solvencyPct}%`, tone: r.solvencyPct >= 30 ? "emerald" : r.solvencyPct >= 20 ? "amber" : "rose",
      hint: "Eigen vermogen (klasse 1) ÷ benaderde activa (kl. 2 + 3 + AR + kas). Condensed — geen volledige balans." },
    { label: "DSO (klanten)", value: `${r.dso} d`, tone: "sky",
      hint: "Open AR ÷ omzet × verstreken dagen. AR is incl. btw, omzet excl. — dagen licht overschat." },
    { label: "DPO (leveranciers)", value: `${r.dpo} d`, tone: "sky",
      hint: "Open AP ÷ inkopen (klasse 60/61/64) × verstreken dagen. Bezoldigingen/afschrijvingen tellen niet mee (lopen niet via leveranciers)." },
    { label: "Cash conversion", value: `${r.ccc} d`, tone: r.ccc <= 0 ? "emerald" : "amber",
      hint: "DSO + DIO − DPO: dagen tussen geld uitgeven en geld innen. Negatief = leveranciers financieren de cyclus." },
  ] : [];
  const toneClass: Record<string, string> = { emerald: "text-positive", amber: "text-warning", rose: "text-negative", sky: "text-primary" };

  const bs = data.balanceSheet;
  const bsMax = bs ? Math.max(bs.totalAssets, bs.totalClaims, 1) : 1;

  return (
    <div className="min-h-full -m-6 p-6 lg:-m-8 lg:p-8 bg-[radial-gradient(1200px_600px_at_20%_-10%,rgba(47,189,138,0.07),transparent),radial-gradient(1000px_500px_at_100%_0%,rgba(224,182,74,0.05),transparent)]">
      {/* Hero */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 ring-1 ring-border">
            <Landmark className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Financiële Cockpit</h1>
            <p className="text-sm text-muted-foreground">
              {data.company === "all"
                ? data.scope?.excluded.length
                  ? `${data.scope.all.length - data.scope.excluded.length} van ${data.scope.all.length} vennootschappen · geconsolideerd (bruto) · excl. ${data.scope.excluded.join(", ")}`
                  : "Alle vennootschappen · geconsolideerd (bruto)"
                : `Vennootschap ${data.company}`} · {data.period.label}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {data.isLive ? `Data opgehaald: ${fmtStamp(data.generatedAt)}` : "Voorbeelddata"}
              {" · "}
              <a
                href={`/cfo?refresh=1${data.scope?.excluded.length ? `&exclude=${data.scope.excluded.join(",")}` : ""}`}
                className="text-primary hover:text-primary/80 underline underline-offset-2"
              >vernieuwen</a>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodPicker label={data.period.label} />
          {data.scope && data.company === "all" && <ScopePicker scope={data.scope} />}
          <SnapshotPicker />
          <button
            onClick={() => setEliminateIC((v) => !v)}
            className={`rounded-full px-3 py-1 text-[11px] font-semibold ring-1 transition ${eliminateIC ? "bg-primary/15 text-primary ring-primary/40" : "bg-muted text-muted-foreground ring-border hover:text-foreground"}`}
            title="Intercompany-posten uit AP/AR verwijderen"
          >
            {eliminateIC ? "✓ Intercompany geëlimineerd" : "Intercompany elimineren"}
          </button>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide ${data.isLive ? "bg-positive/15 text-positive ring-1 ring-positive/30" : "bg-warning/15 text-warning ring-1 ring-warning/30"}`}>
            {data.isLive ? "LIVE · Business Central" : "DEMO · voorbeelddata"}
          </span>
          <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground ring-1 ring-border">ECharts · IBCS</span>
        </div>
      </div>

      {/* Momentopname-banner: bevroren weergave, nooit met live te verwarren */}
      {data.snapshotOf && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm text-warning">
          <History className="h-4 w-4 shrink-0" />
          <span><strong>Momentopname van {fmtStamp(data.snapshotOf)}</strong> — bevroren weergave; wijzigingen in BC sinds die dag zitten hier niet in.</span>
          <a href="/cfo" className="ml-auto shrink-0 rounded-lg bg-warning/20 px-2.5 py-1 text-[11px] font-semibold underline-offset-2 hover:underline">Terug naar live</a>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        {kpis.map((t) => (
          <div key={t.label} className={`relative overflow-hidden rounded-2xl border border-border bg-card p-4 ring-1 ${t.ring} backdrop-blur`}>
            <div className={`pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-gradient-to-br ${t.glow} to-transparent blur-2xl`} />
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t.label}</span>
              <t.icon className={`h-4 w-4 ${t.accent}`} />
            </div>
            <div className={`mt-2 text-xl font-bold ${t.accent}`}>{t.value}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{t.sub}</div>
            {t.delta != null && (
              <div className={`mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${t.delta >= 0 ? "bg-positive/10 text-positive" : "bg-negative/10 text-negative"}`}>
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
            <div key={t.label} className="group/ratio rounded-xl border border-border bg-card px-3 py-2.5" title={t.hint}>
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                {t.label}
                <Info className="h-2.5 w-2.5 opacity-0 transition-opacity group-hover/ratio:opacity-60" />
              </div>
              <div className={`mt-1 text-lg font-bold ${toneClass[t.tone]}`}>{t.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Eerlijkheid eerst: live-load mislukt of achtergrond-vernieuwing bezig */}
      {data.loadError && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-negative/30 bg-negative/10 px-4 py-2.5 text-sm text-negative">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span><strong>Live laden uit Business Central is mislukt</strong> — onderstaande cijfers zijn VOORBEELDDATA. Reden: {data.loadError}</span>
        </div>
      )}
      {data.refreshing && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm text-primary">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          Vernieuwing gestart — de data wordt op de achtergrond vers uit BC getrokken (± 2 min). Herlaad de pagina straks; tot dan zie je de vorige stand.
        </div>
      )}

      {/* Cash-crunch banner */}
      {data.cashForecast && data.cashForecast.lowestClosing < 0 && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-negative/30 bg-negative/10 px-4 py-2.5 text-sm text-negative">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Verwacht negatief kassaldo in {data.cashForecast.lowestWeekLabel} ({formatCurrency(data.cashForecast.lowestClosing)}) — cashkrap.
        </div>
      )}

      {/* Main grid */}
      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Winst & verlies — brug naar nettoresultaat" hint="Klik een balk voor de brongegevens" source="PCMN-klasse 6 & 7 · BC grootboek">
            <div className="mb-2 flex items-center gap-1.5">
              {(["brug", "nul"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setPnlView(v)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 transition ${pnlView === v ? "bg-primary/15 text-primary ring-primary/40" : "bg-muted text-muted-foreground ring-border hover:text-foreground"}`}
                >
                  {v === "brug" ? "Brug (waterfall)" : "Vanaf nul"}
                </button>
              ))}
              <span className="ml-2 text-[10px] text-muted-foreground">
                {pnlView === "brug"
                  ? "elke balk start waar de vorige eindigde — het cumulatieve pad van omzet naar netto"
                  : "elke balk vanaf 0 — pure groottes, geen cumulatief verloop"}
              </span>
            </div>
            <EChart option={waterfall} height={360} onSelect={onWaterfall} ariaLabel="P&L waterfall" />
            <Legend items={[["Opbrengsten", p.income], ["Kosten", p.expense], ["EBITDA / vóór belastingen", p.result], ["EBIT / Nettoresultaat", p.positive]]} />
          </Card>

          {forecast && (
            <Card title="13-weken cashflowprognose (directe methode)" hint="Klik een week" source="Openstaande AR/AP op vervaldatum + loon">
              <EChart option={forecast} height={300} onSelect={onForecastWeek} ariaLabel="13-week cash forecast" />
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                <span>Openingssaldo: <span className="text-foreground">{formatCurrency(data.cashForecast!.openingCash)}</span></span>
                <span>Laagste punt: <span className={data.cashForecast!.lowestClosing < 0 ? "text-negative" : "text-foreground"}>{formatCurrency(data.cashForecast!.lowestClosing)}</span> ({data.cashForecast!.lowestWeekLabel})</span>
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

          {heat && (
            <Card title="Kosten per klasse per maand" hint="Klik een cel — kleur = t.o.v. de eigen klasse" source="Klasse 60–64 per maand · BC grootboek">
              <EChart option={heat} height={240} onSelect={onHeatCell} ariaLabel="Kosten heatmap per klasse per maand" />
              {!!data.budget?.classVariance?.length && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">vs jaardoel (pro rata):</span>
                  {data.budget.classVariance.map((cv) => (
                    <span
                      key={cv.cls}
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${cv.variancePct > 2 ? "bg-negative/10 text-negative" : cv.variancePct < -2 ? "bg-positive/10 text-positive" : "bg-muted text-muted-foreground"}`}
                      title={`${cv.label}: YTD ${formatCurrency(cv.actual)} vs pro-rata doel ${formatCurrency(cv.proRata)} (jaardoel ${formatCurrency(cv.target)})`}
                    >
                      {cv.cls} {cv.variancePct >= 0 ? "▲" : "▼"} {Math.abs(cv.variancePct)}%
                    </span>
                  ))}
                </div>
              )}
            </Card>
          )}
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
                <BalanceCol title="Activa" total={bs.totalAssets} lines={bs.assets} max={bsMax} color={p.categorical[1]} />
                <BalanceCol title="Passiva & eigen vermogen" total={bs.totalClaims} lines={bs.claims} max={bsMax} color={p.categorical[4]} />
              </div>
              {!bs.complete && <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground"><Scale className="h-3 w-3" /> Condensed — volledige balans (fin. schulden, overige) via de gematerialiseerde snapshot.</p>}
            </Card>
          )}

          <Card title="Per vennootschap" hint="Klik een rij" source="Operationeel resultaat per entiteit">
            <div className="max-h-[300px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background/80 text-[11px] uppercase tracking-wider text-muted-foreground backdrop-blur">
                  <tr><th className="px-2 py-1.5 text-left font-medium">Firma</th><th className="px-2 py-1.5 text-right font-medium">Omzet</th><th className="px-2 py-1.5 text-right font-medium">EBIT</th><th className="px-2 py-1.5 text-right font-medium">Marge</th></tr>
                </thead>
                <tbody>
                  {data.entities.map((e) => (
                    <tr key={e.code} onClick={() => onEntity(e)} className="cursor-pointer border-t border-border hover:bg-muted">
                      <td className="px-2 py-1.5 text-foreground">{e.code}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{formatCurrencyCompact(e.revenue)}</td>
                      <td className={`px-2 py-1.5 text-right tabular-nums ${e.result >= 0 ? "text-positive" : "text-negative"}`}>{formatCurrencyCompact(e.result)}</td>
                      <td className={`px-2 py-1.5 text-right tabular-nums ${e.marginPct >= 0 ? "text-foreground" : "text-negative"}`}>{e.marginPct}%</td>
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
          <div className="rounded-2xl border border-border bg-card p-5 backdrop-blur">
            <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground"><Download className="h-4 w-4 text-primary" /> Exports — live uit Business Central</h3>
            <p className="mb-3 text-[11px] text-muted-foreground">Elke export bevat de pull-timestamp (bestandsnaam + titelblad), zodat altijd duidelijk is van wanneer de data is.</p>
            <div className="space-y-2">
              <ExportButton kind="ap" label="Leveranciersaging (Excel)" />
              <ExportButton kind="ar" label="Klantenaging (Excel)" />
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5 backdrop-blur">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Info className="h-4 w-4 text-primary" /> Bron &amp; detail</h3>
              {drill && <button onClick={() => { setDrill(null); resetGl(); }} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Sluiten"><X className="h-4 w-4" /></button>}
            </div>
            {drill ? (
              <div>
                <div className="text-base font-bold text-foreground">{drill.title}</div>
                {drill.subtitle && <div className="mt-0.5 text-xs text-muted-foreground">{drill.subtitle}</div>}
                {typeof drill.total === "number" && <div className="mt-2 text-2xl font-bold text-primary">{formatCurrency(drill.total)}</div>}
                {drill.rows.length > 0 && (
                  <div className="mt-3 divide-y divide-border rounded-xl border border-border">
                    {drill.rows.map((row, i) => {
                      const acc = row.accountNumber;
                      const open = acc != null && glOpenFor === acc;
                      const gl = acc != null ? glByAccount[acc] : undefined;
                      return (
                        <div key={i}>
                          {acc ? (
                            <button
                              onClick={() => toggleGlEntries(acc)}
                              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
                              title="Toon de individuele boekingen op deze rekening"
                            >
                              <span className="flex min-w-0 items-center gap-1.5">
                                <ChevronRight className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
                                <span className="truncate text-foreground">{row.label}</span>
                              </span>
                              <span className={`shrink-0 tabular-nums ${row.value >= 0 ? "text-foreground" : "text-negative"}`}>{formatCurrency(row.value)}</span>
                            </button>
                          ) : (
                            <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                              <span className="truncate text-foreground">{row.label}</span>
                              <span className={`shrink-0 tabular-nums ${row.value >= 0 ? "text-foreground" : "text-negative"}`}>{formatCurrency(row.value)}</span>
                            </div>
                          )}
                          {open && (
                            <div className="border-t border-border bg-muted/40 px-3 py-2">
                              {gl?.loading && (
                                <p className="flex items-center gap-2 py-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Boekingen ophalen uit BC…</p>
                              )}
                              {gl?.error && <p className="py-1 text-xs text-negative">Ophalen mislukt: {gl.error}</p>}
                              {gl?.entries && (
                                <>
                                  <div className="max-h-56 space-y-0.5 overflow-y-auto">
                                    {gl.entries.slice(0, 60).map((e, j) => (
                                      <div key={j} className="flex items-center gap-2 rounded px-1 py-1 text-[11px] hover:bg-accent">
                                        <span className="shrink-0 tabular-nums text-muted-foreground">{e.date.slice(8, 10)}/{e.date.slice(5, 7)}</span>
                                        <span className="shrink-0 rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">{e.company}</span>
                                        <span className="min-w-0 flex-1 truncate text-foreground" title={`${e.documentNumber} · ${e.description}`}>{e.description || e.documentNumber}</span>
                                        <span className={`shrink-0 tabular-nums ${e.amount >= 0 ? "text-foreground" : "text-negative"}`}>{formatCurrency(e.amount)}</span>
                                        <a
                                          href={e.bcUrl} target="_blank" rel="noopener noreferrer"
                                          className="shrink-0 text-muted-foreground transition-colors hover:text-primary"
                                          title={`Open document ${e.documentNumber} in Business Central (${e.company})`}
                                          onClick={(ev) => ev.stopPropagation()}
                                        >
                                          <ExternalLink className="h-3 w-3" />
                                        </a>
                                      </div>
                                    ))}
                                  </div>
                                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-1.5 text-[10px] text-muted-foreground">
                                    <span>{gl.count} posten · som {formatCurrency(gl.total ?? 0)}{gl.capped || (gl.entries.length > 60) ? ` · grootste ${Math.min(60, gl.entries.length)} getoond` : ""}</span>
                                    {gl.accountLinks?.map((l) => (
                                      <a key={l.company} href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:text-primary/80" title={`Alle posten van rekening ${acc} in BC (${l.company})`}>
                                        {l.company} <ExternalLink className="h-2.5 w-2.5" />
                                      </a>
                                    ))}
                                  </div>
                                  {gl.note && <p className="mt-1 text-[10px] text-warning">{gl.note}</p>}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {!!drill.items?.length && (
                  <div className="mt-3 rounded-xl border border-border">
                    <div className="max-h-64 space-y-0.5 overflow-y-auto p-2">
                      {drill.items.map((it, j) => (
                        <div key={j} className="flex items-center gap-2 rounded px-1 py-1 text-[11px] hover:bg-accent">
                          <span className="shrink-0 tabular-nums text-muted-foreground" title={`vervaldatum ${it.due || "onbekend"}`}>
                            {it.due ? `${it.due.slice(8, 10)}/${it.due.slice(5, 7)}` : "—"}
                          </span>
                          <span className="shrink-0 rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">{it.company}</span>
                          <span className="min-w-0 flex-1 truncate text-foreground" title={`${it.docNo} · ${it.name}`}>
                            {it.name}
                            {it.ic && <span className="ml-1 rounded bg-warning/15 px-1 text-[9px] font-semibold uppercase text-warning">IC</span>}
                          </span>
                          <span className={`shrink-0 tabular-nums ${it.amount >= 0 ? "text-foreground" : "text-negative"}`}>{formatCurrency(it.amount)}</span>
                          {it.bcUrl ? (
                            <a href={it.bcUrl} target="_blank" rel="noopener noreferrer"
                              className="shrink-0 text-muted-foreground transition-colors hover:text-primary"
                              title={`Open ${it.docNo} in Business Central (${it.company})`}>
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : <span className="w-3 shrink-0" />}
                        </div>
                      ))}
                    </div>
                    {drill.itemsCount != null && drill.itemsCount > drill.items.length && (
                      <p className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
                        Grootste {drill.items.length} van {drill.itemsCount} posten getoond — volledig detail via de aging-export.
                      </p>
                    )}
                  </div>
                )}
                {drill.note && <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{drill.note}</p>}
              </div>
            ) : (
              <div>
                <p className="text-xs leading-relaxed text-muted-foreground">Klik op een balk, segment, bucket, week of rij om door te klikken naar de onderliggende grootboekrekeningen en de exacte brondata.</p>
                <div className="mt-4 space-y-3">
                  {data.sources.map((s) => (
                    <div key={s.label} className="rounded-xl border border-border bg-card p-3">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground"><ChevronRight className="h-3 w-3 text-primary" />{s.label}</div>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{s.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {data.budget?.configured && (
              <div className="mt-5 rounded-xl border border-border bg-card p-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground"><CalendarClock className="h-3 w-3 text-primary" /> Budget vs. actual</div>
                <p className="mt-1 text-[11px] text-muted-foreground">Omzet {data.budget.revenueVariancePct >= 0 ? "+" : ""}{data.budget.revenueVariancePct}% vs. pro-rata doel · resultaat {data.budget.resultVariancePct >= 0 ? "+" : ""}{data.budget.resultVariancePct}%.</p>
              </div>
            )}
            {data.notes.length > 0 && (
              <div className="mt-5 border-t border-border pt-4">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Aannames</div>
                <ul className="space-y-1.5">
                  {data.notes.map((n, i) => <li key={i} className="flex gap-1.5 text-[11px] leading-relaxed text-muted-foreground"><span className="text-muted-foreground/70">•</span>{n}</li>)}
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
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-muted px-3 py-2.5 text-left text-sm font-medium text-foreground transition hover:bg-primary/10 hover:text-primary disabled:opacity-60"
      >
        <span>{label}</span>
        {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" /> : <Download className="h-4 w-4 shrink-0 text-primary" />}
      </button>
      {busy && <p className="mt-1 text-[10px] text-muted-foreground">Live aan het trekken uit BC (alle vennootschappen) — kan ± 1 min duren…</p>}
      {pulledAt && !busy && <p className="mt-1 text-[10px] text-positive">✓ Data getrokken op {pulledAt}</p>}
      {error && !busy && <p className="mt-1 text-[10px] text-negative">{error}</p>}
    </div>
  );
}

// ---- helpers ----
function Card({ title, hint, source, children }: { title: string; hint?: string; source?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 backdrop-blur">
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {hint && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-border">{hint}</span>}
      </div>
      {children}
      {source && <p className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground/70">Bron: {source}</p>}
    </section>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
      {items.map(([label, color]) => (
        <span key={label} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
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
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
        <span className="text-sm font-bold text-foreground tabular-nums">{formatCurrencyCompact(total)}</span>
      </div>
      <div className="space-y-2">
        {lines.map((l) => (
          <div key={l.label}>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">{l.label}</span>
              <span className="tabular-nums text-foreground">{formatCurrencyCompact(l.amount)}</span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, (Math.abs(l.amount) / max) * 100)}%`, background: color }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
