"use client";

// Business Units & Activa — operationele P&L per AFDELING-dimensie
// (Grootboekposten_Excel) + facturatie/DSO per unit (klantposten) + vaste activa
// (FALedgerEntries). Zelfde poll-patroon en designtaal als Klanten & Cash.

import { useEffect, useMemo, useState } from "react";
import * as echarts from "echarts";
import type { CfoReceivables } from "@/lib/types";
import type { CfoUnits } from "@/lib/units";
import type { CfoIcBtw } from "@/lib/ic-btw";
import type { CfoAssets } from "@/lib/assets";
import { EChart } from "./echart";
import { formatCurrency, formatCurrencyCompact } from "@/lib/utils";
import { useChartPalette } from "@/lib/chart-theme";
import { usePolledData, Card, Kpi, KpiSourceModal, eurAxis, fmtStamp, fmtMonth, fmtDate } from "./cfo-ui";
import type { KpiSource } from "./cfo-ui";
import { Loader2, RefreshCcw, AlertTriangle, ArrowLeft, X, ExternalLink } from "lucide-react";

// Periode-presets voor de datumkiezer (vraag David 13/08/2026). Boekjaar = kalenderjaar.
function rangePresets(): { label: string; from: string; to: string }[] {
  const now = new Date();
  const y = now.getFullYear();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = iso(now);
  const prevEnd = new Date(y, now.getMonth(), 0);
  const prevStart = new Date(prevEnd.getFullYear(), prevEnd.getMonth(), 1);
  return [
    { label: "YTD", from: `${y}-01-01`, to: today },
    { label: "Vorige maand", from: iso(prevStart), to: iso(prevEnd) },
    { label: "Q1", from: `${y}-01-01`, to: `${y}-03-31` },
    { label: "Q2", from: `${y}-04-01`, to: `${y}-06-30` },
    { label: "H1", from: `${y}-01-01`, to: `${y}-06-30` },
    { label: `Heel ${y - 1}`, from: `${y - 1}-01-01`, to: `${y - 1}-12-31` },
  ];
}

// ---- drill-down: wat zit er onder een kosten-/omzetregel (vraag David 13/08/2026) ----
interface DrillRow { company: string; account: string; name: string; amount: number; kind: "income" | "expense"; bcUrl: string }
interface DrillData { rows: DrillRow[]; totals: { revenue: number; costs: number }; count: number; capped: boolean; warning?: string }

