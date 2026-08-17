"use client";

import { useEffect, useMemo, useState } from "react";
import * as echarts from "echarts";
import type { CfoFinancials, CfoPnlLine, CfoEntityRow, CfoAgingBucket, CfoAgingItem } from "@/lib/types";
import type { CfoUnits } from "@/lib/units";
import { EChart, type EChartClick } from "./echart";
import { FullBalanceCard } from "./full-balance-card";
import { ConsolidatedCard } from "./consolidated-card";
import { usePolledData, fmtDate } from "./cfo-ui";
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

// Week-labels: geen kale "wk 07" (ambigu) — altijd de maandag van de week erbij.
function fmtDM(iso: string): string { return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : ""; }

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

// pnlKey = cascade-stap: de rij opent de onderliggende P&L-regel (klasse → rekeningen
// → boekingen → BC-link) — zo drillt een KPI-tegel gelaagd door tot in Business Central.
interface DrillRow { label: string; value: number; accountNumber?: string; pnlKey?: string }
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
function PeriodPicker({ label, prominent = false }: { label: string; prominent?: boolean }) {
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
        className={prominent
          ? "inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground shadow-sm ring-1 ring-primary/40 transition hover:opacity-90"
          : "inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-[11px] font-semibold text-muted-foreground ring-1 ring-border transition hover:text-foreground"}
        title="Periode van de cockpit wijzigen — P&L, ratio's en grafieken rekenen op deze periode"
      >
        <CalendarClock className={prominent ? "h-3.5 w-3.5" : "h-3 w-3"} />
        {label}
        <ChevronDown className={`${prominent ? "h-3.5 w-3.5" : "h-3 w-3"} transition-transform ${open ? "rotate-180" : ""}`} />
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

// ---------------------------------------------------------------------------
// Leasing & huur rollend materieel (spec Birgit, finance 24/07/2026).
// Lazy geladen uit /api/cfo/leasing; rekening-klik drillt naar de boekingen.
// ---------------------------------------------------------------------------
const LEASE_LABELS: Record<string, string> = {
  "610200": "Huur motorvoertuigen",
  "610250": "Huur getrokken materiaal",
  "610260": "Huur logistiek materiaal",
  "610500": "Huur personenwagens",
};
interface LeasingPayload {
  enabled: boolean; demo?: boolean;
  period: { from: string; to: string };
  config: { accounts: string[]; excludedVendors: string[] };
  totals: { bruto: number; ic: number; uitgesloten: number; extern: number; nietToegewezen: number; intrest: number; schuld: number };
  perAccount: { account: string; extern: number; bruto: number }[];
  monthly: { month: string; byAccount: Record<string, number> }[];
  perCompany: { code: string; extern: number }[];
  vendors: { name: string; amount: number; kind: "extern" | "ic" | "uitgesloten" }[];
  note?: string;
}

function LeasingCard({ excluded, onDrillAccount }: { excluded: string[]; onDrillAccount: (account: string, label: string, amount: number) => void }) {
  const p = useChartPalette();
  const [d, setD] = useState<LeasingPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (excluded.length) params.set("exclude", excluded.join(","));
    // Zware eerste pull (VLE-join per firma) — daarna 12h gecachet.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);
    fetch(`/api/cfo/leasing?${params}`, { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((x) => { if (!cancelled) setD(x); })
      .catch((e) => { if (!cancelled) setErr(String(e).slice(0, 120)); })
      .finally(() => clearTimeout(timer));
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [excluded]);

  const chart = useMemo<echarts.EChartsOption | null>(() => {
    if (!d || d.monthly.length < 2) return null;
    const accounts = d.perAccount.map((a) => a.account);
    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => formatCurrency(Number(v)) },
      legend: { data: accounts.map((a) => LEASE_LABELS[a] || a), textStyle: { color: p.text, fontSize: 10 }, top: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10 },
      grid: { top: 30, left: 6, right: 8, bottom: 20, containLabel: true },
      xAxis: { type: "category", data: d.monthly.map((m) => m.month.slice(5)), axisLabel: { color: p.text, fontSize: 10 }, axisLine: { lineStyle: { color: p.axis } }, axisTick: { show: false } },
      yAxis: { type: "value", axisLabel: { color: p.textMuted, formatter: (v: number) => eurAxis(v) }, splitLine: { lineStyle: { color: p.grid } } },
      series: accounts.map((a, i) => ({
        name: LEASE_LABELS[a] || a, type: "bar" as const, stack: "lease", barMaxWidth: 26,
        itemStyle: { color: p.categorical[i % p.categorical.length] },
        data: d.monthly.map((m) => m.byAccount[a] || 0),
      })),
    };
  }, [d, p]);

  if (d && !d.enabled) return null; // uitgezet in Settings

  return (
    <Card
      title="Leasing & huur — rollend materieel"
      hint={d ? `extern · excl. IC${d.config.excludedVendors.length ? ` & ${d.config.excludedVendors.join(", ")}` : ""}` : undefined}
      period={d ? `${fmtDate(d.period.from)} t/m ${fmtDate(d.period.to)}` : undefined}
      explain="De cash-out voor leasing en huur van trekkers, trailers en overig rollend materieel, per maand en per grootboekrekening. Alleen EXTERNE leasing: wat groepsvennootschappen aan elkaar doorrekenen is eruit gehaald, anders zou je dezelfde trekker twee keer tellen. Klik een rekening om de boekingen erachter in Business Central te openen."
      source="Grootboekposten op de leasing- en huurrekeningen die finance (Birgit) heeft aangewezen, met een join op de leveranciersgegevens om intercompany en de uitgesloten leveranciers eruit te filteren. Excl. btw."
    >
      {!d && !err && (
        <p className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Leasingdata laden — eerste keer kan ±1 min duren (leveranciersjoin per firma)…
        </p>
      )}
      {err && <p className="py-4 text-xs text-negative">Laden mislukt: {err}</p>}
      {d && (
        <>
          <div className="mb-3 grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-border bg-muted/40 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Leasing/huur (extern)</div>
              <div className="mt-0.5 text-lg font-bold text-foreground">{formatCurrencyCompact(d.totals.extern)}</div>
              <div className="text-[10px] text-muted-foreground">bruto {formatCurrencyCompact(d.totals.bruto)} − IC {formatCurrencyCompact(d.totals.ic)}{d.totals.uitgesloten ? ` − uitgesl. ${formatCurrencyCompact(d.totals.uitgesloten)}` : ""}</div>
            </div>
            <div className="rounded-xl border border-border bg-muted/40 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Intresten leasing</div>
              <div className="mt-0.5 text-lg font-bold text-warning">{formatCurrencyCompact(d.totals.intrest)}</div>
              <div className="text-[10px] text-muted-foreground">650010 · YTD</div>
            </div>
            <div className="rounded-xl border border-border bg-muted/40 px-3 py-2" title={d.totals.schuld <= 0 ? "Het 422x-saldo is netto debet — de openingssaldi van de leasingschulden staan onvolledig in BC (migratiejaar), dus het echte openstaande bedrag is hier niet betrouwbaar af te lezen." : undefined}>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Openstaande leasingschuld</div>
              {d.totals.schuld > 0 ? (
                <>
                  <div className="mt-0.5 text-lg font-bold text-negative">{formatCurrencyCompact(d.totals.schuld)}</div>
                  <div className="text-[10px] text-muted-foreground">4222x · balans</div>
                </>
              ) : (
                <>
                  <div className="mt-0.5 text-lg font-bold text-muted-foreground">—</div>
                  <div className="text-[10px] text-warning">openingssaldi onvolledig (migratiejaar)</div>
                </>
              )}
            </div>
          </div>
          {chart && <EChart option={chart} height={220} ariaLabel="Leasingkost per maand per rekening" />}
          <div className="mt-2 divide-y divide-border rounded-xl border border-border">
            {d.perAccount.map((a) => (
              <button
                key={a.account}
                onClick={() => onDrillAccount(a.account, LEASE_LABELS[a.account] || a.account, a.extern)}
                className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs transition-colors hover:bg-accent"
                title="Toon de boekingen op deze rekening (met BC-links)"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="truncate text-foreground">{a.account} · {LEASE_LABELS[a.account] || "—"}</span>
                </span>
                <span className="shrink-0 tabular-nums text-foreground">{formatCurrency(a.extern)}</span>
              </button>
            ))}
          </div>
          {!!d.vendors.length && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {d.vendors.slice(0, 8).map((v) => (
                <span
                  key={v.name}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${
                    v.kind === "extern" ? "bg-muted text-muted-foreground"
                    : v.kind === "ic" ? "bg-warning/10 text-warning line-through"
                    : "bg-negative/10 text-negative line-through"
                  }`}
                  title={v.kind === "extern" ? `${v.name}: ${formatCurrency(v.amount)}` : `${v.name}: ${formatCurrency(v.amount)} — gefilterd (${v.kind === "ic" ? "intercompany" : "uitgesloten leverancier"})`}
                >
                  {v.name} · {eurAxis(v.amount)}
                </span>
              ))}
            </div>
          )}
          {(d.note || d.totals.nietToegewezen > 0) && (
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">{d.note || `€${d.totals.nietToegewezen.toLocaleString("nl-BE")} zonder leverancier-match telt als extern.`}</p>
          )}
        </>
      )}
    </Card>
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
  // Geconsolideerde P&L (regel-gebaseerde IC-eliminatie via /api/cfo/units) — de
  // IC-schakelaar zet hiermee óók de omzet/EBITDA/EBIT-tegels op geconsolideerd.
  const consQs = data.scope?.excluded.length ? `?exclude=${data.scope.excluded.join(",")}` : "";
  const consData = usePolledData<CfoUnits>(`/api/cfo/units${consQs}`);
  const cons = consData.data?.consolidated;
  // P&L-weergave: "brug" = klassieke resultaatbrug (balken zweven op het lopende
  // totaal); "nul" = elke balk vanaf 0 (pure groottes, geen cumulatief verloop).
  const [pnlView, setPnlView] = useState<"brug" | "nul">("brug");
  const [ratioOpen, setRatioOpen] = useState<string | null>(null);
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
  // Redesign 04/08: korte klasse-namen (geen afgekapte y-labels), Nederlandse
  // maandnamen, lege cellen zonder "€0"-ruis, lopende maand gemarkeerd.
  const heat = useMemo<echarts.EChartsOption | null>(() => {
    const HEAT_SHORT: Record<string, string> = {
      "60": "Aankopen", "61": "Diensten & div.", "62": "Bezoldigingen", "63": "Afschrijvingen", "64": "Andere",
    };
    const MND = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
    const curMonth = new Date().toISOString().slice(0, 7);
    const months = data.monthly.filter((m) => m.byClass && Object.keys(m.byClass).length);
    if (months.length < 2) return null;
    const xLabels = months.map((m) => {
      const nm = MND[Number(m.month.slice(5, 7)) - 1] || m.month.slice(5);
      return m.month === curMonth ? `${nm}*` : nm;
    });
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
          return `${cls} · ${CLASS_LABEL[cls] || cls} · ${MND[Number(mo.month.slice(5, 7)) - 1]} ${mo.month.slice(0, 4)}${mo.month === curMonth ? " (lopend)" : ""}<br/><b>${formatCurrency(v.raw)}</b> · ${share}% van de maandkosten`;
        },
      },
      grid: { top: 8, left: 6, right: 8, bottom: 34, containLabel: true },
      xAxis: {
        type: "category", data: xLabels,
        axisLabel: { color: p.text, fontSize: 10 },
        axisLine: { lineStyle: { color: p.axis } }, axisTick: { show: false }, splitArea: { show: false },
        name: `* = lopende maand (onvolledig) · ${months[0]?.month.slice(0, 4)}`, nameLocation: "middle", nameGap: 24,
        nameTextStyle: { color: p.textMuted, fontSize: 9 },
      },
      yAxis: {
        type: "category",
        data: rows.map((c) => `${c} ${HEAT_SHORT[c] || CLASS_LABEL[c] || c}`),
        axisLabel: { color: p.text, fontSize: 10 },
        axisLine: { lineStyle: { color: p.axis } }, axisTick: { show: false },
      },
      visualMap: { show: false, min: 0, max: 1, inRange: { color: [p.surface, p.income] } },
      series: [{
        type: "heatmap", data: cells,
        // Geen "€0"-ruis in lege cellen; compacte bedragen die in de cel passen.
        label: { show: true, fontSize: 8.5, formatter: (pr: LP) => { const raw = (pr.data as { raw: number }).raw; return Math.abs(raw) >= 500 ? eurAxis(raw) : ""; }, color: p.text },
        itemStyle: { borderColor: p.surface, borderWidth: 2, borderRadius: 3 },
        emphasis: { itemStyle: { shadowBlur: 8, shadowColor: "rgba(0,0,0,0.35)" } },
      }],
    };
  }, [data.monthly, p]);

  const apAging = useMemo(() => buildAgingOption(data.apAging, eliminateIC, p), [data.apAging, eliminateIC, p]);
  const arAging = useMemo(() => (data.arAging ? buildAgingOption(data.arAging, eliminateIC, p) : null), [data.arAging, eliminateIC, p]);

  // De oude 13-wekengrafiek (op vervaldatum) is hier weggehaald: hij zaaide twee
  // keer verwarring naast de volledige prognose op /cfo/cashflow (melding David
  // 18/08 — "dummy proof"). De cockpit toont nu een compacte teaser (zie
  // CashforecastTeaser onderaan) met de kerncijfers + één grote knop.

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

  // Kostenregels tonen hun magnitude (het label zegt al "kosten"); resultaat- en
  // saldoregels houden hun TEKEN — een verlies of negatief financieel resultaat mag
  // nooit als positief bedrag in de kop staan (auditbevinding 04/08/2026).
  const drillTotal = (line: CfoPnlLine) => (line.kind === "expense" ? Math.abs(line.amount) : line.amount);
  const drillLine = (line: CfoPnlLine, extraNote = "") => { resetGl(); setDrill({
    title: line.label,
    subtitle: line.pnlClass ? `PCMN-klasse ${line.pnlClass} · bron: Business Central grootboek` : "Subtotaal",
    total: drillTotal(line),
    rows: line.accounts.map((a) => ({ label: `${a.accountNumber} · ${a.accountName}`, value: a.amount, accountNumber: a.accountNumber })),
    note: (line.accounts.length ? "De grootboekrekeningen die deze regel vormen — klik een rekening voor de individuele boekingen, met doorklik naar Business Central." : "Subtotaal — berekend uit de regels erboven.") + extraNote,
  }); };
  const onWaterfall = (p: EChartClick) => { if (typeof p.dataIndex === "number" && data.pnl[p.dataIndex]) drillLine(data.pnl[p.dataIndex]); };
  const onDonut = (p: EChartClick) => { const cls = (p.data as { _class?: string } | undefined)?._class; const line = data.pnl.find((l) => l.pnlClass === cls); if (line) drillLine(line); };
  // Aging-buckets drillen tot op de open post, met BC-deeplink per document.
  const bucketItems = (b: CfoAgingBucket) => (b.items || []).filter((it) => !eliminateIC || !it.ic);
  const onApAging = (p: EChartClick) => { const b = data.apAging.find((x) => x.label === p.name); if (b) { resetGl(); setDrill({ title: `Leveranciers — ${b.label}`, subtitle: "Open leveranciersposten (VendorLedgerEntries)", total: agingVal(b), rows: b.extern != null ? [{ label: "Extern", value: b.extern }, { label: "Intercompany", value: b.amount - b.extern }] : [], items: bucketItems(b), itemsCount: eliminateIC ? bucketItems(b).length : b.itemCount, note: "Grootste open posten hieronder — ↗ opent de post in Business Central. Volledig detail: export 'Leveranciersaging'." }); } };
  const onArAging = (p: EChartClick) => { const b = data.arAging?.find((x) => x.label === p.name); if (b) { resetGl(); setDrill({ title: `Klanten — ${b.label}`, subtitle: "Open verkoopfacturen (salesInvoices)", total: agingVal(b), rows: b.extern != null ? [{ label: "Extern", value: b.extern }, { label: "Intercompany", value: b.amount - b.extern }] : [], items: bucketItems(b), itemsCount: eliminateIC ? bucketItems(b).length : b.itemCount, note: "Grootste open facturen hieronder — ↗ opent de factuur in Business Central." }); } };
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

  // Leasing-kaart → drill naar de boekingen van één huurrekening (BC-links via
  // het bestaande /api/cfo/gl-pad in het bronpaneel).
  const onLeasingAccount = (account: string, label: string, amount: number) => {
    resetGl();
    setDrill({
      title: `${account} · ${label}`,
      subtitle: "Leasing/huur rollend materieel · bron: BC grootboek",
      total: Math.abs(amount),
      rows: [{ label: `${account} · ${label}`, value: amount, accountNumber: account }],
      note: "Klik de rekening voor de individuele boekingen (met BC-links). De boekingenlijst toont álles op de rekening — de IC/leverancier-filtering geldt op het kaarttotaal.",
    });
  };

  const onEntity = (e: CfoEntityRow) => setDrill({
    title: e.companyName, subtitle: `${e.code} · bedrijfsopbrengsten (bruto, incl. IC)`, total: e.revenue,
    rows: [{ label: "Bedrijfsopbrengsten", value: e.revenue }, { label: "Bedrijfskosten", value: -e.costs }, { label: "Resultaat (EBIT)", value: e.result }],
    note: `Operationele marge ${e.marginPct}% · resultaat ${formatCurrency(e.result)}. Bedragen bruto per vennootschap; geconsolideerd beeld op Business Units.`,
  });

  const apShown = eliminateIC ? k.apOpenExtern : k.apOpen;
  const arShown = eliminateIC ? k.arOpenExtern : k.arOpen;
  // ΔPY: elke resultaat-KPI draagt een vergelijking met dezelfde periode vorig jaar.
  const py = data.prevYear;
  const pct = (cur: number, prev?: number): number | null =>
    prev ? Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10 : null;

  // ---- cascade-drills vanaf de KPI-tegels ----
  // Elke tegel opent een gelaagde drill: componentregels (klik → klasse) → rekeningen
  // (klik → boekingen uit /api/cfo/gl) → ↗ Business Central. "Op alles kunnen doorklikken."
  const lineRow = (key: string): DrillRow | null => {
    const l = data.pnl.find((x) => x.key === key);
    return l ? { label: l.label, value: l.amount, pnlKey: l.key } : null;
  };
  // Tegel-klik: breng het drill-paneel in beeld (op mobiel staat het onder de grafieken).
  const scrollToDrill = () => setTimeout(() => document.getElementById("bron-detail")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
  const cascadeRows = (keys: string[]): DrillRow[] => keys.map(lineRow).filter((r): r is DrillRow => Boolean(r));
  const drillKpiPnl = (title: string, keys: string[], note: string) => { resetGl(); setDrill({
    title, subtitle: "Cascade: regel → rekeningen → boekingen → Business Central",
    rows: cascadeRows(keys),
    note,
  }); scrollToDrill(); };
  const agingTileDrill = (kind: "ap" | "ar") => {
    const buckets = (kind === "ap" ? data.apAging : data.arAging) || [];
    const items = buckets.flatMap((b) => bucketItems(b)).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    resetGl(); setDrill({
      title: kind === "ap" ? "Te betalen — open leveranciersposten" : "Te ontvangen — open klantposten",
      subtitle: eliminateIC ? "extern (IC geëlimineerd) · incl. btw" : "incl. intercompany · incl. btw",
      total: kind === "ap" ? apShown : arShown,
      rows: buckets.map((b) => ({ label: b.label, value: agingValue(b, eliminateIC) })),
      items: items.slice(0, 15),
      itemsCount: eliminateIC ? items.length : buckets.reduce((s, b) => s + (b.itemCount ?? b.items?.length ?? 0), 0),
      note: `Grootste open posten hieronder — ↗ opent de post in Business Central. Alle posten: export '${kind === "ap" ? "Leveranciersaging" : "Klantenaging"}' of klik een bucket in de grafiek.`,
    });
    scrollToDrill();
  };
  // IC-schakelaar AAN → P&L-tegels tonen de geconsolideerde cijfers (regel-gebaseerde
  // eliminatie). ΔPY verbergen we dan (vorig jaar is bruto — appels met peren).
  // LET OP (audit 04/08/2026): /api/cfo/units rekent ALTIJD YTD. Bij een afwijkende
  // periode zouden de tegels YTD-cijfers onder een kwartaal-label tonen — daarom
  // consolideren we alleen in de YTD-stand en zeggen we het eerlijk buiten YTD.
  const isYtdPeriod = /\(YTD\)/.test(data.period.label);
  // Exacte periode als badge op élke kaart: "ze mogen nooit moeten twijfelen over
  // welke periode een cijfer gaat". P&L-kaarten dragen de gekozen periode, kaarten
  // met open posten of een balans dragen hun momentopname-datum.
  const perExact = `${fmtDate(data.period.from)} t/m ${fmtDate(data.period.to)}`;
  const perPnl = `${data.period.label} · ${perExact}`;
  const perNu = `momentopname ${fmtDate(new Date().toISOString().slice(0, 10))}`;
  const icOn = eliminateIC && Boolean(cons) && isYtdPeriod;
  const ebitNetVal = cons ? cons.totals.ebitNet : 0;
  const netResultNet = cons ? k.netResult - cons.icSymmetry.delta : 0; // netto − operationeel IC-effect
  const icSub = (bruto: string) =>
    eliminateIC && !isYtdPeriod ? `${bruto} · bruto (IC-eliminatie enkel in YTD)`
      : eliminateIC && !cons ? `${bruto} · IC-eliminatie laadt…`
        : bruto;
  const icNote = icOn
    ? " LET OP: de drill-bedragen hieronder zijn BRUTO (incl. intercompany) — de geconsolideerde opbouw per klasse staat op Business Units."
    : "";
  const kpis: { label: string; value: string; sub: string; icon: typeof Wallet; accent: string; ring: string; glow: string; delta?: number | null; onClick?: () => void }[] = [
    { label: "Bedrijfsopbrengsten", value: formatCurrencyCompact(icOn ? cons!.totals.revenueNet : k.revenue), sub: icOn ? `geconsolideerd · IC −${formatCurrencyCompact(cons!.totals.revenueIc)} · excl. btw` : icSub(`${data.period.label} · excl. btw`), icon: ArrowUpCircle, accent: "text-primary", ring: "ring-primary/20", glow: "from-primary/15", delta: icOn ? null : pct(k.revenue, py?.revenue),
      onClick: () => { const l = data.pnl.find((x) => x.key === "revenue"); if (l) { drillLine(l, icNote); scrollToDrill(); } } },
    { label: "EBITDA", value: formatCurrencyCompact(icOn ? cons!.totals.ebitdaNet : k.ebitda), sub: icOn ? "geconsolideerd · vóór afschrijvingen" : icSub(`${k.revenue ? Math.round((k.ebitda / k.revenue) * 1000) / 10 : 0}% van omzet`), icon: Activity, accent: "text-warning", ring: "ring-warning/20", glow: "from-warning/15", delta: icOn ? null : pct(k.ebitda, py?.ebitda),
      onClick: () => drillKpiPnl("EBITDA — opbouw", ["revenue", "c60", "c61", "c62", "c64"], "EBITDA = bedrijfsopbrengsten − klassen 60/61/62/64 (afschrijvingen 63 vallen erbuiten). Klik een regel voor de rekeningen erachter." + icNote) },
    { label: "EBIT", value: formatCurrencyCompact(icOn ? ebitNetVal : k.operatingResult), sub: icOn ? "geconsolideerd · ná afschrijvingen" : icSub(`marge ${k.operatingMarginPct}%`), icon: TrendingUp, accent: "text-positive", ring: "ring-positive/20", glow: "from-positive/15", delta: icOn ? null : pct(k.operatingResult, py?.ebit),
      onClick: () => drillKpiPnl("EBIT — opbouw", ["revenue", "c60", "c61", "c62", "c64", "c63"], "EBIT = EBITDA − afschrijvingen (klasse 63). Klik een regel voor de rekeningen erachter." + icNote) },
    { label: "Nettoresultaat", value: formatCurrencyCompact(icOn ? netResultNet : k.netResult), sub: icOn ? "geconsolideerd operationeel · financieel/belastingen bruto" : icSub("na financieel & belastingen"), icon: Landmark, accent: "text-positive", ring: "ring-positive/20", glow: "from-positive/15", delta: icOn ? null : pct(k.netResult, py?.netResult),
      onClick: () => drillKpiPnl("Nettoresultaat — opbouw", ["revenue", "c60", "c61", "c62", "c64", "c63", "fin", "exc", "tax"], "Alle P&L-regels t/m nettoresultaat. Klik een regel voor de rekeningen, dan een rekening voor de boekingen met BC-link." + icNote) },
    { label: "Cashpositie", value: formatCurrencyCompact(k.cash), sub: "banksaldo (klasse 55)", icon: Wallet, accent: "text-primary", ring: "ring-primary/20", glow: "from-primary/15",
      onClick: () => { resetGl(); setDrill({
        title: "Cashpositie", subtitle: "nettosaldo grootboekklasse 55 (banken), alle vennootschappen",
        total: k.cash, rows: [],
        note: "Rekening-detail: de kaart 'Volledige balans op datum' (rubriek 5, met rekening-drill) hieronder; de werkelijke geldstromen per bankrekening staan op Klanten & Cash → Banken.",
      }); scrollToDrill(); } },
    { label: "Te betalen (AP)", value: formatCurrencyCompact(apShown), sub: eliminateIC ? "extern · incl. btw" : "incl. intercompany · incl. btw", icon: ArrowDownCircle, accent: "text-negative", ring: "ring-negative/20", glow: "from-negative/15",
      onClick: () => agingTileDrill("ap") },
    { label: "Te ontvangen (AR)", value: arShown ? formatCurrencyCompact(arShown) : "—", sub: eliminateIC ? "extern · incl. btw" : "incl. intercompany · incl. btw", icon: ArrowUpCircle, accent: "text-primary", ring: "ring-primary/20", glow: "from-primary/15",
      onClick: () => agingTileDrill("ar") },
  ];

  const r = data.ratios;
  // Elke ratio draagt zijn formule + benaderings-caveat als tooltip — een CFO moet
  // kunnen zien WAT er gedeeld wordt voor die op een ratio stuurt.
  // Elke ratio draagt zijn formule, zijn periode én zijn benaderings-caveat — een CFO
  // moet kunnen zien WAT er gedeeld wordt en over welke periode, vóór die erop stuurt.
  const ratioTiles = r ? [
    { label: "Current ratio", value: r.currentRatio.toFixed(2), tone: r.currentRatio >= 1.2 ? "emerald" : r.currentRatio >= 1 ? "amber" : "rose",
      periode: perNu,
      wat: "Kan de groep haar korte schulden betalen met wat er op korte termijn beschikbaar is? Boven 1 betekent dat de vlottende activa de korte schulden dekken.",
      formule: "(kas + handelsvorderingen + voorraad) ÷ (handelsschulden 44x + kortlopende financiële schulden 43x + fiscale/sociale schulden 45x)",
      hint: "(kas + handelsvorderingen + voorraad) ÷ alle kortlopende schulden (44x + 43x + 45x). Sinds 05/08/2026 zitten de financiële en fiscale schulden WEL in de noemer.",
      caveat: "Tot 05/08/2026 stond alleen de handelsschuld in de noemer, waardoor deze ratio te gunstig uitkwam; na externe methodiekreview zijn de kortlopende financiële schulden (43x: straight loans, kaskrediet, rekening-courant) en de fiscale/sociale/loonschulden (45x) toegevoegd. Het blijft een cijfer op de condensed balans: het langlopende deel van klasse 42 dat binnen het jaar vervalt, zit er niet apart in. Geen bankcovenant-cijfer." },
    { label: "Quick ratio", value: r.quickRatio.toFixed(2), tone: r.quickRatio >= 1 ? "emerald" : r.quickRatio >= 0.8 ? "amber" : "rose",
      periode: perNu,
      wat: "Dezelfde vraag als de current ratio, maar strenger: zonder de voorraad, want die moet eerst verkocht worden voor het geld is.",
      formule: "(kas + handelsvorderingen) ÷ (handelsschulden 44x + kortlopende financiële schulden 43x + fiscale/sociale schulden 45x)",
      hint: "(kas + handelsvorderingen) ÷ alle kortlopende schulden, zonder voorraad.",
      caveat: "Zelfde noemer als de current ratio (sinds 05/08/2026 inclusief 43x en 45x). Zonder voorraad, want die moet eerst verkocht worden voor het geld is." },
    { label: "Solvabiliteit", value: `${r.solvencyPct}%`, tone: r.solvencyPct >= 30 ? "emerald" : r.solvencyPct >= 20 ? "amber" : "rose",
      periode: perNu,
      wat: "Welk deel van alles wat de groep bezit met eigen geld gefinancierd is in plaats van met schuld. Banken kijken hier het eerst naar; 30% of meer is comfortabel.",
      formule: "eigen vermogen (klasse 1) ÷ benaderde totale activa (klassen 2 + 3 + handelsvorderingen + kas)",
      hint: "Eigen vermogen (klasse 1) ÷ benaderde activa (kl. 2 + 3 + AR + kas). Condensed — geen volledige balans.",
      caveat: "De noemer is een BENADERING van de totale activa uit de condensed balans, niet het balanstotaal van een statutaire jaarrekening. Voor de volledige balans: de kaart 'Volledige balans' verder op deze pagina." },
    { label: "DSO (klanten)", value: `${r.dso} d`, tone: "sky",
      periode: `${perExact} (open posten: ${perNu})`,
      wat: "Hoeveel dagen omzet er bij klanten open staat — hoe lang ons geld gemiddeld bij hen zit voor het binnenkomt.",
      formule: "open klantvorderingen ÷ omzet van de periode × aantal verstreken dagen",
      hint: "Open AR ÷ omzet × verstreken dagen. INDICATIEF: teller incl. btw, noemer excl. btw — gebruik de DSO op Klanten & Cash voor rapportering.",
      caveat: "BEWUST INDICATIEF EN NIET GECORRIGEERD. De teller (openstaande vorderingen) is incl. btw en de noemer (omzet uit de resultatenrekening) excl. btw, waardoor dit cijfer de dagen OVERSCHAT — bij 21% btw tot ruwweg een vijfde. Corrigeren met één blended btw-tarief zou hier fout zijn: de groep heeft naast 21%-stromen ook 0%- en vrijgestelde internationale transportstromen, dus een enkel tarief zou een nieuwe fout introduceren in plaats van er een weg te nemen. De ZUIVERE DSO staat op Klanten & Cash: daar zijn teller én noemer incl. btw (btw-neutraal) en staat de DSO per maand, per categorie, met countback en de CRF-KPI's erbij. Gebruik díe voor de bank." },
    { label: "DPO (leveranciers)", value: `${r.dpo} d`, tone: "sky",
      periode: `${perExact} (open posten: ${perNu})`,
      wat: "Hoeveel dagen we er zelf over doen om onze leveranciers te betalen. Hoger is gunstig voor de cash, tot het de relatie of de leveringszekerheid schaadt.",
      formule: "open leveranciersschulden ÷ inkopen van de periode (klassen 60, 61 en 64) × aantal verstreken dagen",
      hint: "Open AP ÷ inkopen (klasse 60/61/64) × verstreken dagen. Bezoldigingen/afschrijvingen tellen niet mee (lopen niet via leveranciers).",
      caveat: "Bezoldigingen (klasse 62) en afschrijvingen (klasse 63) zitten bewust NIET in de noemer: die lopen niet via leveranciersfacturen en zouden de dagen kunstmatig verlagen." },
    { label: "Cash conversion", value: `${r.ccc} d`, tone: r.ccc <= 0 ? "emerald" : "amber",
      periode: `${perExact} (open posten: ${perNu})`,
      wat: "Het aantal dagen tussen geld uitgeven aan een opdracht en geld ervoor ontvangen. Negatief betekent dat leveranciers de cyclus financieren in plaats van wij.",
      formule: "DSO + DIO (voorraaddagen) − DPO",
      hint: "DSO + DIO − DPO: dagen tussen geld uitgeven en geld innen. Negatief = leveranciers financieren de cyclus.",
      caveat: "Erft alle beperkingen van de DSO en DPO hiernaast. Voor een transportgroep is de voorraadcomponent klein, dus dit cijfer wordt vooral gedreven door het verschil tussen klant- en leverancierstermijnen." },
  ] : [];
  const toneClass: Record<string, string> = { emerald: "text-positive", amber: "text-warning", rose: "text-negative", sky: "text-primary" };

  const bs = data.balanceSheet;
  const bsMax = bs ? Math.max(bs.totalAssets, bs.totalClaims, 1) : 1;

  return (
    <div className="min-h-full -m-6 p-6 lg:-m-8 lg:p-8 bg-[radial-gradient(1200px_600px_at_20%_-10%,rgba(47,189,138,0.07),transparent),radial-gradient(1000px_500px_at_100%_0%,rgba(224,182,74,0.05),transparent)]">
      {/* Hero — de periodekiezer staat vóór de titel en in de accentkleur: het is de
          schakelaar die álle cijfers op deze pagina bepaalt (CFO-feedback 04/08/2026). */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 ring-1 ring-border">
            <Landmark className="h-6 w-6 text-primary" />
          </div>
          <div>
            <div className="mb-1 flex items-center gap-2">
              <PeriodPicker label={data.period.label} prominent />
              <span className="text-[11px] text-muted-foreground">← alle cijfers op deze pagina volgen deze periode</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Financiële Cockpit</h1>
            <p className="text-sm text-muted-foreground">
              {data.company === "all"
                ? data.scope?.excluded.length
                  ? `${data.scope.all.length - data.scope.excluded.length} van ${data.scope.all.length} vennootschappen · ${icOn ? "kerncijfers geconsolideerd (IC geëlimineerd); grafieken/balans bruto" : "bruto (som firma's, incl. IC)"} · excl. ${data.scope.excluded.join(", ")}`
                  : `Alle vennootschappen · ${icOn ? "kerncijfers geconsolideerd (IC geëlimineerd); grafieken/balans bruto" : "bruto (som firma's, incl. IC)"}`
                : `Vennootschap ${data.company}`} · {data.period.label} · P&L excl. btw, open posten incl. btw
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
          {data.scope && data.company === "all" && <ScopePicker scope={data.scope} />}
          <SnapshotPicker />
          <button
            onClick={() => setEliminateIC((v) => !v)}
            className={`rounded-full px-3 py-1 text-[11px] font-semibold ring-1 transition ${eliminateIC ? "bg-primary/15 text-primary ring-primary/40" : "bg-muted text-muted-foreground ring-border hover:text-foreground"}`}
            title="Elimineert intercompany overal: omzet/EBITDA/EBIT-tegels (regel-gebaseerd, via de tegenpartij op elke boeking) én AP/AR/aging (naam-gebaseerd)"
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
          <button
            key={t.label}
            onClick={t.onClick}
            disabled={!t.onClick}
            title={t.onClick ? "Klik voor de opbouw — drill door tot de boeking in Business Central" : undefined}
            className={`relative overflow-hidden rounded-2xl border border-border bg-card p-4 text-left ring-1 ${t.ring} backdrop-blur transition ${t.onClick ? "cursor-pointer hover:border-primary/40 hover:ring-primary/30" : "cursor-default"}`}
          >
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
            {t.onClick && <ChevronRight className="absolute bottom-3 right-3 h-3.5 w-3.5 text-muted-foreground/50" />}
          </button>
        ))}
      </div>

      {/* Ratio tiles */}
      {ratioTiles.length > 0 && (
        <div className="mt-4 grid grid-cols-3 gap-3 lg:grid-cols-6">
          {ratioTiles.map((t) => (
            <button
              key={t.label}
              onClick={() => setRatioOpen(t.label)}
              title="Klik voor de formule, de exacte periode en de beperkingen van deze ratio"
              className="group/ratio rounded-xl border border-border bg-card px-3 py-2.5 text-left transition hover:border-primary/40 hover:ring-1 hover:ring-primary/25"
            >
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                {t.label}
                <Info className="h-2.5 w-2.5 opacity-40 transition-opacity group-hover/ratio:opacity-90" />
              </div>
              <div className={`mt-1 text-lg font-bold ${toneClass[t.tone]}`}>{t.value}</div>
              <div className="mt-0.5 truncate text-[9px] text-muted-foreground" title={t.periode}>{t.periode}</div>
            </button>
          ))}
        </div>
      )}

      {/* Ratio-detail: formule met de echte definitie, exacte periode en beperkingen */}
      {(() => {
        const t = ratioTiles.find((x) => x.label === ratioOpen);
        if (!t) return null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setRatioOpen(null)}>
            <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Bron van dit cijfer</p>
                  <h3 className="mt-0.5 text-base font-bold text-foreground">{t.label}</h3>
                  <p className={`mt-1 text-2xl font-bold tabular-nums ${toneClass[t.tone]}`}>{t.value}</p>
                </div>
                <button onClick={() => setRatioOpen(null)} className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Sluiten">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Periode</p>
                <p className="mt-1 text-[11px] font-semibold leading-snug text-foreground">{t.periode}</p>
              </div>
              <div className="mt-3 rounded-xl border border-border bg-background/50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Wat zegt dit cijfer</p>
                <p className="mt-1 text-[11px] leading-snug text-foreground">{t.wat}</p>
              </div>
              <div className="mt-3 rounded-xl border border-border bg-background/50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Zo is het gerekend</p>
                <p className="mt-1 font-mono text-[11px] leading-relaxed text-foreground">{t.formule}</p>
                <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                  Onderliggende bron: grootboeksaldi en open klant-/leveranciersposten uit Business Central, over de periode hierboven.
                  Voor de opbouw per rekening: de kaart &quot;Volledige balans&quot; en de pagina Klanten &amp; Cash.
                </p>
              </div>
              <div className="mt-3 rounded-xl border border-warning/30 bg-warning/10 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-warning">Waar je op moet letten</p>
                <p className="mt-1 text-[11px] leading-snug text-foreground">{t.caveat}</p>
              </div>
            </div>
          </div>
        );
      })()}

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
          Verwacht negatief kassaldo in {data.cashForecast.lowestWeekLabel}{(() => { const w = data.cashForecast!.weeks.find((x) => x.label === data.cashForecast!.lowestWeekLabel); return w ? ` (week van ma ${fmtDM(w.weekStart)})` : ""; })()} ({formatCurrency(data.cashForecast.lowestClosing)}) — cashkrap.
        </div>
      )}

      {/* Main grid */}
      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card
            title="Winst & verlies — brug naar nettoresultaat" hint="Klik een balk voor de brongegevens" period={perPnl}
            explain="Het pad van omzet naar nettoresultaat in stappen: bedrijfsopbrengsten, min de bedrijfskosten geeft EBITDA, min de afschrijvingen geeft EBIT, dan het financiële en uitzonderlijke resultaat en de belastingen tot het nettoresultaat. Belangrijk onderscheid: EBITDA sluit klasse 63 (afschrijvingen) uit, EBIT rekent die wél mee. Klik een balk om af te dalen naar de rekeningen erachter en verder naar de boekingen in Business Central."
            source="Grootboekposten per PCMN/MAR-klasse: 70–74 opbrengsten, 60–64 bedrijfskosten, 65/75 financieel, 66/76 uitzonderlijk, 67/77 belastingen. Klassen 68/69/78/79 (resultaatverwerking) blijven buiten beschouwing. Excl. btw."
          >
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

          <CashforecastTeaser />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card
              title="Kostenstructuur" hint="Klik een segment" period={perPnl}
              explain="Alle bedrijfskosten van de gekozen periode, verdeeld over de kostenklassen van het Belgische rekeningstelsel: 60 handelsgoederen en diensten van derden, 61 diensten en diverse goederen, 62 personeel, 63 afschrijvingen, 64 andere bedrijfskosten. Klik een segment om door te dalen naar de rekeningen en vervolgens naar de individuele boekingen in Business Central."
              source="Grootboekposten op de klassen 60 t/m 64, bedrag = debet − credit, excl. btw."
            >
              <EChart option={donut} height={300} onSelect={onDonut} ariaLabel="Cost structure" />
            </Card>
            <Card
              title="Opbrengsten vs. kosten per maand"
              hint={data.budget?.configured ? `omzet vs doel ${data.budget.revenueVariancePct >= 0 ? "+" : ""}${data.budget.revenueVariancePct}%` : undefined}
              period={`elke kalendermaand apart, ${perExact}`}
              explain="Per kalendermaand de bedrijfsopbrengsten naast de bedrijfskosten, zodat je het seizoenpatroon en de marge-ontwikkeling ziet. Elke maand staat op zichzelf — dit is geen cumulatieve of rollende reeks. De lopende maand is per definitie nog niet volledig geboekt en ligt daardoor lager dan ze zal uitkomen."
              source="Grootboekposten klassen 70–74 (opbrengsten) en 60–64 (kosten), gegroepeerd op boekingsmaand, excl. btw."
            >
              <EChart option={monthly} height={300} ariaLabel="Monthly revenue vs cost" />
            </Card>

          {heat && (
            <Card
              title="Kosten per klasse per maand" hint="Klik een cel — kleur = t.o.v. de eigen klasse"
              period={`elke kalendermaand apart, ${perExact}`}
              explain="Een raster van kostenklasse (rij) tegen kalendermaand (kolom). De kleur vergelijkt elke cel met het gemiddelde van DIE klasse, niet met de andere klassen — anders zou personeelskost alle overige klassen wegdrukken en zag je niks. Klik een cel om de boekingen van die klasse in die maand te openen."
              source="Grootboekposten klassen 60 t/m 64, gegroepeerd op klasse × boekingsmaand, excl. btw."
            >
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

          {/* Leasing & huur rollend materieel — lazy geladen, spec Birgit */}
          <LeasingCard excluded={data.scope?.excluded || []} onDrillAccount={onLeasingAccount} />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card
              title="Leveranciersaging (te betalen)" hint="Klik een bucket" period={perNu}
              explain="Wat wij onze leveranciers vandaag nog moeten betalen, verdeeld naar hoe lang de vervaldatum al voorbij is. LET OP: dit is géén periodecijfer maar een momentopname van vandaag — het verandert dus niet als je de periodekiezer bovenaan aanpast. Klik een blok voor de facturen erin, met doorklik naar de post in Business Central."
              source="Open leveranciersposten (VendorLedgerEntries met Open = true), gebucket op de vervaldatum. Bedragen incl. btw, want dat is wat er effectief overgeschreven wordt."
            >
              <EChart option={apAging} height={260} onSelect={onApAging} ariaLabel="AP aging" />
            </Card>
            {arAging && (
              <Card
                title="Klantenaging (te ontvangen)" hint="Klik een bucket" period={perNu}
                explain="Wat onze klanten ons vandaag nog moeten betalen, verdeeld naar hoe lang de vervaldatum al voorbij is. Ook dit is een momentopname en niet gebonden aan de gekozen periode. Voor de belversie van dit cijfer — met namen, telefoonnummers en de belvolgorde — gebruik je de bellijst op de pagina Klanten & Cash."
                source="Open klantposten (Cust_LedgerEntries met Open = true), gebucket op de vervaldatum. Bedragen incl. btw."
              >
                <EChart option={arAging} height={260} onSelect={onArAging} ariaLabel="AR aging" />
              </Card>
            )}
          </div>

          {bs && (
            <Card
              title="Balans (condensed)" period={`momentopname ${fmtDate(bs.asOf)}`}
              explain="Een verkorte balans op één datum: links wat de groep bezit, rechts hoe dat gefinancierd is. Dit is per definitie een standcijfer op één dag en verandert dus niet met de periodekiezer bovenaan. Alleen de posten die we betrouwbaar kunnen afleiden staan hier; de volledige balans met alle klassen, doorklik per rekening en een eigen datumkiezer staat in de kaart eronder."
              source={`Grootboeksaldi per rekening op ${fmtDate(bs.asOf)}, gegroepeerd naar balansrubriek volgens het Belgische rekeningstelsel (MAR).`}
            >
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <BalanceCol title="Activa" total={bs.totalAssets} lines={bs.assets} max={bsMax} color={p.categorical[1]} />
                <BalanceCol title="Passiva & eigen vermogen" total={bs.totalClaims} lines={bs.claims} max={bsMax} color={p.categorical[4]} />
              </div>
              {!bs.complete && <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground"><Scale className="h-3 w-3" /> Condensed — de volledige balans (alle klassen, met rekening-drill en datumkiezer) staat hieronder.</p>}
            </Card>
          )}

          <FullBalanceCard excluded={data.scope?.excluded || []} />

          <ConsolidatedCard excluded={data.scope?.excluded || []} />

          <Card
            title="Per vennootschap" hint="Klik een rij" period={perPnl}
            explain="Per vennootschap de omzet, het operationele resultaat (EBIT) en de marge over de gekozen periode. Alle drie de kolommen gaan over exact dezelfde periode. Bedragen zijn bruto: de omzet die firma's aan elkaar factureren zit er nog in — het geconsolideerde beeld met echte IC-eliminatie staat op de pagina Business Units. Klik een rij om af te dalen naar de rekeningen van die firma en verder naar de boekingen in Business Central."
            source="Grootboekposten per vennootschap: klassen 70–74 als omzet, 60–64 als kosten (afschrijvingen inbegrepen), excl. btw."
          >
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
            <p className="mb-3 text-[11px] text-muted-foreground">Elke export bevat de pull-timestamp (bestandsnaam + titelblad), IC-markering, doorklik-links naar de boekingen in Business Central en een methodiek-blad.</p>
            <div className="space-y-2">
              <ExportButton kind="ap" label="Leveranciersaging (Excel)" />
              <ExportButton kind="ar" label="Klantenaging (Excel)" />
              <ExportButton kind="leasing" label="Leasing cash-out (Excel)" />
              <ExportButton kind="uitgaven" label="Overzicht uitgaven per categorie (Excel)" withRange />
              <a
                href="/api/cfo/ai-export"
                className="flex w-full items-center justify-between rounded-xl border border-border bg-background/40 px-3 py-2 text-left text-xs font-semibold text-foreground transition hover:border-primary/40 hover:bg-accent"
                title="Volledige CFO-dataset (P&L, DSO/factoring, BTW) + methodiek als zelfbeschrijvend JSON — voor AI-analyse of eigen doorrekening"
              >
                <span>Export voor AI — volledige dataset (JSON)</span>
                <Download className="h-3.5 w-3.5 text-primary" />
              </a>
            </div>
          </div>
          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-3 backdrop-blur">
            <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Deep-dives</p>
            <div className="space-y-1">
              <a href="/cfo/klanten" className="flex items-center justify-between rounded-lg px-2 py-1.5 text-xs font-semibold text-foreground transition hover:bg-primary/10" title="DSO per categorie, betaalgedrag, factoring (KBC·Belfius·BNP), banken, BTW, verwachte inning">
                <span>Klanten &amp; Cash — DSO, factoring &amp; BTW</span><ChevronRight className="h-3.5 w-3.5 text-primary" />
              </a>
              <a href="/cfo/units" className="flex items-center justify-between rounded-lg px-2 py-1.5 text-xs font-semibold text-foreground transition hover:bg-primary/10" title="Omzet/kosten/marge per activiteit (AFDELING-dimensie) + CAPEX/afschrijvingen per activaklasse">
                <span>Business Units &amp; Activa</span><ChevronRight className="h-3.5 w-3.5 text-primary" />
              </a>
              <a href="/cfo/pnl" className="flex items-center justify-between rounded-lg px-2 py-1.5 text-xs font-semibold text-foreground transition hover:bg-primary/10" title="De P&L in EMAsphere-bucketstructuur, live uit BC — per maand, per firma, met drill per rekening en controlelijn op nul">
                <span>Management-P&amp;L</span><ChevronRight className="h-3.5 w-3.5 text-primary" />
              </a>
              <a href="/cfo/cashflow" className="flex items-center justify-between rounded-lg px-2 py-1.5 text-xs font-semibold text-foreground transition hover:bg-primary/10" title="13 weken vooruit op betaalgedrag per klant (zonder/met factoring side-by-side) + maandlaag tot eind volgend jaar + 6 mnd; kantelpunten, 433-saldi en niet-toegewezen betalingen">
                <span>Cashflowprognose — 13 weken &amp; kantelpunten</span><ChevronRight className="h-3.5 w-3.5 text-primary" />
              </a>
              <a href="/cfo/formularium" className="flex items-center justify-between rounded-lg px-2 py-1.5 text-xs font-semibold text-foreground transition hover:bg-primary/10" title="Elk begrip op deze pagina's: wat het betekent, de formule, de bron in BC en waarop het gebaseerd is — voor als iemand vraagt 'hoe kom je daaraan?'">
                <span>Formularium — begrippen &amp; formules</span><ChevronRight className="h-3.5 w-3.5 text-primary" />
              </a>
            </div>
          </div>
          <div id="bron-detail" className="rounded-2xl border border-border bg-card p-5 backdrop-blur">
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
                          ) : row.pnlKey ? (
                            <button
                              onClick={() => { const l = data.pnl.find((x) => x.key === row.pnlKey); if (l) drillLine(l); }}
                              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
                              title="Volgende laag: de rekeningen achter deze regel"
                            >
                              <span className="flex min-w-0 items-center gap-1.5">
                                <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
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
                  {/* Géén chevron: dit zijn leesblokken, geen knoppen — de pijltjes
                      wekten de indruk dat er iets uitklapte (melding David 18/08). */}
                  {data.sources.map((s) => (
                    <div key={s.label} className="rounded-xl border border-border bg-card p-3">
                      <div className="text-xs font-semibold text-foreground">{s.label}</div>
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
// Default-periode voor de uitgaven-export: 1 januari t/m de laatste VOLLEDIGE maand
// (lonen van de lopende maand zijn nog niet geboekt).
function uitgavenDefaultRange(): { from: string; to: string } {
  // Audit 11/08/2026: op BRUSSELSE kalender, niet de browser-tijdzone — anders krijgt
  // een reiziger/nachtuil rond maandwissel een andere default dan de server bedoelt.
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Brussels" }));
  const end = new Date(now.getFullYear(), now.getMonth(), 0); // laatste dag vorige maand
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: `${end.getFullYear()}-01-01`, to: iso(end) };
}

function ExportButton({ kind, label, withRange }: { kind: "ap" | "ar" | "leasing" | "uitgaven"; label: string; withRange?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [pulledAt, setPulledAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Datumprompt (vraag David 11/08): bij exports met withRange eerst de cut-off-datums
  // kiezen (van/tot boekingsdatum), dan pas downloaden.
  const [open, setOpen] = useState(false);
  const def = uitgavenDefaultRange();
  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);

  const run = async () => {
    setBusy(true); setError(null);
    try {
      // Leasing-export volgt de actieve consolidatiescope van de cockpit.
      const exclude = kind === "leasing"
        ? new URL(window.location.href).searchParams.get("exclude") || ""
        : "";
      const range = withRange ? `?from=${from}&to=${to}` : "";
      const res = await fetch(`/api/cfo/export/${kind}${range}${exclude ? `${range ? "&" : "?"}exclude=${encodeURIComponent(exclude)}` : ""}`);
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
      a.download = m?.[1] || `${kind === "ap" ? "Leveranciersaging" : kind === "ar" ? "Klantenaging" : kind === "uitgaven" ? "Overzicht uitgaven" : "Leasing cash-out"}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      if (stamp) setPulledAt(new Date(stamp).toLocaleString("nl-BE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export mislukt");
    } finally {
      setBusy(false);
    }
  };

  // presets voor de datumprompt (boekjaar = kalenderjaar)
  const year = Number(def.to.slice(0, 4)); // jaar van de laatste volledige maand (Brussel)
  const presetsRaw: { label: string; from: string; to: string }[] = [
    { label: "Vorige maand", from: `${uitgavenDefaultRange().to.slice(0, 8)}01`, to: uitgavenDefaultRange().to },
    { label: "Q1", from: `${year}-01-01`, to: `${year}-03-31` },
    { label: "Q2", from: `${year}-04-01`, to: `${year}-06-30` },
    { label: "H1", from: `${year}-01-01`, to: `${year}-06-30` },
    { label: "Dit jaar t/m vorige maand", from: def.from, to: def.to },
    { label: `Heel ${year - 1}`, from: `${year - 1}-01-01`, to: `${year - 1}-12-31` },
  ];
  // In januari vallen "Dit jaar t/m vorige maand" en "Heel vorig jaar" samen —
  // dubbele chips (allebei actief gemarkeerd) wegfilteren op identieke periode.
  const seen = new Set<string>();
  const presets = presetsRaw.filter((p) => { const k = `${p.from}|${p.to}`; if (seen.has(k)) return false; seen.add(k); return true; });

  return (
    <div>
      <button
        onClick={() => (withRange ? setOpen((o) => !o) : run())}
        disabled={busy}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-muted px-3 py-2.5 text-left text-sm font-medium text-foreground transition hover:bg-primary/10 hover:text-primary disabled:opacity-60"
      >
        <span>{label}</span>
        {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" /> : <Download className="h-4 w-4 shrink-0 text-primary" />}
      </button>
      {withRange && open && !busy && (
        <div className="mt-1.5 space-y-2 rounded-xl border border-border bg-background/60 p-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Periode (boekingsdatum)</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {presets.map((pz) => (
              <button
                key={pz.label}
                onClick={() => { setFrom(pz.from); setTo(pz.to); }}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 transition ${from === pz.from && to === pz.to ? "bg-primary/15 text-primary ring-primary/40" : "bg-muted text-muted-foreground ring-border hover:text-foreground"}`}
              >
                {pz.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              van
              <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)}
                className="rounded-lg border border-border bg-background px-2 py-1 text-[11px] text-foreground" />
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              tot
              <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)}
                className="rounded-lg border border-border bg-background px-2 py-1 text-[11px] text-foreground" />
            </label>
            <button
              onClick={() => { setOpen(false); run(); }}
              disabled={!from || !to || from > to}
              className="ml-auto rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              Download
            </button>
          </div>
          <p className="text-[10px] leading-snug text-muted-foreground">Let op: de lopende maand is onvolledig zolang de loonverwerking niet geboekt is (lonen van maand X worden begin maand X+1 geboekt).</p>
        </div>
      )}
      {busy && <p className="mt-1 text-[10px] text-muted-foreground">Live aan het trekken uit BC (alle vennootschappen) — kan ± 1 min duren…</p>}
      {pulledAt && !busy && <p className="mt-1 text-[10px] text-positive">✓ Data getrokken op {pulledAt}</p>}
      {error && !busy && <p className="mt-1 text-[10px] text-negative">{error}</p>}
    </div>
  );
}

// ---- helpers ----
// `period` = altijd zichtbare periode-badge met EXACTE datums (finance mag nooit
// moeten twijfelen waarover een cijfer gaat). `explain` = openklapbare uitleg:
// wat staat er precies, en hoe komen we eraan.
// Compacte cashflow-teaser (vervangt de oude 13-wekengrafiek op vervaldatum):
// drie kerncijfers uit de échte prognose + één grote knop. Dummy-proof.
function CashforecastTeaser() {
  const fc = usePolledData<{
    bankNow: number;
    lowPoint: { noFactor: { week: string; value: number }; withFactor: { week: string; value: number } };
  }>("/api/cfo/cashforecast");
  const d = fc.data;
  const money = (v: number) => {
    const a = Math.abs(v), sign = v < 0 ? "−" : "";
    return a >= 950_000
      ? `${sign}€ ${(a / 1e6).toLocaleString("nl-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}M`
      : `${sign}€ ${Math.round(a / 1000).toLocaleString("nl-BE")}k`;
  };
  const wk = (isoStr: string) => (isoStr ? `week van ${isoStr.slice(8, 10)}/${isoStr.slice(5, 7)}` : "");
  const stat = (label: string, value: string, sub: string, neg: boolean) => (
    <div className="rounded-xl border border-border bg-muted/30 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-lg font-bold tabular-nums ${neg ? "text-negative" : "text-foreground"}`}>{value}</p>
      <p className="text-[10px] text-muted-foreground">{sub}</p>
    </div>
  );
  return (
    <section className="rounded-2xl border border-border bg-card p-5 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-foreground">Cashflowprognose — 13 weken vooruit</h2>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground ring-1 ring-border">live</span>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
        Wanneer komt het geld binnen, wanneer knelt het — op betaalgedrag per klant, zonder en mét factoring naast elkaar.
      </p>
      {d ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {stat("Bankstand nu (eigen)", money(d.bankNow), "excl. factorkrediet", d.bankNow < 0)}
          {stat("Laagste punt — zonder factoring", money(d.lowPoint.noFactor.value), wk(d.lowPoint.noFactor.week), d.lowPoint.noFactor.value < 0)}
          {stat("Laagste punt — mét factoring", money(d.lowPoint.withFactor.value), wk(d.lowPoint.withFactor.week), d.lowPoint.withFactor.value < 0)}
        </div>
      ) : (
        <p className="mt-3 inline-flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          {fc.error ? "Prognose kon niet laden — open de pagina voor detail." : "Prognose wordt opgebouwd…"}
        </p>
      )}
      <a
        href="/cfo/cashflow"
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition hover:opacity-90"
      >
        Open de volledige cashflowprognose <ChevronRight className="h-4 w-4" />
      </a>
    </section>
  );
}

function Card({ title, hint, source, period, explain, right, children }: {
  title: string; hint?: string; source?: string; period?: string; explain?: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 backdrop-blur">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {period && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground ring-1 ring-border" title={`Periode: ${period}`}>
              {period}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {right}
          {hint && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-border">{hint}</span>}
        </div>
      </div>
      {children}
      {(source || explain) && (
        <details className="group mt-2.5 border-t border-border pt-2">
          <summary className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-muted px-2 py-1 text-[10px] font-semibold text-muted-foreground ring-1 ring-border transition hover:bg-primary/10 hover:text-primary hover:ring-primary/40">
            <Info className="h-3 w-3" />bron &amp; uitleg
          </summary>
          <div className="mt-2 space-y-1.5">
            {period && <p className="text-[11px] leading-snug text-foreground"><b>Periode:</b> {period}</p>}
            {explain && <p className="text-[11px] leading-snug text-muted-foreground">{explain}</p>}
            {source && <p className="text-[11px] leading-snug text-muted-foreground"><b className="text-foreground">Bron in Business Central:</b> {source}</p>}
          </div>
        </details>
      )}
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