function DrillPanel({ title, query, onClose }: { title: string; query: string; onClose: () => void }) {
  const [d, setD] = useState<DrillData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Reset gebeurt via key={query} op de aanroepplek (remount per drill) — geen
  // synchrone setState in de effect-body (react-hooks/set-state-in-effect).
  useEffect(() => {
    let dead = false;
    fetch(`/api/cfo/units/drill?${query}`)
      .then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || `HTTP ${r.status}`); return r.json(); })
      .then((j) => { if (!dead) setD(j); })
      .catch((e) => { if (!dead) setErr(String(e.message || e).slice(0, 160)); });
    return () => { dead = true; };
  }, [query]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <button onClick={onClose} aria-label="Sluiten" className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="max-h-[calc(85vh-52px)] overflow-y-auto p-4">
          {!d && !err && <p className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Rekeningen ophalen uit BC…</p>}
          {err && <p className="py-6 text-center text-xs text-warning">{err}</p>}
          {d && (
            <>
              <div className="mb-3 flex flex-wrap gap-4 text-[11px] text-muted-foreground">
                {d.totals.revenue !== 0 && <span>Omzet: <b className="text-positive">{formatCurrency(d.totals.revenue)}</b></span>}
                {d.totals.costs !== 0 && <span>Kosten: <b className="text-foreground">{formatCurrency(d.totals.costs)}</b></span>}
                {d.totals.revenue !== 0 && d.totals.costs !== 0 && <span>Resultaat: <b className={d.totals.revenue - d.totals.costs >= 0 ? "text-positive" : "text-negative"}>{formatCurrency(d.totals.revenue - d.totals.costs)}</b></span>}
                <span>{d.count} rekening-regels{d.capped ? ` (grootste ${d.rows.length} getoond)` : ""}</span>
              </div>
              {d.warning && <p className="mb-2 rounded-lg bg-warning/10 p-2 text-[11px] text-warning">{d.warning}</p>}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-2 py-1.5 text-left">Rekening</th>
                      <th className="px-2 py-1.5 text-left">Naam</th>
                      <th className="px-2 py-1.5 text-left">Firma</th>
                      <th className="px-2 py-1.5 text-right">Bedrag</th>
                      <th className="px-2 py-1.5 text-right">BC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((r) => (
                      <tr key={`${r.company}-${r.account}`} className="border-b border-border/40">
                        <td className="px-2 py-1.5 font-mono text-[11px] font-semibold text-foreground">{r.account}</td>
                        <td className="max-w-[260px] truncate px-2 py-1.5 text-muted-foreground" title={r.name}>{r.name || "—"}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{r.company}</td>
                        <td className={`px-2 py-1.5 text-right font-semibold tabular-nums ${r.kind === "income" ? "text-positive" : "text-foreground"}`}>{formatCurrency(r.amount)}</td>
                        <td className="px-2 py-1.5 text-right">
                          <a href={r.bcUrl} target="_blank" rel="noopener noreferrer" title="Alle posten van deze rekening in Business Central" className="inline-flex items-center gap-1 text-primary hover:underline">open<ExternalLink className="h-3 w-3" /></a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground">Bedragen teken-genormaliseerd (omzet positief, kosten debet-normaal), zelfde venster als de pagina. De BC-link opent álle posten van die rekening bij die firma (vindplaats; BC-login vereist).</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function UnitsView({ exclude }: { exclude: string[] }) {
  // Datumrange (default YTD) — de hele pagina volgt dit venster.
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [draft, setDraft] = useState<{ from: string; to: string } | null>(null);
  const presets = useMemo(() => rangePresets(), []);
  const rangeQs = range ? `from=${range.from}&to=${range.to}` : "";
  const parts = [exclude.length ? `exclude=${exclude.join(",")}` : "", rangeQs].filter(Boolean);
  const qs = parts.length ? `?${parts.join("&")}` : "";
  const qsExcl = exclude.length ? `?exclude=${exclude.join(",")}` : "";
  const units = usePolledData<CfoUnits>(`/api/cfo/units${qs}`);
  const icbtw = usePolledData<CfoIcBtw>(`/api/cfo/ic-btw${qs}`);
  // CEO-signalen rekenen ALTIJD op afgesloten maanden (1 jan t/m einde vorige maand),
  // los van de gekozen pagina-range — anders maakt de lopende-maand-vertekening
  // (kosten geboekt, omzet nog niet) valse "fix"-signalen (vraag David 14/08/2026).
  const closed = useMemo(() => {
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { from: `${end.getFullYear()}-01-01`, to: iso(end) };
  }, []);
  const closedQs = [`from=${closed.from}&to=${closed.to}`, exclude.length ? `exclude=${exclude.join(",")}` : ""].filter(Boolean).join("&");
  const sig = usePolledData<CfoUnits>(`/api/cfo/units?${closedQs}`);
  const [icTab, setIcTab] = useState<"btw" | "omzet">("btw");
  const assets = usePolledData<CfoAssets>(`/api/cfo/assets${qsExcl}`);
  const rcv = usePolledData<CfoReceivables>(`/api/cfo/receivables${qsExcl}`);
  const p = useChartPalette();
  const u = units.data;
  const [kpiSrc, setKpiSrc] = useState<KpiSource | null>(null);
  const [drill, setDrill] = useState<{ title: string; query: string } | null>(null);

  // Periode: elk cijfer op deze pagina draagt zichtbaar over welke periode het gaat.
  const vandaag = fmtDate(new Date().toISOString().slice(0, 10));
  const perYtd = u?.from ? `${fmtDate(u.from)} t/m ${fmtDate(u.to)}` : u ? `01/01/${u.year} t/m ${vandaag}` : "gekozen periode";
  const drillRange = u?.from ? `from=${u.from}&to=${u.to}` : `from=${new Date().getFullYear()}-01-01&to=${new Date().toISOString().slice(0, 10)}`;
  const drillExcl = exclude.length ? `&exclude=${exclude.join(",")}` : "";
  const openCompanyDrill = (code: string, activity: string) =>
    setDrill({ title: `${code} · ${activity} — omzet & kosten per rekening (${perYtd})`, query: `company=${code}&${drillRange}` });
  const openClassDrill = (cls: string, label: string) =>
    setDrill({ title: `Klasse ${cls} · ${label} — per rekening, alle firma's (${perYtd})`, query: `cls=${cls}&${drillRange}${drillExcl}` });
  const src = (
    label: string, value: string, periode: string, watStaatEr: string, hoeKomenWeEraan: string,
    delen?: { naam: string; waarde: string }[], excel?: string, caveat?: string,
  ): KpiSource => ({
    label: `${label} — ${periode}`,
    value,
    formule: { tekst: watStaatEr, delen: [{ naam: "PERIODE", waarde: periode }, ...(delen ?? [])] },
    bron: hoeKomenWeEraan, excel, caveat,
  });

  // AFDELING-hygiëne: mini-fragmenten (< €100k volume) zijn tagging-ruis; en een marge
  // is alleen betekenisvol als omzet én kosten substantieel getagd zijn (geen -11.776%-
  // artefacten van eenzijdige tagging, geen marges op pure kostenplaatsen).
  const TAGGED_MIN = 100_000;
  const taggedUnits = useMemo(() => (u ? u.units.filter((x) => x.revenue + x.costs >= TAGGED_MIN) : []), [u]);
  const hiddenUnits = u ? u.units.length - taggedUnits.length : 0;
  const marginReliable = (x: { revenue: number; costs: number }) =>
    Math.min(x.revenue, x.costs) / Math.max(x.revenue, x.costs, 1) >= 0.2;

  const revStack = useMemo<echarts.EChartsOption | null>(() => {
    if (!u) return null;
    const top = taggedUnits.slice(0, 8);
    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => formatCurrency(Number(v)) },
      legend: { data: top.map((x) => x.label), textStyle: { color: p.text, fontSize: 10 }, top: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10, type: "scroll" },
      grid: { top: 46, left: 6, right: 8, bottom: 20, containLabel: true },
      xAxis: { type: "category", data: u.months.map(fmtMonth), axisLabel: { color: p.text, fontSize: 9 }, axisLine: { lineStyle: { color: p.axis } }, axisTick: { show: false } },
      yAxis: { type: "value", axisLabel: { color: p.textMuted, formatter: (v: number) => eurAxis(v) }, splitLine: { lineStyle: { color: p.grid } } },
      series: top.map((x, i) => ({
        name: x.label, type: "bar" as const, stack: "rev", data: x.monthlyRevenue,
        itemStyle: { color: p.categorical[i % p.categorical.length] }, barMaxWidth: 26,
      })),
    };
  }, [u, taggedUnits, p]);

  // Omzet vs kosten per AFDELING als aparte balken — GEEN marge-claim: bij eenzijdige
  // tagging of kostenplaatsen (Overhead) is een marge betekenisloos; de tooltip toont
  // de marge alleen wanneer beide kanten substantieel getagd zijn.
  const revCostBars = useMemo<echarts.EChartsOption | null>(() => {
    if (!u) return null;
    const rows = [...taggedUnits].sort((a, b) => (b.revenue + b.costs) - (a.revenue + a.costs));
    return {
      tooltip: {
        trigger: "axis", axisPointer: { type: "shadow" },
        formatter: (prs: unknown) => {
          const pr = (prs as { dataIndex: number }[])[0];
          const r = rows[pr.dataIndex]; if (!r) return "";
          const marge = marginReliable(r) ? `Resultaat <b>${formatCurrency(r.result)}</b> (${r.marginPct}%)` : "Marge n.b. — eenzijdig getagd of kostenplaats";
          return `${r.label} <span style="opacity:.6">${r.code}</span><br/>Getagde omzet: <b>${formatCurrency(r.revenue)}</b><br/>Getagde kosten: <b>${formatCurrency(r.costs)}</b><br/>${marge}`;
        },
      },
      legend: { data: ["Getagde omzet", "Getagde kosten"], textStyle: { color: p.text, fontSize: 10 }, top: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10, type: "scroll" },
      grid: { top: 28, left: 6, right: 14, bottom: 20, containLabel: true },
      xAxis: { type: "value", axisLabel: { color: p.textMuted, formatter: (v: number) => eurAxis(v) }, splitLine: { lineStyle: { color: p.grid } } },
      yAxis: { type: "category", inverse: true, data: rows.map((r) => r.label), axisLabel: { color: p.text, fontSize: 10, interval: 0 }, axisLine: { lineStyle: { color: p.axis } }, axisTick: { show: false } },
      series: [
        { name: "Getagde omzet", type: "bar", data: rows.map((r) => r.revenue), itemStyle: { color: p.income, borderRadius: [0, 3, 3, 0] }, barMaxWidth: 12 },
        { name: "Getagde kosten", type: "bar", data: rows.map((r) => r.costs), itemStyle: { color: p.expense, borderRadius: [0, 3, 3, 0] }, barMaxWidth: 12 },
      ],
    };
  }, [u, taggedUnits, p]);

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
              <a href="/cfo/pnl" className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground ring-1 ring-border hover:text-foreground">Management-P&L →</a>
              <a href="/cfo/formularium" title="Elk begrip: wat het betekent, de formule, de bron en waarop het gebaseerd is" className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary ring-1 ring-primary/30 hover:bg-primary/15">Formularium</a>
              <h1 className="text-lg font-bold text-foreground">Business Units & Activa</h1>
              {!u.isLive && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold uppercase text-warning">demo</span>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Operationele P&L per activiteit, <b className="text-foreground">{perYtd}</b> · bedragen excl. btw, bruto (incl. intercompany) · klik een rij voor het rekeningdetail.</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {presets.map((pz) => {
                const active = range ? range.from === pz.from && range.to === pz.to : pz.label === "YTD";
                return (
                  <button key={pz.label} onClick={() => { setRange(pz.label === "YTD" ? null : { from: pz.from, to: pz.to }); setDraft(null); }}
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ring-1 transition ${active ? "bg-primary text-primary-foreground ring-primary" : "bg-muted text-muted-foreground ring-border hover:text-foreground"}`}>
                    {pz.label}
                  </button>
                );
              })}
              <span className="mx-1 text-[10px] text-muted-foreground">of</span>
              <input type="date" value={(draft ?? range ?? { from: "", to: "" }).from} max={(draft ?? range)?.to || undefined}
                onChange={(e) => setDraft({ from: e.target.value, to: (draft ?? range)?.to || "" })}
                className="rounded-lg border border-border bg-background px-1.5 py-0.5 text-[10px] text-foreground" aria-label="Van datum" />
              <input type="date" value={(draft ?? range ?? { from: "", to: "" }).to} min={(draft ?? range)?.from || undefined}
                onChange={(e) => setDraft({ from: (draft ?? range)?.from || "", to: e.target.value })}
                className="rounded-lg border border-border bg-background px-1.5 py-0.5 text-[10px] text-foreground" aria-label="Tot datum" />
              <button disabled={!draft || !draft.from || !draft.to || draft.from > draft.to}
                onClick={() => { if (draft) { setRange(draft); setDraft(null); } }}
                className="rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-semibold text-primary-foreground disabled:opacity-40">
                Toepassen
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>Data per <b className="text-foreground">{fmtStamp(u.asOf)}</b></span>
            {u.refreshing && <span className="inline-flex items-center gap-1 text-primary"><Loader2 className="h-3 w-3 animate-spin" />vernieuwt…</span>}
            <button onClick={() => units.reload(true)} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 font-semibold ring-1 ring-border hover:text-foreground"><RefreshCcw className="h-3 w-3" />Vernieuwen</button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label="Omzet (bruto)" value={formatCurrencyCompact(totRev)} sub={`${perYtd} · klassen 70–74, excl. btw, incl. IC`}
          onClick={() => setKpiSrc(src(
            "Omzet bruto, alle vennootschappen", formatCurrency(totRev), perYtd,
            "Alle bedrijfsopbrengsten van de elf vennootschappen samen, opgeteld zonder de intra-groepsomzet eruit te halen (daarom 'bruto'). Excl. btw, want dit is een resultatenrekening-cijfer.",
            "Grootboekposten_Excel: alle boekingen op de rekeningklassen 70, 71, 72 en 74, per vennootschap opgeteld. Bedrag = debet − credit (BC's grootboekposten hebben geen 'amount'-veld). Het geconsolideerde cijfer, waar de intercompany-omzet wél geëlimineerd is, staat in de kaart 'Geconsolideerde P&L' verder op deze pagina.",
            [{ naam: "Bruto (som van de firma's)", waarde: formatCurrency(totRev) },
             { naam: "Waarvan intercompany", waarde: formatCurrency(u.consolidated.totals.revenueIc) },
             { naam: "= Geconsolideerd (extern)", waarde: formatCurrency(totRev - (u.consolidated.totals.revenueIc)) }],
            undefined,
            u.nonRecurringRev ? `${formatCurrency(u.nonRecurringRev)} niet-recurrente verkoop van gebouwen (GPR, rekening 705200) is hier BEWUST uitgehouden — anders zou dat ±18% van de "omzet" zijn en GPR een marge van 99% geven.` : "Het venster loopt tot vandaag: de omzet van de lopende maand is nog niet volledig geboekt terwijl de kosten er al in zitten.",
          ))}
        />
        <Kpi
          label="Operationeel resultaat" value={formatCurrencyCompact(totRes)} sub={`${perYtd} · omzet − operationele kosten`} tone={totRes >= 0 ? "pos" : "neg"}
          onClick={() => setKpiSrc(src(
            "Operationeel resultaat, alle vennootschappen", formatCurrency(totRes), perYtd,
            "De bedrijfsopbrengsten min de bedrijfskosten van alle vennootschappen samen. Dit is het resultaat vóór financiële lasten, uitzonderlijke posten en belastingen — het zegt hoe de exploitatie zelf presteert.",
            "Grootboekposten_Excel: klassen 70–74 min klassen 60–64. Klasse 63 (afschrijvingen) zit hier IN, dus dit is een EBIT-cijfer, geen EBITDA. Klassen 68/69/78/79 (resultaatverwerking) blijven buiten beschouwing, conform het Belgische MAR.",
            [{ naam: "Bedrijfsopbrengsten (70–74)", waarde: formatCurrency(totRev) },
             { naam: "Bedrijfskosten (60–64, incl. afschrijvingen)", waarde: formatCurrency(u.perCompany.reduce((s, x) => s + x.costs, 0)) },
             { naam: "= Operationeel resultaat (EBIT)", waarde: formatCurrency(totRes) }],
            undefined,
            "Belangrijke jaareinde-caveat: afschrijvingen en belastingen worden bij Gheeraert grotendeels op 31/12 geboekt. Een YTD-resultaat in de loop van het jaar is dus systematisch te positief tegenover het jaarcijfer.",
          ))}
        />
        <Kpi
          label="Sterkste activiteit" value={best ? `${best.code} · ${best.activity}` : "—"} sub={best ? `${perYtd} · ${formatCurrency(best.result)} · marge ${best.marginPct}%` : undefined} tone="pos"
          onClick={() => best && setKpiSrc(src(
            `Sterkste activiteit: ${best.code} — ${best.activity}`, formatCurrency(best.result), perYtd,
            "De vennootschap met het hoogste operationele resultaat in deze periode. We rangschikken op resultaat in euro, niet op marge-percentage: een kleine firma met een hoge marge levert de groep minder op dan een grote met een normale marge.",
            "Grootboekposten_Excel per vennootschap: klassen 70–74 min klassen 60–64. Dezelfde berekening als in de tabel eronder, waar je alle firma's naast elkaar ziet.",
            [{ naam: "Omzet", waarde: formatCurrency(best.revenue) },
             { naam: "Kosten", waarde: formatCurrency(best.costs) },
             { naam: "= Resultaat", waarde: formatCurrency(best.result) },
             { naam: "Marge", waarde: `${best.marginPct}%` },
             { naam: "Waarvan omzet intra-groep", waarde: `${best.icRevenuePct}%` }],
            undefined,
            "Let op de IC-omzet: een firma die vooral aan zusterondernemingen factureert, verdient dat resultaat binnen de groep — op geconsolideerd niveau valt dat weg. Kijk daarvoor naar de kaart 'Geconsolideerde P&L'.",
          ))}
        />
        <Kpi
          label="Zwakste activiteit" value={worst ? `${worst.code} · ${worst.activity}` : "—"} sub={worst ? `${perYtd} · ${formatCurrency(worst.result)} · marge ${worst.marginPct}%` : undefined} tone={worst && worst.result < 0 ? "neg" : "neutral"}
          onClick={() => worst && setKpiSrc(src(
            `Zwakste activiteit: ${worst.code} — ${worst.activity}`, formatCurrency(worst.result), perYtd,
            "De vennootschap met het laagste operationele resultaat in deze periode — het verlies of de dunste marge van de groep.",
            "Grootboekposten_Excel per vennootschap: klassen 70–74 min klassen 60–64, identiek aan de tabel eronder.",
            [{ naam: "Omzet", waarde: formatCurrency(worst.revenue) },
             { naam: "Kosten", waarde: formatCurrency(worst.costs) },
             { naam: "= Resultaat", waarde: formatCurrency(worst.result) },
             { naam: "Marge", waarde: `${worst.marginPct}%` }],
            undefined,
            "Een holding- of vastgoedvennootschap draagt vaak kosten zonder eigen omzet en staat daardoor structureel onderaan zonder dat er iets mis is. Lees dit cijfer altijd samen met de activiteit ernaast.",
          ))}
        />
        <Kpi
          label="AFDELING-dekking" value={`${Math.round(100 - u.undimensioned.sharePct)}%`} sub={`${perYtd} · ${u.undimensioned.sharePct}% van het P&L-volume mist de dimensie (vooral GDI/overnames)`} tone={u.undimensioned.sharePct > 10 ? "warn" : "pos"}
          onClick={() => setKpiSrc(src(
            "AFDELING-dekking van de boekhouding", `${Math.round(100 - u.undimensioned.sharePct)}%`, perYtd,
            "Welk deel van alle P&L-boekingen een AFDELING-dimensie draagt. Dit is een DATAKWALITEITSCIJFER, geen financieel cijfer: het bepaalt of je de twee dimensie-grafieken op deze pagina mag vertrouwen. Bij lage dekking mist die laag hele activiteiten.",
            "Grootboekposten_Excel: het aandeel van het absolute boekingsvolume op de klassen 60–74 waarbij het dimensieveld AFDELING gevuld is. De kolom 'AFDELING-dekking' in de tabel eronder toont dit per vennootschap.",
            [{ naam: "Volume MET AFDELING-tag", waarde: `${Math.round(100 - u.undimensioned.sharePct)}%` },
             { naam: "Volume ZONDER tag", waarde: `${u.undimensioned.sharePct}%` },
             { naam: "Omzet zonder tag", waarde: formatCurrency(u.undimensioned.revenue) },
             { naam: "Kosten zonder tag", waarde: formatCurrency(u.undimensioned.costs) }],
            undefined,
            "GDI tagt 0% van zijn boekingen, dus de distributie-activiteit ontbreekt volledig in de dimensie-grafieken — dat is precies waarom de tabel per vennootschap de leidende laag is en de dimensie-laag de aanvulling.",
          ))}
        />
        <Kpi
          label="CAPEX (netto)" value={assets.data ? formatCurrencyCompact(assets.data.totals.acquisitionYtd) : "…"} sub={assets.data ? `${perYtd} · boekwaarde ${formatCurrency(assets.data.totals.bookValue)} · na correcties/desinvest.` : "vaste activa laden…"}
          onClick={() => assets.data && setKpiSrc(src(
            "CAPEX netto (investeringen in vaste activa)", formatCurrency(assets.data.totals.acquisitionYtd), perYtd,
            "Wat we dit jaar netto in vaste activa geïnvesteerd hebben: aanschaffingen min correcties en desinvesteringen. 'Netto' is hier belangrijk — een bruto-aanschafcijfer zou de verkochte trekkers en trailers niet aftrekken en de investering overschatten.",
            "FALedgerEntries (vaste-activaposten) van alle vennootschappen, gefilterd op het aanschaffingsboek van dit jaar. Boekwaarde = aanschafwaarde min geboekte afschrijvingen op dezelfde posten.",
            [{ naam: "Netto-aanschaffingen", waarde: formatCurrency(assets.data.totals.acquisitionYtd) },
             { naam: "Afschrijving in deze periode", waarde: formatCurrency(assets.data.totals.depreciationYtd) },
             { naam: "Boekwaarde vaste activa", waarde: formatCurrency(assets.data.totals.bookValue) },
             { naam: "Aantal activa in het register", waarde: `${assets.data.totals.assetCount}` }],
            undefined,
            "Afschrijvingen worden grotendeels op 31/12 geboekt, dus de afschrijving YTD is in de loop van het jaar veel lager dan pro rata en de boekwaarde overeenkomstig hoger. Leasing die niet geactiveerd wordt, zit hier niet in — die staat als kost in de leasingkaart op de cockpit.",
          ))}
        />
      </div>

      <Card
        title="Fix / geen fix — CEO-signalen"
        period={sig.data?.from ? `${fmtDate(sig.data.from)} t/m ${fmtDate(sig.data.to)} (afgesloten maanden)` : "afgesloten maanden"}
        hint="Bewust NIET op de gekozen range hierboven: signalen rekenen altijd op volledige maanden, zodat de lopende-maand-vertekening geen valse verliezen toont. Elke regel zegt of het een marktprobleem is (fixen) of een interne verklaring heeft (niet fixen)."
        onSource={() => sig.data && setKpiSrc(src(
          "CEO-signalen: fix / geen fix", `${sig.data.perCompany.length} vennootschappen beoordeeld`,
          `${fmtDate(sig.data.from)} t/m ${fmtDate(sig.data.to)} — uitsluitend afgesloten maanden`,
          "Per vennootschap een oordeel op basis van drie gecontroleerde cijfers: het operationele resultaat, de marge en het aandeel intercompany-omzet. De regels: verlies bij een firma die vooral aan de markt verkoopt = FIXEN (rood); verlies bij een firma die vooral intern factureert = interne verrekenprijs, geen marktprobleem (geel, gesprek over prijszetting); dunne marge (< 2%) op substantiële omzet = opvolgen (geel); de rest is gezond (groen).",
          "Zelfde bron en berekening als de tabel 'Per vennootschap' (Grootboekposten_Excel, klassen 70–74 en 60–64), maar dan over een vast venster van afgesloten maanden. De omzetcijfers zijn dubbel geverifieerd: het grootboek sluit per firma op < 1% aan op de geboekte verkoopfacturen (kruisverificatie 14/08/2026), en de omzetdefinitie reproduceerde EMAsphere's gevalideerde maartcijfer tot op € 1.",
          [{ naam: "Venster", waarde: `${fmtDate(sig.data.from)} – ${fmtDate(sig.data.to)}` },
           { naam: "Niet-recurrent uitgesloten (verkoop gebouwen GPR)", waarde: formatCurrency(sig.data.nonRecurringRev) },
           { naam: "Geconsolideerd EBIT (na IC-eliminatie)", waarde: formatCurrency(sig.data.consolidated.totals.ebitNet) }],
          undefined,
          "Jaareinde-caveat blijft gelden: afschrijvingen en belastingen worden grotendeels op 31/12 geboekt, dus elk YTD-resultaat is rooskleuriger dan het jaarcijfer wordt. Een groen signaal betekent 'geen operationeel alarm', geen winstgarantie.",
        ))}
      >
        {!sig.data && <p className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />{sig.building ? "Afgesloten maanden worden opgebouwd uit BC…" : "Laden…"}</p>}
        {sig.data && (() => {
          type Sig = { tone: "fix" | "watch" | "ok"; code: string; activity: string; titel: string; uitleg: string; bedrag: number };
          const rows: Sig[] = sig.data.perCompany.map((c) => {
            if (c.result < 0 && c.icRevenuePct < 50) return {
              tone: "fix" as const, code: c.code, activity: c.activity, bedrag: c.result,
              titel: `Verlies op de markt: ${formatCurrency(c.result)}`,
              uitleg: `Omzet ${formatCurrency(c.revenue)}, kosten ${formatCurrency(c.costs)}, marge ${c.marginPct}% — en maar ${c.icRevenuePct}% van de omzet is intern, dus dit verlies komt van externe klanten. Klik de firma in de tabel eronder om te zien op welke rekeningen het zit.`,
            };
            if (c.result < 0) return {
              tone: "watch" as const, code: c.code, activity: c.activity, bedrag: c.result,
              titel: `Verlies, maar ${c.icRevenuePct}% interne omzet`,
              uitleg: `Resultaat ${formatCurrency(c.result)} bij vooral intra-groep-facturatie: dit is een verrekenprijs-kwestie (te lage interne tarieven), geen marktprobleem. Fixen = interne prijszetting herzien, niet de operatie.`,
            };
            if (c.marginPct < 2 && c.revenue > 1_000_000) return {
              tone: "watch" as const, code: c.code, activity: c.activity, bedrag: c.result,
              titel: `Dunne marge: ${c.marginPct}% op ${formatCurrencyCompact(c.revenue)}`,
              uitleg: `Resultaat ${formatCurrency(c.result)} — positief maar zonder buffer; één tegenvaller duwt dit onder nul. Opvolgen via de drill-down (grootste kostenrekeningen).`,
            };
            return {
              tone: "ok" as const, code: c.code, activity: c.activity, bedrag: c.result,
              titel: `Gezond: marge ${c.marginPct}%`,
              uitleg: `Resultaat ${formatCurrency(c.result)} op ${formatCurrencyCompact(c.revenue)} omzet${c.icRevenuePct >= 50 ? ` (let wel: ${c.icRevenuePct}% interne omzet — groepsdienst)` : ""}.`,
            };
          });
          const order = { fix: 0, watch: 1, ok: 2 } as const;
          rows.sort((a, b) => order[a.tone] - order[b.tone] || a.bedrag - b.bedrag);
          const badge = (t: Sig["tone"]) => t === "fix"
            ? <span className="shrink-0 rounded-full bg-negative/15 px-2 py-0.5 text-[10px] font-bold uppercase text-negative">Fixen</span>
            : t === "watch"
            ? <span className="shrink-0 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold uppercase text-warning">Opvolgen</span>
            : <span className="shrink-0 rounded-full bg-positive/15 px-2 py-0.5 text-[10px] font-bold uppercase text-positive">OK</span>;
          return (
            <div className="space-y-1.5">
              {rows.map((r) => (
                <div key={r.code} className={`flex items-start gap-3 rounded-xl border p-2.5 ${r.tone === "fix" ? "border-negative/30 bg-negative/5" : r.tone === "watch" ? "border-warning/25 bg-warning/5" : "border-border bg-background/40"}`}>
                  {badge(r.tone)}
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-foreground">{r.code} · {r.activity} — {r.titel}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{r.uitleg}</p>
                  </div>
                </div>
              ))}
              <p className="mt-2 rounded-lg bg-muted/60 p-2.5 text-[11px] leading-snug text-muted-foreground">
                <b className="text-foreground">Niet fixen (al verklaard):</b> de verkoop van gebouwen ({formatCurrency(sig.data.nonRecurringRev)}, GPR) is eenmalig en buiten alle cijfers gehouden · de lopende maand telt hier bewust niet mee · afschrijvingen/belastingen volgen grotendeels op 31/12, dus elk resultaat hier is vóór dat jaareinde-effect. Geconsolideerd EBIT na IC-eliminatie over dit venster: <b className={sig.data.consolidated.totals.ebitNet >= 0 ? "text-positive" : "text-negative"}>{formatCurrency(sig.data.consolidated.totals.ebitNet)}</b>.
              </p>
            </div>
          );
        })()}
      </Card>

      <Card
        title="Per vennootschap — de betrouwbare activiteiten-laag"
        period={perYtd}
        hint={`Alle kolommen gaan over dezelfde periode ${perYtd}. De firma's zíjn de activiteiten van de groep, dus dit beeld is volledig zonder dimensies nodig te hebben; IC-omzet% = het deel dat intra-groep gefactureerd is.`}
        onSource={() => setKpiSrc(src(
          "Resultaat per vennootschap", formatCurrency(totRes), perYtd,
          "Voor elk van de elf vennootschappen: de omzet, de kosten, het verschil, de marge en hoeveel van die omzet aan zusterondernemingen gefactureerd is. Dit is de LEIDENDE laag van deze pagina, want elke boeking hoort per definitie bij precies één vennootschap — anders dan bij de AFDELING-dimensie, die niet overal ingevuld is.",
          `Grootboekposten_Excel per vennootschap: omzet = klassen 70–74, kosten = klassen 60–64 (afschrijvingen inbegrepen). Bedrag = debet − credit. Intercompany wordt herkend op de tegenpartij van de boeking, en voor memoriaalposten aanvullend op de omschrijving. ${u.sources.find((s) => s.label.startsWith("Per vennootschap"))?.detail ?? ""}`,
          [{ naam: "Totale omzet bruto", waarde: formatCurrency(totRev) },
           { naam: "Totale kosten", waarde: formatCurrency(u.perCompany.reduce((s, x) => s + x.costs, 0)) },
           { naam: "= Operationeel resultaat", waarde: formatCurrency(totRes) },
           { naam: "Tegenpartij-dekking voor IC-detectie", waarde: `${u.consolidated.coveragePct}%` }],
          undefined,
          "Bedragen zijn BRUTO: de intra-groepsomzet zit er nog in (zie de IC-kolom). Voor het geconsolideerde groepsbeeld moet je de eliminatie-kaart hieronder gebruiken. Jaareinde-caveat: afschrijvingen en belastingen worden grotendeels op 31/12 geboekt.",
        ))}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-1.5 text-left">Vennootschap · activiteit</th>
                <th className="px-2 py-1.5 text-right" title={`Periode ${perYtd}`}>Omzet<br /><span className="font-normal normal-case">{perYtd}</span></th>
                <th className="px-2 py-1.5 text-right" title={`Periode ${perYtd}`}>Kosten<br /><span className="font-normal normal-case">{perYtd}</span></th>
                <th className="px-2 py-1.5 text-right">Resultaat</th>
                <th className="px-2 py-1.5 text-right">Marge</th>
                <th className="px-2 py-1.5 text-right">IC-omzet</th>
                <th className="px-2 py-1.5 text-right" title="Aandeel van het P&L-volume met AFDELING-dimensie — bepaalt of de dimensie-laag hieronder bruikbaar is voor deze firma">AFDELING-dekking</th>
              </tr>
            </thead>
            <tbody>
              {u.perCompany.map((c) => (
                <tr key={c.code} onClick={() => openCompanyDrill(c.code, c.activity)} title="Klik: omzet & kosten per grootboekrekening"
                    className="cursor-pointer border-b border-border/40 transition hover:bg-primary/5">
                  <td className="px-2 py-1.5 font-semibold text-primary underline decoration-dotted underline-offset-2">{c.code} <span className="font-normal text-muted-foreground no-underline">· {c.activity}</span></td>
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
          {u.nonRecurringRev ? <> <b className="text-foreground">Niet-recurrent apart:</b> {formatCurrency(u.nonRecurringRev)} verkoop gebouwen (GPR, rekening 705200) is uit álle cijfers op deze pagina gehouden — anders zou dat ~18% van de &quot;omzet&quot; zijn en GPR een marge van 99% geven.</> : null}
          {" "}Het venster loopt tot vandaag: recente omzet is nog niet volledig geboekt terwijl de kosten er al in zitten, dus de lopende maand drukt het resultaat.
        </p>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card
          title="AFDELING-dimensie: omzet per maand"
          period={`elke kalendermaand apart, ${perYtd}`}
          hint="⚠ Alleen boekingen mét AFDELING-tag (vooral GTR) — GDI's distributie-omzet zit hier NIET in, zie de firma-tabel hierboven."
          onSource={() => setKpiSrc(src(
            "Omzet per AFDELING per maand", `${Math.round(100 - u.undimensioned.sharePct)}% van het volume is getagd`,
            `elke kalendermaand afzonderlijk, ${perYtd}`,
            "De getagde omzet per maand, gestapeld per AFDELING. Dit toont het seizoenpatroon per activiteit — maar uitsluitend voor de boekingen die een AFDELING-tag dragen.",
            "Grootboekposten_Excel: 70x-omzetboekingen met een gevulde AFDELING-dimensie, gegroepeerd op boekingsmaand. Grootboekposten_Excel heeft alle acht dimensies inline beschikbaar, dus er is geen aparte dimensie-tabel nodig.",
            undefined, undefined,
            "Deze grafiek is INCOMPLEET en dat is geen fout in de data-ophaling maar in de tagging: GDI tagt 0% van zijn boekingen, dus de distributie-omzet ontbreekt hier volledig. Gebruik de tabel per vennootschap voor het volledige beeld en deze grafiek alleen voor de firma's die wél consequent taggen.",
          ))}
        >
          {revStack && <EChart option={revStack} height={300} ariaLabel="Omzet per AFDELING per maand" />}
        </Card>
        <Card
          title="AFDELING-dimensie: getagde omzet vs kosten"
          period={perYtd}
          hint={`Bewust GEEN marges als balklabel — bij eenzijdige tagging of kostenplaatsen is een marge betekenisloos.${hiddenUnits > 0 ? ` ${hiddenUnits} mini-fragmenten (< €100k) verborgen.` : ""}`}
          onSource={() => setKpiSrc(src(
            "Getagde omzet vs kosten per AFDELING", `${taggedUnits.length} afdelingen met ≥ €100k volume`, perYtd,
            "Per AFDELING de getagde omzet naast de getagde kosten. We tonen hier bewust GEEN marge-percentage als label: bij een afdeling waar alleen de kosten getagd zijn (of alleen de omzet) levert een marge absurde getallen op — eerder stond hier −11.776%, en dat was een tagging-artefact, geen bedrijfsresultaat.",
            `Grootboekposten_Excel met een gevulde AFDELING-dimensie: klassen 70–74 als omzet, klassen 60–64 als kosten. Afdelingen met minder dan €100.000 totaal volume worden weggelaten als tagging-ruis${hiddenUnits > 0 ? ` (${hiddenUnits} stuks nu verborgen)` : ""}. ${u.sources.find((s) => s.label.startsWith("AFDELING"))?.detail ?? ""}`,
            undefined, undefined,
            "Een marge is enkel betekenisvol wanneer omzet én kosten substantieel getagd zijn (wij hanteren: de kleinste van de twee is minstens 20% van de grootste). Kostenplaatsen zonder omzet horen per definitie geen marge te hebben.",
          ))}
        >
          {revCostBars && <EChart option={revCostBars} height={Math.max(260, taggedUnits.length * 32 + 70)} ariaLabel="Getagde omzet en kosten per AFDELING" />}
        </Card>
      </div>

      <Card
        title="Geconsolideerde P&L — echte IC-eliminatie"
        period={perYtd}
        hint={`Alle drie de kolommen gaan over ${perYtd}. Bruto − intercompany (per grootboekregel herkend op tegenpartij) = geconsolideerd. Tegenpartij-dekking: ${u.consolidated.coveragePct}% van het P&L-volume.`}
        onSource={() => setKpiSrc(src(
          "Geconsolideerde P&L na IC-eliminatie", formatCurrency(u.consolidated.totals.revenueNet), perYtd,
          "De echte groepscijfers: we tellen niet gewoon de elf vennootschappen op (dat telt de omzet die firma's aan elkaar factureren dubbel), maar halen die intra-groepstransacties er per grootboekregel uit. Kolom 1 is de naïeve som, kolom 2 wat er intern is, kolom 3 wat de groep werkelijk aan de buitenwereld verdient.",
          `Grootboekposten_Excel per klasse: een regel geldt als intercompany wanneer de tegenpartij (klant of leverancier) een groepsvennootschap is; voor memoriaalboekingen, die geen tegenpartij hebben, kijken we aanvullend naar de omschrijving. De tegenpartij-dekking van ${u.consolidated.coveragePct}% zegt voor welk deel van het P&L-volume we die toets überhaupt kunnen doen. ${u.sources.find((s) => s.label.startsWith("IC-eliminatie"))?.detail ?? ""}`,
          [
            { naam: "Bedrijfsopbrengsten bruto", waarde: formatCurrency(u.consolidated.totals.revenueGross) },
            { naam: "− intercompany-omzet", waarde: formatCurrency(u.consolidated.totals.revenueIc) },
            { naam: "= Geconsolideerde omzet", waarde: formatCurrency(u.consolidated.totals.revenueNet) },
            { naam: "EBITDA geconsolideerd (vóór afschrijvingen, klasse 63 niet meegerekend)", waarde: formatCurrency(u.consolidated.totals.ebitdaNet) },
            { naam: "EBIT geconsolideerd (ná afschrijvingen, klasse 63 wél meegerekend)", waarde: formatCurrency(u.consolidated.totals.ebitNet) },
            { naam: "Symmetrie-check IC-omzet vs IC-kosten", waarde: `Δ ${formatCurrency(u.consolidated.icSymmetry.delta)}` },
          ],
          undefined,
          `Bij een perfecte consolidatie is de IC-omzet exact gelijk aan de IC-kosten (wat de ene firma factureert, boekt de andere als kost). De resterende Δ van ${formatCurrency(u.consolidated.icSymmetry.delta)} is dus de meetfout van deze eliminatie. ${u.consolidated.icSymmetry.note} Dit is een management-consolidatie voor besluitvorming, geen statutaire geconsolideerde jaarrekening: deelnemingen, minderheidsbelangen en herwaarderingen zitten er niet in.`,
        ))}
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
                <tr key={r.cls} onClick={() => openClassDrill(r.cls, r.label)} title="Klik: deze klasse per grootboekrekening, over alle firma's"
                    className="cursor-pointer border-b border-border/40 transition hover:bg-primary/5">
                  <td className="px-2 py-1.5 font-semibold text-primary underline decoration-dotted underline-offset-2">{r.cls} · {r.label}</td>
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
                <td className="px-2 py-2 font-bold text-foreground">EBITDA <span className="font-normal text-muted-foreground">(vóór afschrijvingen)</span></td>
                <td className="px-2 py-2 text-right font-bold tabular-nums">{formatCurrency(u.consolidated.totals.ebitdaGross)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">Δ {formatCurrency(u.consolidated.totals.ebitdaNet - u.consolidated.totals.ebitdaGross)}</td>
                <td className={`px-2 py-2 text-right font-bold tabular-nums ${u.consolidated.totals.ebitdaNet >= 0 ? "text-positive" : "text-negative"}`}>{formatCurrency(u.consolidated.totals.ebitdaNet)}</td>
              </tr>
              <tr>
                <td className="px-2 py-2 font-bold text-foreground">EBIT <span className="font-normal text-muted-foreground">(ná afschrijvingen)</span></td>
                <td className="px-2 py-2 text-right font-bold tabular-nums">{formatCurrency(u.consolidated.totals.ebitGross)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">Δ {formatCurrency(u.consolidated.totals.ebitNet - u.consolidated.totals.ebitGross)}</td>
                <td className={`px-2 py-2 text-right font-bold tabular-nums ${u.consolidated.totals.ebitNet >= 0 ? "text-positive" : "text-negative"}`}>{formatCurrency(u.consolidated.totals.ebitNet)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 rounded-lg bg-muted/60 p-2.5 text-[11px] leading-snug text-muted-foreground">
          <b className="text-foreground">Symmetrie-check:</b> IC-omzet {formatCurrencyCompact(u.consolidated.icSymmetry.icRevenue)} vs IC-kosten {formatCurrencyCompact(u.consolidated.icSymmetry.icCosts)} → Δ <b className={Math.abs(u.consolidated.icSymmetry.delta) > 500_000 ? "text-warning" : "text-foreground"}>{formatCurrencyCompact(u.consolidated.icSymmetry.delta)}</b>. {u.consolidated.icSymmetry.note}
        </p>
      </Card>

      <Card
        title="IC-btw & omzetsplit per vennootschap per maand"
        period={perYtd}
        hint="Factuurbasis (geboekte verkoopfacturen, creditnota's verrekend). IC-btw = de btw die tussen eigen firma's rondgepompt wordt — de kern van de btw-eenheid-vraag."
        right={
          <div className="flex gap-1">
            {([["btw", "IC-btw"], ["omzet", "Omzet extern vs IC"]] as const).map(([k, lbl]) => (
              <button key={k} onClick={() => setIcTab(k)}
                className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ring-1 transition ${icTab === k ? "bg-primary text-primary-foreground ring-primary" : "bg-muted text-muted-foreground ring-border hover:text-foreground"}`}>
                {lbl}
              </button>
            ))}
          </div>
        }
        onSource={() => icbtw.data && setKpiSrc(src(
          "IC-btw & omzetsplit (factuurbasis)", formatCurrency(icbtw.data.totals.icVat), perYtd,
          "Per vennootschap per maand: de omzet gesplitst in extern en intercompany, en het btw-bedrag op diezelfde facturen. De IC-btw-kolom is geld dat de ene groepsfirma aan de andere betaalt en die het daarna terugvordert — cash die alleen rondgepompt wordt.",
          icbtw.data.sources[0]?.detail || "",
          [{ naam: "Omzet extern (periode)", waarde: formatCurrency(icbtw.data.totals.extNet) },
           { naam: "Omzet intercompany", waarde: formatCurrency(icbtw.data.totals.icNet) },
           { naam: "Btw op externe facturen", waarde: formatCurrency(icbtw.data.totals.extVat) },
           { naam: "Btw op IC-facturen (rondgepompt)", waarde: formatCurrency(icbtw.data.totals.icVat) }],
          undefined,
          icbtw.data.notes.join(" "),
        ))}
      >
        {!icbtw.data && <p className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />{icbtw.building ? "Verkoopfacturen worden opgehaald uit BC…" : "Laden…"}</p>}
        {icbtw.error && <p className="py-3 text-center text-xs text-warning">{icbtw.error}</p>}
        {icbtw.data && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-1.5 text-left">Firma</th>
                  {icTab === "omzet" && <th className="px-2 py-1.5 text-left">Soort</th>}
                  {icbtw.data.months.map((m) => <th key={m} className="px-2 py-1.5 text-right">{fmtMonth(m)}</th>)}
                  <th className="px-2 py-1.5 text-right">Totaal</th>
                </tr>
              </thead>
              <tbody>
                {icTab === "btw" ? (
                  <>
                    {icbtw.data.perCompany.filter((c) => Math.abs(c.totals.icVat) >= 1).map((c) => (
                      <tr key={c.code} className="border-b border-border/40">
                        <td className="px-2 py-1.5 font-semibold text-foreground">{c.code}</td>
                        {c.months.map((m) => <td key={m.month} className="px-2 py-1.5 text-right tabular-nums">{m.icVat ? formatCurrencyCompact(m.icVat) : "—"}</td>)}
                        <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{formatCurrency(c.totals.icVat)}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-border">
                      <td className="px-2 py-2 font-bold text-foreground">GROEP</td>
                      {icbtw.data.group.map((m) => <td key={m.month} className="px-2 py-2 text-right font-bold tabular-nums">{formatCurrencyCompact(m.icVat)}</td>)}
                      <td className="px-2 py-2 text-right font-bold tabular-nums text-primary">{formatCurrency(icbtw.data.totals.icVat)}</td>
                    </tr>
                  </>
                ) : (
                  <>
                    {icbtw.data.perCompany.filter((c) => Math.abs(c.totals.extNet) + Math.abs(c.totals.icNet) >= 1).map((c) => (
                      <>
                        <tr key={`${c.code}-e`} className="border-b border-border/20">
                          <td className="px-2 py-1.5 font-semibold text-foreground" rowSpan={2}>{c.code}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">Extern</td>
                          {c.months.map((m) => <td key={m.month} className="px-2 py-1.5 text-right tabular-nums">{m.extNet ? formatCurrencyCompact(m.extNet) : "—"}</td>)}
                          <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{formatCurrency(c.totals.extNet)}</td>
                        </tr>
                        <tr key={`${c.code}-i`} className="border-b border-border/40">
                          <td className="px-2 py-1.5 text-primary">IC</td>
                          {c.months.map((m) => <td key={m.month} className="px-2 py-1.5 text-right tabular-nums text-primary">{m.icNet ? formatCurrencyCompact(m.icNet) : "—"}</td>)}
                          <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-primary">{formatCurrency(c.totals.icNet)}</td>
                        </tr>
                      </>
                    ))}
                    <tr className="border-t-2 border-border">
                      <td className="px-2 py-2 font-bold text-foreground" colSpan={2}>GROEP extern / IC</td>
                      {icbtw.data.group.map((m) => (
                        <td key={m.month} className="px-2 py-2 text-right tabular-nums">
                          <div className="font-bold">{formatCurrencyCompact(m.extNet)}</div>
                          <div className="text-primary">{formatCurrencyCompact(m.icNet)}</div>
                        </td>
                      ))}
                      <td className="px-2 py-2 text-right tabular-nums">
                        <div className="font-bold">{formatCurrency(icbtw.data.totals.extNet)}</div>
                        <div className="text-primary">{formatCurrency(icbtw.data.totals.icNet)}</div>
                      </td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
            <p className="mt-2 rounded-lg bg-muted/60 p-2.5 text-[11px] leading-snug text-muted-foreground">
              {icTab === "btw"
                ? <>Dit is de btw die tussen eigen vennootschappen betaald en teruggevorderd wordt (±€500k in een volledige maand) — het kerncijfer voor de <b className="text-foreground">btw-eenheid-businesscase</b>. De laatste 1–2 maanden zijn onvolledig: IC-facturatie wordt met vertraging geboekt.</>
                : <>Factuurbasis, creditnota&apos;s verrekend, excl. btw. GPR-extern bevat in maart de gebouwenverkoop (€10,63M, one-off). GDI/WHS: gefactureerd ≠ GL-70x (doorfacturatie, bewust).</>}
            </p>
          </div>
        )}
      </Card>

      <Card
        title="AFDELING in cijfers (waar getagd)"
        period={perYtd}
        hint="⚠ Onvolledig beeld zolang de dimensie niet groepsbreed ingevuld wordt — de firma-tabel bovenaan is de betrouwbare laag. Alle kolommen gaan over dezelfde periode."
        onSource={() => setKpiSrc(src(
          "AFDELING in cijfers", `${taggedUnits.length} afdelingen`, perYtd,
          "Dezelfde omzet-en-kostenvergelijking als de grafiek hierboven, maar in tabelvorm met het resultaat en de marge erbij — en uitsluitend waar die marge betekenis heeft.",
          `Grootboekposten_Excel met een gevulde AFDELING-dimensie: klassen 70–74 als omzet, 60–64 als kosten. ${u.sources.find((s) => s.label.startsWith("AFDELING"))?.detail ?? ""}`,
          [{ naam: "Afdelingen met ≥ €100k volume", waarde: `${taggedUnits.length}` },
           { naam: "Verborgen als tagging-ruis (< €100k)", waarde: `${hiddenUnits}` },
           { naam: "Aandeel P&L-volume zonder AFDELING-tag", waarde: `${u.undimensioned.sharePct}%` }],
          undefined,
          `Een rij met "n.b." bij resultaat en marge is bewust leeg: daar zijn omzet en kosten niet allebei substantieel getagd (of het is een pure kostenplaats), en dan zou een marge een tagging-artefact zijn in plaats van een bedrijfscijfer. Wij vullen dat liever niet in dan een verkeerd getal te tonen.`,
        ))}
      >
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
              {taggedUnits.map((x) => {
                const reliable = marginReliable(x);
                return (
                  <tr key={x.code} className="border-b border-border/40">
                    <td className="px-2 py-1.5 font-semibold text-foreground">{x.label} <span className="ml-1 font-mono text-[9px] text-muted-foreground">{x.code}</span></td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(x.revenue)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(x.costs)}</td>
                    <td className={`px-2 py-1.5 text-right font-semibold tabular-nums ${!reliable ? "text-muted-foreground" : x.result >= 0 ? "text-positive" : "text-negative"}`}>{reliable ? formatCurrency(x.result) : "—"}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${!reliable ? "text-muted-foreground" : x.marginPct >= 0 ? "text-foreground" : "text-negative"}`} title={reliable ? undefined : "Niet bepaalbaar: omzet en kosten zijn niet allebei substantieel getagd (of dit is een kostenplaats) — resultaat/marge zouden tagging-artefacten zijn"}>
                      {reliable ? `${x.marginPct}%` : "n.b."}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {hiddenUnits > 0 && <p className="mt-2 text-[10px] text-muted-foreground">{hiddenUnits} dimensiewaarden met minder dan €100k getagd volume verborgen (tagging-ruis).</p>}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card
          title="Facturatie & betaalgedrag per unit"
          period={`gefactureerd: rollend 12 maanden · open: stand ${vandaag}`}
          hint={`Twee periodes in één tabel: de kolom 'gefact.' loopt over de laatste twaalf maanden, 'open nu' is een momentopname van ${vandaag}. Uit de klantposten (dimensie op de factuur), incl. btw, excl. IC.`}
          onSource={() => setKpiSrc(src(
            "Facturatie en betaalgedrag per AFDELING",
            `${buRows.length} units`,
            `gefactureerd en dagen tot betaling: rollend 12 maanden · openstaand: momentopname ${vandaag}`,
            "Anders dan de rest van deze pagina komt dit niet uit het grootboek maar uit de verkoopfacturen zelf: per AFDELING het gefactureerde volume, wat er vandaag nog van open staat en hoe lang klanten van die unit erover doen om te betalen. Bedragen incl. btw, want dit is het te-innen-perspectief.",
            "Cust_LedgerEntries gekoppeld aan DimensionSetEntries om de AFDELING per Dimension_Set_ID op te zoeken. De rij '(geen)' zijn facturen zonder AFDELING-dimensie.",
            undefined, undefined,
            "Verkoopfacturen dragen in BC vrijwel geen AFDELING-dimensie, dus deze tabel is nu grotendeels leeg of valt volledig onder '(geen)'. Dat is een inrichtingskwestie, niet een datafout: zodra de dimensie op de verkoopboeking overerft, vult deze tabel zich vanzelf. De omzet per unit uit het grootboek hierboven is wél volledig.",
          ))}
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
                  <th className="px-2 py-1.5 text-right" title="Rollend 12 maanden, incl. btw">Gefact.<br /><span className="font-normal normal-case">12 mnd</span></th>
                  <th className="px-2 py-1.5 text-right" title={`Momentopname ${vandaag}`}>Open<br /><span className="font-normal normal-case">{vandaag}</span></th>
                  <th className="px-2 py-1.5 text-right" title="Bedrag-gewogen gemiddelde over de facturen die in de laatste 12 maanden betaald zijn">Dgn tot betaling<br /><span className="font-normal normal-case">12 mnd</span></th>
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
          period={`boekwaarde: stand ${vandaag} · CAPEX/afschrijving: ${perYtd}`}
          hint={assets.data ? `${assets.data.totals.assetCount} activa. Boekwaarde is een momentopname van ${vandaag}; CAPEX en afschrijving lopen over ${perYtd} (afschrijving YTD ${formatCurrency(assets.data.totals.depreciationYtd)}).` : "Vaste activa laden…"}
          onSource={() => assets.data && setKpiSrc(src(
            "Vaste activa per klasse", formatCurrency(assets.data.totals.bookValue),
            `boekwaarde: momentopname ${vandaag} · CAPEX en afschrijving: ${perYtd}`,
            "Het vaste-activaregister per klasse en subklasse: hoeveel activa er zijn, wat ze nog waard zijn in de boeken, wat er dit jaar bijgekomen is en wat er dit jaar op afgeschreven is. Let op dat de boekwaarde-kolom een stand is en de twee laatste kolommen periodecijfers.",
            `FALedgerEntries (vaste-activaposten) + fixedAssets van alle vennootschappen. Boekwaarde = aanschafwaarde min de geboekte afschrijvingen. ${assets.data.sources?.[0]?.detail ?? ""}`,
            [{ naam: "Aantal activa", waarde: `${assets.data.totals.assetCount}` },
             { naam: `Boekwaarde op ${vandaag}`, waarde: formatCurrency(assets.data.totals.bookValue) },
             { naam: `Netto-CAPEX over ${perYtd}`, waarde: formatCurrency(assets.data.totals.acquisitionYtd) },
             { naam: `Afschrijving over ${perYtd}`, waarde: formatCurrency(assets.data.totals.depreciationYtd) }],
            undefined,
            "Afschrijvingen worden bij Gheeraert grotendeels op 31/12 geboekt. In de loop van het jaar is de afschrijving YTD dus veel lager dan pro rata, en de boekwaarde overeenkomstig te hoog. Vergelijk dit cijfer daarom nooit rechtstreeks met een volledig vorig boekjaar.",
          ))}
        >
          {assets.building && !assets.data && <p className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />FA-boekingen laden…</p>}
          {assets.error && <p className="py-4 text-center text-xs text-warning">{assets.error}</p>}
          {assets.data && (
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-1.5 text-left">Klasse · subklasse</th>
                  <th className="px-2 py-1.5 text-right">#</th>
                  <th className="px-2 py-1.5 text-right" title={`Momentopname ${vandaag}`}>Boekwaarde<br /><span className="font-normal normal-case">{vandaag}</span></th>
                  <th className="px-2 py-1.5 text-right" title={`Periode ${perYtd}`}>CAPEX<br /><span className="font-normal normal-case">{perYtd}</span></th>
                  <th className="px-2 py-1.5 text-right" title={`Periode ${perYtd}`}>Afschr.<br /><span className="font-normal normal-case">{perYtd}</span></th>
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

      {kpiSrc && <KpiSourceModal src={kpiSrc} onClose={() => setKpiSrc(null)} />}
      {drill && <DrillPanel key={drill.query} title={drill.title} query={drill.query} onClose={() => setDrill(null)} />}
    </div>
  );
}
