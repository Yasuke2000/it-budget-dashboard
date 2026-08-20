"use client";

// Cashflowprognose — 13-weken direct (zonder/met factoring side-by-side) +
// maandlaag tot eind volgend jaar + 6 mnd. Meeting 17/08/2026, cluster C.
// Meeting 20/08/2026: het model is BEWERKBAAR — via "Prognose-aanpassingen"
// steek je eigen waarden in de week- én maandprognose (besparingen, extra
// omzet, bankfinanciering van de historische put, aflossingen). Het gemeten
// basismodel blijft als stippellijn zichtbaar; de maandhorizon is instelbaar
// tot 48 maanden (bankgesprek KBC/BNP — 2 jaar vs 48 mnd nog te beslissen).

import { Fragment, useEffect, useMemo, useState } from "react";
import type { CfoCashForecast, FcDetailRow, FcMonth } from "@/lib/cashforecast";
import { FC_ADJ_CATEGORIEEN, pasToeOpMaanden, pasToeOpWeken, type FcAanpassing, type FcAdjCategorie, type FcAdjFrequentie } from "@/lib/cashfc-aanpassingen";
import { usePolledData, Card, Kpi, KpiSourceModal, fmtStamp, fmtMonth, weekRange } from "./cfo-ui";
import type { KpiSource } from "./cfo-ui";
import { EChart } from "./echart";
import { useChartPalette, echartsTooltip, echartsCategoryAxis, echartsValueAxis } from "@/lib/chart-theme";
import { Loader2, RefreshCcw, ArrowLeft, AlertTriangle, Plus, Save, Trash2 } from "lucide-react";

const eur = (v: number) => `€ ${Math.round(v).toLocaleString("nl-BE")}`;
// "−€ 1.225k" las als −€1,2 (melding David 18/08) — vanaf ±1M in M-notatie.
const eurS = (v: number) => {
  const a = Math.abs(v), sign = v < 0 ? "−" : "";
  if (a >= 950_000) return `${sign}€ ${(a / 1e6).toLocaleString("nl-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}M`;
  return `${sign}€ ${Math.round(a / 1000).toLocaleString("nl-BE")}k`;
};
const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `adj-${Math.random().toString(36).slice(2, 12)}`);

// Doorklik per week: de grootste posten (top 15 in/uit) achter het weekcijfer,
// elk met BC-link — zelfde conventie als de drill op Business Units en de P&L.
function WeekDrill({ week, weekStart, detail, verbergMode }: { week: number; weekStart: string; detail: CfoCashForecast["weekDetail"]; verbergMode?: "alles" | "oud" | "alle" }) {
  // Driestand (20/08): "oud" verbergt alleen achterstal >60 dagen; "alle"
  // verbergt elke achterstallige (gespreide) post; "alles" toont alles.
  const weg = (r: FcDetailRow) => (verbergMode === "oud" ? Boolean(r.oud ?? r.spread) : verbergMode === "alle" ? r.spread : false);
  const inRows = detail.in.filter((r) => r.week === week && !weg(r));
  const outRows = detail.out.filter((r) => r.week === week && !weg(r));
  const spreadNote = week < 6 && (inRows.some((r) => r.spread) || outRows.some((r) => r.spread));
  const list = (rows: FcDetailRow[], sign: 1 | -1, title: string) => (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {rows.length === 0 && <p className="text-[11px] text-muted-foreground">geen posten in deze week</p>}
      {rows.map((r, i) => (
        <div key={`${r.co}-${r.doc}-${i}`} className="flex items-baseline justify-between gap-2 border-b border-border/40 py-0.5 text-[11px]">
          <span className="min-w-0 truncate">
            <span className="font-medium text-foreground">{r.party || "(zonder naam)"}</span>
            <span className="text-muted-foreground"> · {r.co}</span>
            {r.doc && (
              <a href={r.bcUrl} target="_blank" rel="noreferrer" className="ml-1 text-primary underline decoration-dotted underline-offset-2" title="Open deze post in Business Central">
                {r.doc}↗
              </a>
            )}
            {r.factored && <span className="ml-1 rounded bg-muted px-1 text-[9px] font-semibold text-muted-foreground ring-1 ring-border" title="Factoring-klant: 85% al voorgeschoten, alleen het 15%-saldo telt in de met-factoring-reeks">factor</span>}
            {r.spread && <span className="ml-1 rounded bg-warning/15 px-1 text-[9px] font-semibold text-warning" title="Achterstallig: telt voor 1/6 per week mee in week 1–6">gespreid wk 1–6</span>}
          </span>
          <span className={`shrink-0 tabular-nums ${sign * r.amount < 0 ? "text-negative" : "text-foreground"}`}>{eurS(sign * r.amount)}</span>
        </div>
      ))}
    </div>
  );
  return (
    <tr>
      <td colSpan={9} className="bg-muted/30 p-3">
        <div className="grid gap-4 md:grid-cols-2">
          {list(inRows, 1, `In — grootste posten week van ${weekStart.slice(8, 10)}/${weekStart.slice(5, 7)} (top 15, volledig openstaand bedrag)`)}
          {list(outRows, -1, "Uit — grootste leveranciersposten (top 15)")}
        </div>
        <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
          {verbergMode === "oud" ? "Oude achterstal (>60 dagen) is hier verborgen — die telt in deze weergave niet mee en staat als aparte pot boven de grafiek; recentere achterstal blijft gewoon meetellen. " : verbergMode === "alle" ? "Alle achterstallige (gespreide) posten zijn hier verborgen — die staan als aparte pot boven de grafiek. " : ""}
          Bedragen = het volledige open bedrag van de post; {spreadNote ? "posten met 'gespreid wk 1–6' tellen voor 1/6 per week mee in het weekcijfer erboven. " : ""}
          Kalenderposten (lonen/btw/leasing), de run-rate-ramingen (nieuwe facturatie/inkopen) en prognose-aanpassingen (scenario) staan niet in deze lijst — dat zijn ritmes of aannames, geen individuele posten. Doorklikken opent de post in Business Central (BC-login vereist).
        </p>
      </td>
    </tr>
  );
}

const inpCls = "rounded-md border border-border bg-background px-1.5 py-1 text-[11px] text-foreground";

export function CashForecastView() {
  const fc = usePolledData<CfoCashForecast>("/api/cfo/cashforecast");
  const pal = useChartPalette();
  const [kpiSrc, setKpiSrc] = useState<KpiSource | null>(null);
  // Default = kasrealiteit (met factoring): dát is het echte saldo-pad. "Zonder"
  // is een betaalgedrag-beeld, geen saldo-pad — het telt de al ontvangen
  // factorvoorschotten op bestaande facturen nog een keer (inzicht 18/08).
  const [scenario, setScenario] = useState<"beide" | "zonder" | "met">("met");
  const [openWeek, setOpenWeek] = useState<number | null>(null);
  // Aparte tabs (vraag David 18/08): 13-wekenbeeld en de maandvooruitblik niet
  // onder elkaar stapelen maar als eigen tabblad.
  const [tab, setTab] = useState<"weken" | "maanden">("weken");
  // Weergave zonder de "lasten van het verleden" (vraag David 19/08): de inhaal
  // op oude posten (achterstallige AR/AP + niet-toegewezen-saldering) uit het
  // profiel, zodat het zuivere day-to-day-ritme zichtbaar wordt. De achterstal
  // verdwijnt niet — hij staat dan als aparte pot boven de grafiek.
  // Driestand (vraag David 20/08 avond): alles meegerekend / oude achterstal
  // (>60d) apart / alle achterstal apart — zodat Laura zelf kan schuiven welk
  // beeld naar de bank gaat.
  const [achterstalMode, setAchterstalMode] = useState<"alles" | "oud" | "alle">("alles");
  const zonderVerleden = achterstalMode !== "alles";
  // Maandhorizon (meeting 20/08: prognoseperiode 2 jaar vs 48 mnd nog te
  // beslissen — beide beschikbaar). 0 = de standaard server-horizon (~22 mnd);
  // langere horizonten verlengen het seizoensritme client-side.
  const [horizon, setHorizon] = useState<number>(0);
  // Maand-drill (vraag David 20/08: "ze willen kunnen kijken wat erin zit"):
  // klik een maand open voor de opbouw — referentiemaanden, trendfactor, aanpassingen.
  const [openMaand, setOpenMaand] = useState<string | null>(null);
  // Open component-rij in de rekensom-brug (klik op de balk, vraag 20/08 avond).
  const [openBrug, setOpenBrug] = useState<string | null>(null);
  const d = fc.data;
  const vandaag = new Date().toISOString().slice(0, 10);

  // ---- Prognose-aanpassingen (meeting 20/08: het model bewerkbaar maken) ----
  // Bewaard via /api/cfo/cashforecast/aanpassingen (Postgres + file-fallback,
  // gedeeld voor iedereen met CFO-toegang); toegepast BOVENOP de gecachete
  // basisprognose zodat een wijziging meteen zichtbaar is zonder BC-herbouw.
  const [adjs, setAdjs] = useState<FcAanpassing[] | null>(null);
  const [adjDirty, setAdjDirty] = useState(false);
  const [adjSaving, setAdjSaving] = useState(false);
  const [adjMsg, setAdjMsg] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    fetch("/api/cfo/cashforecast/aanpassingen")
      .then((r) => (r.ok ? r.json() : { aanpassingen: [] }))
      .then((j) => { if (!stop) setAdjs(Array.isArray(j.aanpassingen) ? j.aanpassingen : []); })
      .catch(() => { if (!stop) setAdjs([]); });
    return () => { stop = true; };
  }, []);
  const updAdj = (id: string, patch: Partial<FcAanpassing>) => { setAdjs((cur) => (cur ?? []).map((a) => (a.id === id ? { ...a, ...patch } : a))); setAdjDirty(true); setAdjMsg(null); };
  const delAdj = (id: string) => { setAdjs((cur) => (cur ?? []).filter((a) => a.id !== id)); setAdjDirty(true); setAdjMsg(null); };
  const addAdj = (base?: Partial<FcAanpassing>) => {
    const a: FcAanpassing = { id: newId(), actief: true, label: "Nieuwe aanpassing", categorie: "overig", richting: "in", bedrag: 0, frequentie: "eenmalig", start: vandaag, ...base };
    setAdjs((cur) => [...(cur ?? []), a]); setAdjDirty(true); setAdjMsg(null);
  };
  const saveAdjs = async () => {
    if (!adjs) return;
    setAdjSaving(true); setAdjMsg(null);
    try {
      const res = await fetch("/api/cfo/cashforecast/aanpassingen", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aanpassingen: adjs }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setAdjs(j.aanpassingen ?? adjs); setAdjDirty(false); setAdjMsg("Bewaard — zichtbaar voor iedereen met CFO-toegang.");
    } catch (e) {
      setAdjMsg(`Bewaren mislukt: ${String(e).replace(/^Error:\s*/, "").slice(0, 140)}`);
    }
    setAdjSaving(false);
  };
  const adjProblemen = useMemo(() => (adjs ?? []).filter((a) => !a.label.trim()), [adjs]);
  // Alleen rijen met een ingevuld bedrag tellen in het scenario (bedrag 0 =
  // klaargezette rij, bewust inert — zo kan een concept bewaard worden).
  const actieveAdjs = useMemo(() => (adjs ?? []).filter((a) => a.actief && a.bedrag > 0), [adjs]);
  const hasAdj = actieveAdjs.length > 0;
  const weekAdj = useMemo(
    () => (d ? pasToeOpWeken(actieveAdjs, d.weeks.map((w) => w.weekStart), vandaag) : null),
    [d, actieveAdjs, vandaag]
  );

  // Herrekende weekreeks: (1) de zonder-verleden-weergave haalt de achterstal-
  // lagen eruit; (2) de prognose-aanpassingen (scenario) komen er per week
  // bovenop. Basis-cumulatief (zonder aanpassingen) blijft ernaast bewaard
  // voor de stippellijn — anker afgeleid uit week 1 (zelfde techniek als 19/08).
  const weeksView = useMemo(() => {
    if (!d) return [];
    const anchorN = d.weeks[0].cumNoFactor - d.weeks[0].netNoFactor;
    const anchorF = d.weeks[0].cumWithFactor - d.weeks[0].netWithFactor;
    let cn = anchorN, cf = anchorF, cnB = anchorN, cfB = anchorF;
    return d.weeks.map((w, i) => {
      const wegIn = achterstalMode === "oud" ? (w.inOldNoFactor ?? 0) : achterstalMode === "alle" ? (w.inSpreadAllNoFactor ?? 0) : 0;
      const wegInF = achterstalMode === "oud" ? (w.inOldWithFactor ?? 0) : achterstalMode === "alle" ? (w.inSpreadAllWithFactor ?? 0) : 0;
      const wegUit = achterstalMode === "oud" ? (w.outOldAP ?? 0) : achterstalMode === "alle" ? (w.outSpreadAllAP ?? 0) : 0;
      // De niet-toegewezen-saldering hoort bij de achterstal: gaat mee weg
      // zodra een achterstal-laag apart wordt gezet (in beide modi).
      const wegUnappl = zonderVerleden ? (w.inUnapplied ?? 0) : 0;
      const inN = w.inNoFactor - wegIn - wegUnappl;
      const inF = w.inWithFactor - wegInF - wegUnappl;
      const outA = w.outAP - wegUit;
      const adjNet = weekAdj ? Math.round(weekAdj.net[i] || 0) : 0;
      const netNB = Math.round(inN + w.inNewNoFactor - outA - w.outFixed - w.outNew);
      const netFB = Math.round(inF + w.inNewWithFactor - outA - w.outFixed - w.outNew);
      cnB += netNB; cfB += netFB;
      cn += netNB + adjNet; cf += netFB + adjNet;
      return {
        ...w, inNoFactor: inN, inWithFactor: inF, outAP: outA, adjNet,
        netNoFactor: netNB + adjNet, netWithFactor: netFB + adjNet,
        cumNoFactor: cn, cumWithFactor: cf, cumNoFactorBase: cnB, cumWithFactorBase: cfB,
      };
    });
  }, [d, achterstalMode, zonderVerleden, weekAdj]);
  const lowOf = (key: "cumNoFactor" | "cumWithFactor") =>
    weeksView.reduce((a, w) => (w[key] < a.value ? { week: w.weekStart, value: w[key] } : a),
      { week: weeksView[0]?.weekStart ?? "", value: weeksView[0]?.[key] ?? 0 });
  const lowNoF = d ? lowOf("cumNoFactor") : null;
  const lowWithF = d ? lowOf("cumWithFactor") : null;

  // ---- Maandlaag: instelbare horizon + aanpassingen ----
  // Verlenging voorbij de server-horizon herhaalt het seizoensritme van
  // dezelfde kalendermaand (de projectie bevat elke maand al als seizoens-
  // gemiddelde × groeitrend; van achteren gezocht zodat de pro-rata lopende
  // maand nooit als bron dient). Verder weg = ritme, geen toezegging.
  const projMonths = useMemo(() => {
    if (!d) return [] as (FcMonth & { extended: boolean })[];
    const base = d.months.filter((m) => !m.isActual).map((m) => ({ ...m, extended: false }));
    const target = horizon === 0 ? base.length : horizon;
    const out = base.slice(0, Math.min(base.length, target));
    if (target > base.length && base.length > 0) {
      let y = Number(base[base.length - 1].month.slice(0, 4));
      let mo = Number(base[base.length - 1].month.slice(5, 7));
      for (let i = base.length; i < target; i++) {
        mo++; if (mo > 12) { mo = 1; y++; }
        const mm = String(mo).padStart(2, "0");
        const src = [...base].reverse().find((b) => b.month.slice(5) === mm) ?? base[base.length - 1];
        out.push({ month: `${y}-${mm}`, inSeason: src.inSeason, outSeason: src.outSeason, net: src.net, cum: 0, isActual: false, extended: true });
      }
    }
    return out;
  }, [d, horizon]);
  const monthAdj = useMemo(
    () => pasToeOpMaanden(actieveAdjs, projMonths.map((m) => m.month), vandaag),
    [actieveAdjs, projMonths, vandaag]
  );
  const monthsView = useMemo(() => {
    let cum = d?.bankNow ?? 0, cumB = d?.bankNow ?? 0;
    return projMonths.map((m, i) => {
      const adjNet = Math.round(monthAdj.net[i] || 0);
      cumB += m.net; cum += m.net + adjNet;
      return { ...m, adjNet, cum, cumBase: cumB };
    });
  }, [projMonths, monthAdj, d]);

  // Rekenhulp DSO/DPO: het gemiddelde dagritme uit deze prognose zelf (13 wkn).
  // 1 dag DSO ≈ 1 dag instroom aan 100% (wat-als-reeks benadert de omzet het
  // best); 1 dag DPO ≈ 1 dag leveranciersuitstroom (excl. lonen/btw/leasing).
  const dagIn = d ? d.weeks.reduce((s, w) => s + w.inNoFactor + w.inNewNoFactor, 0) / (13 * 7) : 0;
  const dagUit = d ? d.weeks.reduce((s, w) => s + w.outAP + w.outNew, 0) / (13 * 7) : 0;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <a href="/cfo" className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground ring-1 ring-border hover:text-foreground"><ArrowLeft className="h-3 w-3" />CFO-cockpit</a>
              <a href="/cfo/klanten" className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground ring-1 ring-border hover:text-foreground">Klanten & cash →</a>
              <a href="/cfo/dagbrief" className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground ring-1 ring-border hover:text-foreground">Dagelijkse cashpositie →</a>
              <h1 className="text-lg font-bold text-foreground">Cashflowprognose</h1>
              {d && !d.isLive && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold uppercase text-warning">demo</span>}
              {hasAdj && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary" title="Er zitten eigen scenario-waarden in de prognose — zie het blok 'Prognose-aanpassingen' onderaan. Het basismodel blijft als stippellijn zichtbaar.">{actieveAdjs.length} aanpassing{actieveAdjs.length > 1 ? "en" : ""} actief</span>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              13 weken vooruit op betaalgedrag per klant (week 1–4 scherp, 5–13 richtinggevend), creditnota&apos;s gesaldeerd,
              nieuwe facturatie en inkopen op het werkelijke weekritme. <b>Kasrealiteit</b> = het echte saldo-pad mét factoring.
              <b> Wat-als stoppen met factoring</b> = eerst het 433-voorschot terugbetalen, daarna 100% van elke factuur op betaalgedrag.
              Anker = de échte bankstand van vandaag. Eigen waarden (besparingen, extra omzet, financiering van de historische put)
              steek je in het model via het blok <b>Prognose-aanpassingen</b> onderaan — die tellen mee in het week- én maandbeeld.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {([["met", "Kasrealiteit"], ["zonder", "Wat als we stoppen met factoring?"], ["beide", "Vergelijk beide"]] as const).map(([k, lbl]) => (
                <button key={k} onClick={() => setScenario(k)}
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ring-1 transition ${scenario === k ? "bg-primary text-primary-foreground ring-primary" : "bg-muted text-muted-foreground ring-border hover:text-foreground"}`}>
                  {lbl}
                </button>
              ))}
              <span className="mx-1 h-3 w-px bg-border" aria-hidden />
              {([["alles", "Alles meegerekend", "Volledig beeld: inclusief de inhaal op alle achterstallige posten, gespreid over week 1–6"], ["oud", "Oude achterstal (>60d) apart", "Day-to-day-ritme: alleen achterstal ouder dan 60 dagen (cutoff 20/08) + de niet-toegewezen-saldering gaat apart; recentere achterstal blijft meetellen"], ["alle", "Alle achterstal apart", "Zuiverste ritme: elke achterstallige post (ook recent) + de niet-toegewezen-saldering staat apart — het volledige inhaaldossier naast de grafiek"]] as const).map(([k, lbl, tip]) => (
                <button key={k} onClick={() => setAchterstalMode(k)} title={tip}
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ring-1 transition ${achterstalMode === k ? "bg-warning/20 text-foreground ring-warning" : "bg-muted text-muted-foreground ring-border hover:text-foreground"}`}>
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
            <Kpi label={zonderVerleden ? "Laagste punt (ritme, zonder achterstal)" : "Laagste punt (kasrealiteit)"} value={eurS(lowWithF!.value)} tone={lowWithF!.value < 0 ? "neg" : "pos"}
              sub={`week van ${weekRange(lowWithF!.week)}${hasAdj ? " · incl. aanpassingen" : ""}`}
              onClick={() => setKpiSrc({ label: "Laagste punt — kasrealiteit", value: eur(lowWithF!.value), bron: "Cumulatief saldo per week mét factoring: bestaande posten (factoring-klanten alleen het 15%-saldo — 85% is al binnen via de 433) + nieuwe facturatie op weekritme (85% ±1 week na uitreiking) − leveranciers − lonen/btw/leasing − nieuwe inkopen." + (hasAdj ? " In deze weergave tellen óók de actieve prognose-aanpassingen (scenario-invoer, blok onderaan de pagina) mee." : ""), caveat: "Rood = financieringsbehoefte, niet lege kas: kredietlijnen/straight loans zitten er bewust niet in." })} />
            <Kpi label="Wat-als: stoppen met factoring" value={eurS(lowNoF!.value)} tone={lowNoF!.value < 0 ? "neg" : "pos"}
              sub={`week van ${weekRange(lowNoF!.week)}${zonderVerleden ? " · zonder achterstal" : ""}${hasAdj ? " · incl. aanpassingen" : ""}`}
              onClick={() => setKpiSrc({ label: "Wat-als — stoppen met factoring", value: eur(lowNoF!.value), bron: "Startsaldo = bankstand min terugbetaling van het opgenomen 433-voorschot; daarna 100% van elke factuur op betaalgedrag (bestaand + nieuw ritme). Toont wat het kost om uit factoring te stappen." + (hasAdj ? " Actieve prognose-aanpassingen tellen mee." : ""), caveat: "Terugbetaling conservatief meteen gemodelleerd; in de praktijk loopt ze uit over de inning door de factor. De echte uitstap-businesscase staat in de Cost-of-cash-analyse (§5)." })} />
            <Kpi label="Niet-toegewezen betalingen" value={eurS(d.totals.unapplied)} sub={`${d.totals.unappliedCount} open ontvangsten zonder factuurkoppeling — gesaldeerd in wk 1–6`}
              onClick={() => setKpiSrc({ label: "Niet-toegewezen betalingen", value: eur(d.totals.unapplied), bron: "BRON: Cust_LedgerEntries in Business Central, Open = ja, documenttype ≠ Factuur/Creditnota — dus betalingen, terugbetalingen en bankontvangst-documenten (blanco type) die nog niet aan een factuur zijn afgepunt. Bedrag = Remaining_Amt_LCY, extern (IC eruit). Dit geld staat al op de bank; om dubbeltelling te vermijden is het gesaldeerd in de instroom van week 1–6 (audit 18/08). Hieronder de grootste posten — klik om ze in BC te openen.",
                links: d.unappliedDetail.slice(0, 12).map((u) => ({ label: `${u.party || "(zonder naam)"} · ${u.co} · ${u.type} · ${eurS(u.amount)}`, url: u.bcUrl })), excel: "Klantenaging-export: gesaldeerd in het blok van hun datum." })} />
            <Kpi label="433-saldo (factor R/C)" value={eurS(d.totals.saldo433)} sub="de lump-sum 'zak met geld' bij de factors"
              onClick={() => setKpiSrc({ label: "Rekening 433 — factor rekening-courant", value: eur(d.totals.saldo433), bron: "trialBalances per vennootschap, alle 433-rekeningen: het saldo tussen voorgeschoten (85%) en afgerekende facturen. Negatief = opgenomen voorschot (schuld aan de factor).", caveat: "Koppeling van individuele 433-bewegingen aan facturen is fase 2 (factorportaal-rapporten)." })} />
          </div>

          <div className="flex items-center gap-1.5">
            {([["weken", "Komende 13 weken"], ["maanden", "Maandvooruitblik"]] as const).map(([k, lbl]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`rounded-t-xl px-4 py-2 text-xs font-bold transition ${tab === k ? "border border-b-0 border-border bg-card text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {lbl}
              </button>
            ))}
          </div>

          {tab === "weken" && <>
          {zonderVerleden && (() => {
            const pot = achterstalMode === "alle" ? d.verledenAlle : d.verleden;
            const potLbl = achterstalMode === "alle" ? "Alle achterstal" : "Oude achterstal (>60 dagen)";
            return (
              <div className="rounded-2xl border border-warning/40 bg-warning/10 p-3 text-[11px] leading-snug text-foreground">
                <b>{potLbl} staat APART</b> (telt hieronder niet mee, maar verdwijnt niet):
                nog te innen uit achterstallige klantposten <b>{eurS(pot?.inAR ?? 0)}</b>
                {" "}(kasrealiteit na factorvoorschot: <b>{eurS(pot?.inARFactor ?? 0)}</b>),
                nog te betalen achterstallige leveranciersposten <b>{eurS(-(pot?.uitAP ?? 0))}</b>,
                niet-toegewezen ontvangsten <b>{eurS(d.totals.unapplied)}</b>.
                Netto-effect op de kas als alles wordt ingehaald: <b>{eurS((pot?.inARFactor ?? 0) + d.totals.unapplied - (pot?.uitAP ?? 0))}</b> —
                dit is het belwerk-/betaaldossier bovenop het ritme hieronder.
              </div>
            );
          })()}
          <Card title={`${scenario === "zonder" ? "Saldo bank per week — wat-als: stoppen met factoring" : "Saldo bank per week — kasrealiteit"}${achterstalMode === "oud" ? " · zonder oude achterstal (>60d)" : achterstalMode === "alle" ? " · zonder enige achterstal" : ""}`} period={`${weekRange(d.weeks[0].weekStart)} → ${weekRange(d.weeks[12].weekStart)}`}
            hint={`Eén balk per week = verwacht banksaldo op zondag. Rood = tekort. Week 1–6 op individuele posten, week 7–13 op het bankseizoensritme. Klik een balk: de posten van die week verschijnen in de detailtabel eronder.${hasAdj ? " Grijze stippellijn = het basismodel zonder de prognose-aanpassingen." : ""}`}
            onSource={() => setKpiSrc({ label: "Saldo bank per week", value: "", bron: "Cumulatief saldo per week: echte bankstand van vandaag + verwachte ontvangsten (bestaande posten op betaalgedrag + nieuwe facturatie op 12-wekenritme) − leveranciers − lonen/btw/leasing − nieuwe inkopen. Kasrealiteit = met factoring: 85% van bestaande factoring-posten is al binnen; nieuwe facturatie geeft wél elke week verse voorschotten." + (hasAdj ? " Plus de actieve prognose-aanpassingen (scenario-invoer)." : ""), caveat: "Kredietlijnen/straight-loanopnames zitten er bewust niet in — een rode balk betekent 'financieringsbehoefte', niet 'lege kas'. Het wat-als 'stoppen met factoring' betaalt eerst het 433-voorschot terug en ontvangt daarna 100% per factuur — daarom ligt die lijn láger: factoring is structureel cash-positief." })}>
            {(() => {
              const key = scenario === "zonder" ? "cumNoFactor" as const : "cumWithFactor" as const;
              const baseKey = scenario === "zonder" ? "cumNoFactorBase" as const : "cumWithFactorBase" as const;
              const vals = weeksView.map((w) => w[key]);
              const minIdx = vals.indexOf(Math.min(...vals));
              return (
                <EChart height={300} ariaLabel="Banksaldo per week"
                  onSelect={(pt) => { if (typeof pt.dataIndex === "number") setOpenWeek(openWeek === pt.dataIndex ? null : pt.dataIndex); }}
                  option={{
                    tooltip: { ...echartsTooltip(pal), trigger: "axis", valueFormatter: (v) => (v == null ? "—" : eur(Number(v))),
                      // Hover = korte plus/min-lijst van de weekcomponenten (vraag
                      // David 20/08 avond: "een soort korte lijst met values").
                      formatter: (prs: unknown) => {
                        const arr = prs as { dataIndex: number }[];
                        const w = weeksView[arr[0]?.dataIndex ?? 0];
                        if (!w) return "";
                        const zonder = scenario === "zonder";
                        const inB = zonder ? w.inNoFactor : w.inWithFactor;
                        const inN = zonder ? w.inNewNoFactor : w.inNewWithFactor;
                        const net = zonder ? w.netNoFactor : w.netWithFactor;
                        const cum = zonder ? w.cumNoFactor : w.cumWithFactor;
                        const regels: string[] = [];
                        if (inB) regels.push(`+ bestaande facturen: <b>${eurS(inB)}</b>`);
                        if (inN) regels.push(`+ nieuwe facturatie (ritme): <b>${eurS(inN)}</b>`);
                        if (w.adjNet) regels.push(`± aanpassingen: <b>${eurS(w.adjNet)}</b>`);
                        if (w.outAP) regels.push(`− leveranciers: <b>${eurS(-w.outAP)}</b>`);
                        if (w.outFixed) regels.push(`− vast (btw/lonen/leasing): <b>${eurS(-w.outFixed)}</b>`);
                        if (w.outNew) regels.push(`− nieuwe inkopen (ritme): <b>${eurS(-w.outNew)}</b>`);
                        regels.push(`= netto deze week: <b>${eurS(net)}</b>`);
                        regels.push(`Saldo eind week: <b>${eurS(cum)}</b>`);
                        return `<b>${w.label} · ${weekRange(w.weekStart)}</b><br/>${regels.join("<br/>")}`;
                      } },
                    grid: { left: 64, right: 16, top: 28, bottom: 30 },
                    xAxis: echartsCategoryAxis(pal, { data: weeksView.map((w) => w.label) }),
                    yAxis: echartsValueAxis(pal, (v) => eurS(v)),
                    series: [{
                      name: scenario === "zonder" ? "Saldo wat-als stop factoring" : "Saldo bank (kasrealiteit)",
                      type: "bar", barMaxWidth: 40,
                      data: vals.map((v, i) => ({
                        value: v,
                        itemStyle: { color: v < 0 ? pal.negative : pal.info, borderRadius: v < 0 ? [0, 0, 4, 4] : [4, 4, 0, 0] },
                        // insideBottom bij negatief: "bottom" viel over de x-aslabels
                        // heen zodra de balk tot de chartrand reikte (David 18/08).
                        label: i === minIdx ? { show: true, position: (v < 0 ? "insideBottom" : "top") as "insideBottom" | "top", formatter: () => `laagste: ${eurS(v)}`, color: v < 0 ? "#ffffff" : pal.text, fontSize: 10, fontWeight: "bold" as const } : undefined,
                      })),
                      markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: pal.warning, width: 1.5 }, data: [{ yAxis: 0 }] },
                    },
                    ...(hasAdj ? [{
                      name: "Zonder aanpassingen (basis)", type: "line" as const, data: weeksView.map((w) => w[baseKey]),
                      lineStyle: { width: 1.5, type: "dotted" as const, color: pal.budget }, itemStyle: { color: pal.budget }, symbol: "none" as const, z: 5,
                    }] : [])],
                  }} />
              );
            })()}
          </Card>

          {(() => {
            // Brug van bankstand naar laagste punt — "de math zien" (vraag David
            // 20/08 avond): elke component opgeteld tot aan de laagste week van
            // het actieve scenario, met een leesbare verklaring in woorden.
            const key = scenario === "zonder" ? "cumNoFactor" as const : "cumWithFactor" as const;
            const netKey = scenario === "zonder" ? "netNoFactor" as const : "netWithFactor" as const;
            const lowIdx = weeksView.reduce((bi, w, i, a) => (w[key] < a[bi][key] ? i : bi), 0);
            const seg = weeksView.slice(0, lowIdx + 1);
            const som = (f: (w: (typeof weeksView)[number]) => number) => Math.round(seg.reduce((t, w) => t + f(w), 0));
            const anchor = Math.round(weeksView[0][key] - weeksView[0][netKey]);
            const inBest = som((w) => (scenario === "zonder" ? w.inNoFactor : w.inWithFactor));
            const inNieuw = som((w) => (scenario === "zonder" ? w.inNewNoFactor : w.inNewWithFactor));
            const adjTot = som((w) => w.adjNet || 0);
            const uitLev = -som((w) => w.outAP);
            const uitVast = -som((w) => w.outFixed);
            const uitNieuw = -som((w) => w.outNew);
            const eind = weeksView[lowIdx][key];
            const recenteInhaal = som((w) => (w.outSpreadAllAP ?? 0) - (w.outOldAP ?? 0));
            const rows: { id: string; lbl: string; v: number; type: "start" | "plus" | "min" | "eind" }[] = [
              { id: "bank", lbl: "Bankstand vandaag (anker)", v: anchor, type: "start" },
              { id: "inBest", lbl: "Inning bestaande facturen", v: inBest, type: "plus" },
              { id: "inNieuw", lbl: "Inning nieuwe facturatie (ritme)", v: inNieuw, type: "plus" },
              ...(adjTot !== 0 ? [{ id: "adj", lbl: "Prognose-aanpassingen (scenario)", v: adjTot, type: (adjTot > 0 ? "plus" : "min") as "plus" | "min" }] : []),
              { id: "uitLev", lbl: "Leveranciersbetalingen", v: uitLev, type: "min" },
              { id: "uitVast", lbl: "Vaste kalenderposten (btw/lonen/leasing)", v: uitVast, type: "min" },
              { id: "uitNieuw", lbl: "Nieuwe inkopen (ritme)", v: uitNieuw, type: "min" },
              { id: "eind", lbl: `Laagste punt (week van ${weekRange(weeksView[lowIdx].weekStart)})`, v: eind, type: "eind" },
            ];
            // Detail per component (klik op de balk): waar het cijfer van gemaakt is.
            const weg = (r: FcDetailRow) => (achterstalMode === "oud" ? Boolean(r.oud ?? r.spread) : achterstalMode === "alle" ? r.spread : false);
            const topIn = d.weekDetail.in.filter((r) => r.week <= lowIdx && !weg(r)).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 10);
            const topUit = d.weekDetail.out.filter((r) => r.week <= lowIdx && !weg(r)).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 10);
            const maandEindes = seg.filter((w) => w.weekStart.slice(8, 10) >= "24").length; // ±één maandeinde per ~4,3 wkn
            const postLijst = (rws: typeof topIn, sign: 1 | -1) => (
              <div className="grid gap-0.5 md:grid-cols-2">
                {rws.map((r, i) => (
                  <div key={`${r.co}-${r.doc}-${i}`} className="flex items-baseline justify-between gap-2 text-[11px]">
                    <span className="min-w-0 truncate"><b>{r.party || "(zonder naam)"}</b> <span className="text-muted-foreground">· {r.co}</span>
                      {r.doc && <a href={r.bcUrl} target="_blank" rel="noreferrer" className="ml-1 text-primary underline decoration-dotted underline-offset-2">{r.doc}↗</a>}
                      {r.spread && <span className="ml-1 rounded bg-warning/15 px-1 text-[9px] font-semibold text-warning">gespreid</span>}
                      {r.factored && <span className="ml-1 rounded bg-muted px-1 text-[9px] font-semibold text-muted-foreground ring-1 ring-border">factor</span>}
                    </span>
                    <span className="shrink-0 tabular-nums">{eurS(sign * r.amount)}</span>
                  </div>
                ))}
              </div>
            );
            const brugDetail: Record<string, React.ReactNode> = {
              bank: <p>De som van alle eigen bankrekeningen op dit moment (excl. factorkrediet) — het anker waar elke prognose op start. Het detail per rekening staat op de <a href="/cfo/dagbrief" className="text-primary underline">dagelijkse cashpositie</a>.</p>,
              inBest: <>{postLijst(topIn, 1)}<p className="mt-1 text-muted-foreground">De 10 grootste posten in dit venster (van de top-15 per week); bedragen = volledig open bedrag. Verwacht betaalmoment = betaalgedrag van dié klant.</p></>,
              inNieuw: <p>Raming, geen individuele posten: facturatie loopt door op het gemiddelde weekritme van de laatste 12 volle weken{scenario !== "zonder" ? "; bij factoring-klanten komt 85% ±1 week na uitreiking binnen, de rest op betaalgedrag" : ", geïnd op betaalgedrag"}. Dit is het ritme-deel van het model.</p>,
              adj: <div>{actieveAdjs.map((a) => <div key={a.id} className="flex justify-between gap-2"><span><b>{a.label}</b> <span className="text-muted-foreground">({a.categorie} · {a.frequentie})</span></span><span className="tabular-nums">{eurS((a.richting === "uit" ? -1 : 1) * a.bedrag)}{a.frequentie !== "eenmalig" ? ` per ${a.frequentie === "wekelijks" ? "week" : "maand"}` : ""}</span></div>)}<p className="mt-1 text-muted-foreground">Scenario-invoer uit het blok Prognose-aanpassingen — geen BC-data.</p></div>,
              uitLev: <>{postLijst(topUit, -1)}<p className="mt-1 text-muted-foreground">De 10 grootste leveranciersposten in dit venster{achterstalMode !== "alles" ? " — de apart gezette achterstal is hier al uit" : ""}. Apart-gezette posten (rode lijst Laura + akte) tellen nooit mee.</p></>,
              uitVast: <div className="space-y-0.5">
                <div className="flex justify-between"><span>Btw-afdracht (451-saldi ≤€1M per firma, één keer op de eerstvolgende 20e)</span><span className="tabular-nums">{eurS(-d.totals.btw)}</span></div>
                <div className="flex justify-between"><span>Lonen/RSZ (gemiddelde 3 volle maanden excl. provisies, op maandeinde × {maandEindes})</span><span className="tabular-nums">{eurS(-d.totals.payrollMonthly * maandEindes)}</span></div>
                <div className="flex justify-between"><span>Leasing (12m-gemiddelde externe cash-out, begin maand)</span><span className="tabular-nums">≈ {eurS(-d.totals.leasingMonthly * maandEindes)}</span></div>
                <p className="mt-1 text-muted-foreground">Kalenderregels, geen individuele facturen. Grote 451-saldi (&gt;€1M, o.a. WHS/TDR) staan bewust NIET in het profiel — timing onbekend, PRIO-vraag bij finance.</p>
              </div>,
              uitNieuw: <p>Raming: nieuwe inkoopfacturen op het 12-weken-ritme van de leveranciersfacturen (excl. leasing), betaald op ±30 dagen. Ritme, geen orderboek.</p>,
              eind: <p>Startsaldo plus alle bovenstaande componenten = het laagste cumulatieve punt van het gekozen scenario. Rood betekent financieringsbehoefte in de tijd, geen verlies.</p>,
            };
            const maxAbs = Math.max(...rows.map((r) => Math.abs(r.v)), 1);
            const modeZin = achterstalMode === "alles"
              ? `Hierin zit ook de volledige achterstal-inhaal (gespreid over week 1\u20136).`
              : achterstalMode === "oud"
                ? `De oude achterstal (>60 dagen) staat hier bewust BUITEN; de recente inhaal (\u226460d, ${eurS(recenteInhaal)} leveranciers) telt w\u00e9l mee als day-to-day.`
                : `\u00c1lle achterstal staat hier bewust buiten \u2014 dit is het zuivere ritme van nieuwe posten en kalenderkosten.`;
            return (
              <Card title="De rekensom — van bankstand naar laagste punt" period={`${weekRange(weeksView[0].weekStart)} \u2192 ${weekRange(weeksView[lowIdx].weekStart)}`}
                hint="Elke rij = een component van de prognose, opgeteld over de weken tot aan het laagste punt van het gekozen scenario. Zo zie je exact waar het saldo vandaan komt.">
                <div className="space-y-1">
                  {rows.map((r) => (
                    <div key={r.id}>
                      <div onClick={() => setOpenBrug(openBrug === r.id ? null : r.id)}
                        title="Klik: waar deze component van gemaakt is"
                        className={`flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[11px] transition hover:bg-primary/5 ${openBrug === r.id ? "bg-primary/5" : ""}`}>
                        <span className={`w-64 shrink-0 truncate underline decoration-dotted underline-offset-2 ${r.type === "start" || r.type === "eind" ? "font-bold text-foreground" : "text-muted-foreground"}`}>{r.lbl}</span>
                        <div className="relative h-4 flex-1 overflow-hidden rounded bg-muted/40">
                          <div className={`absolute inset-y-0 rounded ${r.type === "plus" ? "bg-positive/70" : r.type === "min" ? "bg-negative/70" : r.v < 0 ? "bg-negative" : "bg-info"}`}
                            style={{ width: `${Math.max(1.5, (Math.abs(r.v) / maxAbs) * 100)}%` }} />
                        </div>
                        <span className={`w-24 shrink-0 text-right font-semibold tabular-nums ${r.type === "min" || (r.type !== "plus" && r.v < 0) ? "text-negative" : "text-foreground"}`}>{eurS(r.v)}</span>
                      </div>
                      {openBrug === r.id && (
                        <div className="mb-1 ml-1 mt-0.5 rounded-lg bg-muted/30 p-2.5 text-[11px] leading-relaxed">{brugDetail[r.id]}</div>
                      )}
                    </div>
                  ))}
                </div>
                <p className="mt-3 rounded-lg bg-muted/40 p-2.5 text-[11px] leading-relaxed text-foreground/90">
                  <b>In woorden:</b> we starten vandaag op {eurS(anchor)}. Tot de week van {weekRange(weeksView[lowIdx].weekStart)} komt er {eurS(inBest)} binnen
                  uit facturen die al uitstaan en {eurS(inNieuw)} uit facturatie op het huidige weekritme{adjTot !== 0 ? <> (plus {eurS(adjTot)} uit de scenario-aanpassingen)</> : null}.
                  Daar staat {eurS(-uitLev)} aan leveranciersbetalingen tegenover, {eurS(-uitVast)} aan vaste kalenderposten
                  (waarvan de btw-afdracht {eurS(d.totals.btw)} op de eerstvolgende 20e en \u00b1{eurS(d.totals.payrollMonthly)} lonen per maandeinde)
                  en {eurS(-uitNieuw)} aan inkopen op het lopende ritme. Resultaat: {eurS(eind)}. {modeZin}
                  {eind < 0 ? " Rood is hier een financieringsbehoefte in de tijd \u2014 geen verlies: het grootste deel is timing (achterstal inhalen en btw-momenten), geen weglekkend geld." : ""}
                </p>
              </Card>
            );
          })()}

          <Card title="Detail — in/uit per week en cumulatief saldo" period={`${weekRange(d.weeks[0].weekStart)} → ${weekRange(d.weeks[12].weekStart)}`}
            hint={`Balken = verwachte in- en uitstromen per week. Lijnen = cumulatief banksaldo per scenario; onder nul = liquiditeitstekort.${hasAdj ? " Paarse balken = jouw prognose-aanpassingen (scenario, netto per week)." : ""}`}
            onSource={() => setKpiSrc({ label: "13-weken prognose", value: "", bron: d.sources.map((s) => `${s.label}: ${s.detail}`).join("\n\n") + (hasAdj ? "\n\nPrognose-aanpassingen: eigen scenario-invoer (blok onderaan de pagina), netto per week als aparte reeks — geen BC-data." : "") })}>
            {(() => {
              // Balken volgen het gekozen scenario (side-by-side = baseline zonder);
              // max 5 balkseries + max 2 lijnen, legende onderaan, nul = markLine
              // (géén nep-reeks in de legende) — dataviz-regels 18/08. De
              // aanpassingen-reeks (alleen zichtbaar mét actieve aanpassingen) is
              // bewust ÉÉN netto-reeks in een eigen stack om binnen dat budget te
              // blijven; de basis-stippellijn vervangt dan een van de lijnen.
              const withF = scenario !== "zonder"; // audit 18/08: in "Vergelijk beide" tonen de balken de KASREALITEIT (de lijnen vergelijken al)
              const inExist = weeksView.map((w) => (withF ? w.inWithFactor : w.inNoFactor));
              const inNew = weeksView.map((w) => (withF ? w.inNewWithFactor : w.inNewNoFactor));
              // categorical[3] (magenta): blauw↔magenta gevalideerd (CVD ΔE 16,6 /
              // normaal 26,6 licht; 11,6/25,7 donker) — paars↔blauw faalde (ΔE 12).
              // De rood/groen-balken krijgen positie (boven/onder nul) + 1px-randen
              // als tweede encoding.
              const metColor = pal.categorical[3];
              const adjColor = pal.categorical[4]; // paars — alleen als balk, nooit als lijn naast blauw
              const negInfo = (key: "cumNoFactor" | "cumWithFactor") => {
                const first = weeksView.find((w) => w[key] < 0);
                if (!first) return null;
                const rec = weeksView.find((w) => w.weekStart > first.weekStart && w[key] >= 0);
                return { first: first.weekStart, rec: rec?.weekStart || null };
              };
              const nZ = negInfo("cumNoFactor"), nM = negInfo("cumWithFactor");
              const msg = (label: string, n: { first: string; rec: string | null } | null) =>
                n ? `${label}: onder nul vanaf de week van ${weekRange(n.first)}${n.rec ? `, terug positief in de week van ${weekRange(n.rec)}` : " tot het einde van de horizon"}` : null;
              return (
                <>
                  <EChart height={360} ariaLabel="13-weken cashflowprognose"
                    onSelect={(pt) => { if (typeof pt.dataIndex === "number") setOpenWeek(openWeek === pt.dataIndex ? null : pt.dataIndex); }}
                    option={{
                      tooltip: { ...echartsTooltip(pal), trigger: "axis", valueFormatter: (v) => (v == null ? "—" : eur(Number(v))),
                        formatter: (prs: unknown) => { const arr = prs as { seriesName: string; value: unknown; dataIndex: number; marker: string }[]; const w = weeksView[arr[0]?.dataIndex ?? 0]; return `<b>${w ? `${w.label} · ${weekRange(w.weekStart)}` : ""}</b><br/>${arr.filter((x) => x.value != null).map((x) => `${x.marker}${x.seriesName}: <b>${eur(Number(x.value))}</b>`).join("<br/>")}`; } },
                      legend: { type: "scroll", textStyle: { color: pal.text, fontSize: 10 }, bottom: 0, itemGap: 12, icon: "roundRect", itemWidth: 10, itemHeight: 10 },
                      grid: { left: 64, right: 16, top: 16, bottom: 58 },
                      xAxis: echartsCategoryAxis(pal, { data: weeksView.map((w) => w.label) }),
                      yAxis: echartsValueAxis(pal, (v) => eurS(v)),
                      series: [
                        { name: "In bestaand", type: "bar", stack: "in", data: inExist, itemStyle: { color: pal.income, borderColor: pal.surface, borderWidth: 1 } },
                        { name: "In nieuw (raming)", type: "bar", stack: "in", data: inNew, itemStyle: { color: pal.income, opacity: 0.45, borderColor: pal.surface, borderWidth: 1 } },
                        { name: "Uit leveranciers", type: "bar", stack: "uit", data: weeksView.map((w) => -w.outAP), itemStyle: { color: pal.expense, borderColor: pal.surface, borderWidth: 1 } },
                        { name: "Uit vast", type: "bar", stack: "uit", data: weeksView.map((w) => -w.outFixed), itemStyle: { color: pal.warning, borderColor: pal.surface, borderWidth: 1 } },
                        { name: "Uit nieuw (raming)", type: "bar", stack: "uit", data: weeksView.map((w) => -w.outNew), itemStyle: { color: pal.expense, opacity: 0.45, borderColor: pal.surface, borderWidth: 1 } },
                        ...(hasAdj ? [{
                          name: "Aanpassingen (scenario)", type: "bar" as const, stack: "adj",
                          data: weeksView.map((w) => (w.adjNet ? w.adjNet : null)),
                          itemStyle: { color: adjColor, borderColor: pal.surface, borderWidth: 1 },
                        }] : []),
                        ...(scenario !== "met" ? [{
                          name: "Saldo wat-als stop factoring", type: "line" as const, data: weeksView.map((w) => w.cumNoFactor),
                          lineStyle: { width: 2.5, color: pal.info }, itemStyle: { color: pal.info }, symbol: "circle" as const, symbolSize: 6, z: 5,
                          markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: pal.negative, type: "dotted" as const, width: 1 }, data: [{ yAxis: 0 }] },
                        }] : []),
                        ...(scenario !== "zonder" ? [{
                          name: "Saldo kasrealiteit", type: "line" as const, data: weeksView.map((w) => w.cumWithFactor),
                          lineStyle: { width: 2.5, color: metColor, type: "dashed" as const }, itemStyle: { color: metColor }, symbol: "circle" as const, symbolSize: 6, z: 5,
                          ...(scenario === "met" ? { markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: pal.negative, type: "dotted" as const, width: 1 }, data: [{ yAxis: 0 }] } } : {}),
                        }] : []),
                        ...(hasAdj && scenario !== "beide" ? [{
                          name: "Zonder aanpassingen (basis)", type: "line" as const,
                          data: weeksView.map((w) => (scenario === "zonder" ? w.cumNoFactorBase : w.cumWithFactorBase)),
                          lineStyle: { width: 1.5, type: "dotted" as const, color: pal.budget }, itemStyle: { color: pal.budget }, symbol: "none" as const, z: 4,
                        }] : []),
                      ],
                    }} />
                  {(nZ || nM) && (
                    <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-negative">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{[msg("Kasrealiteit", nM), msg("Wat-als stop factoring", nZ)].filter(Boolean).join(" · ")}. Diepste punt: {eurS(Math.min(lowNoF!.value, lowWithF!.value))}{hasAdj ? " (incl. aanpassingen)" : ""}.</span>
                    </p>
                  )}
                </>
              );
            })()}
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[1060px] text-[11px]">
                <thead>
                  <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-1.5 pr-2">Week</th>
                    <th className="py-1.5 pr-2 text-right" title="wat-als stop factoring: bestaande posten + nieuwe facturatie, 100% op betaalgedrag">In wat-als</th>
                    <th className="py-1.5 pr-2 text-right" title="bestaande posten (15%-saldo) + nieuwe facturatie: 85% ~1 week na uitreiking + 15% op betaalgedrag">In kasrealiteit</th>
                    <th className="py-1.5 pr-2 text-right">Uit leveranciers</th>
                    <th className="py-1.5 pr-2 text-right">Uit vast</th>
                    <th className="py-1.5 pr-2 text-right" title="nieuwe inkopen op 12-weken-ritme, ±30d betaaltermijn (raming)">Uit nieuw</th>
                    <th className="py-1.5 pr-2 text-right" title="netto-effect van de prognose-aanpassingen (scenario-invoer, blok onderaan) in deze week">Aanpassingen</th>
                    <th className="py-1.5 pr-2 text-right">Saldo wat-als</th>
                    <th className="py-1.5 pr-2 text-right">Saldo kasrealiteit</th>
                  </tr>
                </thead>
                <tbody>
                  {weeksView.map((w, wi) => (
                    <Fragment key={w.weekStart}>
                      <tr
                        onClick={() => setOpenWeek(openWeek === wi ? null : wi)}
                        title="Klik: de grootste posten achter deze week, met BC-link"
                        className={`cursor-pointer border-b border-border/50 transition hover:bg-primary/5 ${openWeek === wi ? "bg-primary/5" : ""}`}
                      >
                        <td className="py-1 pr-2 font-medium text-foreground">{w.label} · {weekRange(w.weekStart)}{w.basis === "seizoen" && <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[9px] font-semibold text-muted-foreground ring-1 ring-border" title="Vanaf week 7 rekent het model op het bankseizoensritme van de laatste 13 maanden — geijkt op de werkelijkheid; individuele posten domineren daar niet meer.">seizoen</span>}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{eurS(w.inNoFactor + w.inNewNoFactor)}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{eurS(w.inWithFactor + w.inNewWithFactor)}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{eurS(-w.outAP)}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{eurS(-w.outFixed)}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{eurS(-w.outNew)}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{w.adjNet ? <span className="font-medium" title="scenario-invoer, geen BC-post">{eurS(w.adjNet)}</span> : "—"}</td>
                        <td className={`py-1 pr-2 text-right font-semibold tabular-nums ${w.cumNoFactor < 0 ? "text-negative" : "text-foreground"}`}>{eurS(w.cumNoFactor)}</td>
                        <td className={`py-1 pr-2 text-right font-semibold tabular-nums ${w.cumWithFactor < 0 ? "text-negative" : "text-foreground"}`}>{eurS(w.cumWithFactor)}</td>
                      </tr>
                      {openWeek === wi && <WeekDrill week={wi} weekStart={w.weekStart} detail={d.weekDetail} verbergMode={achterstalMode} />}
                    </Fragment>
                  ))}
                  <tr>
                    <td className="py-1.5 pr-2 text-muted-foreground">ná week 13 nog verwacht (bestaande posten)</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">{eurS(d.beyond13w.inNoFactor)}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">{eurS(d.beyond13w.inWithFactor)}</td>
                    <td colSpan={6} />
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          </>}

          {tab === "maanden" && (() => {
            const lowM = monthsView.length ? monthsView.reduce((a, m) => (m.cum < a.cum ? m : a), monthsView[0]) : null;
            const firstNegIdx = monthsView.findIndex((m) => m.cum < 0);
            const herstel = firstNegIdx >= 0 ? monthsView.slice(firstNegIdx).find((m) => m.cum >= 0) : null;
            return (
              <Card title="Maandvooruitblik — bewerkbare lange-termijnlaag" period={`${monthsView[0]?.month || ""} → ${monthsView[monthsView.length - 1]?.month || ""}`}
                hint={`De lange-termijnlaag: seizoensbeeld uit de échte bankmutaties × omzettrend. Eerste 6 maanden in kleur (concreet), daarna grijs (forecast); verlengde maanden (voorbij de standaardhorizon) herhalen het seizoensritme van dezelfde kalendermaand.${hasAdj ? " Grijze stippellijn = het basismodel zonder de prognose-aanpassingen." : ""}`}
                right={
                  <div className="flex items-center gap-1">
                    {([[0, "standaard"], [24, "24 mnd"], [36, "36 mnd"], [48, "48 mnd"]] as const).map(([h, lbl]) => (
                      <button key={h} onClick={() => setHorizon(h)}
                        title={h === 0 ? "Server-horizon: tot eind volgend jaar + 6 maanden" : `Horizon van ${h} maanden — bankgesprek (2 jaar vs 48 mnd nog te beslissen); voorbij de standaardhorizon wordt het seizoensritme herhaald`}
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 transition ${horizon === h ? "bg-primary text-primary-foreground ring-primary" : "bg-muted text-muted-foreground ring-border hover:text-foreground"}`}>
                        {lbl}
                      </button>
                    ))}
                  </div>
                }
                onSource={() => setKpiSrc({ label: "Maandlaag", value: "", bron: "Per kalendermaand het gemiddelde van de werkelijke bankin- en uitstromen van de afgelopen 13 maanden (BankAccountLedgerEntries, alle merken behalve Factor), geschaald met de omzettrend en doorgetrokken tot de gekozen horizon (verlenging = herhaling van hetzelfde seizoensritme). Cumulatief vanaf de bankstand van vandaag." + (hasAdj ? " Plus de actieve prognose-aanpassingen (scenario-invoer) per maand." : ""), caveat: "Puur seizoenspatroon: bevat géén prijsstijgingen, capex-planning of de CO₂-tolverhoging (1/7-effect zit deels in de historiek). Groei, besparingen en financiering steek je er zelf in via de prognose-aanpassingen — gedocumenteerd, zodat het bankverhaal controleerbaar blijft." })}>
                <div className="mb-2 rounded-lg bg-muted/40 p-2.5 text-[11px] leading-snug text-foreground/90">
                  <b>Wat zit hier wél en niet in:</b> deze laag is het <b>day-to-day-ritme</b> (bankseizoen × omzettrend). De inhaal van de historische achterstal
                  — nog te innen {eurS(d.verleden?.inAR ?? 0)} (kasrealiteit {eurS(d.verleden?.inARFactor ?? 0)}), nog te betalen {eurS(-(d.verleden?.uitAP ?? 0))}, niet-toegewezen {eurS(d.totals.unapplied)} —
                  zit alléén in het 13-wekenbeeld (week 1–6). Daarom kan het wekenbeeld dieper negatief staan dan deze laag: dat is de put, dit is het ritme.
                  <b> Klik op een maand</b> in de tabel hieronder om de opbouw te zien.
                </div>
                <EChart height={280} ariaLabel="Maandprognose banksaldo"
                  onSelect={(pt) => { const m = monthsView[pt.dataIndex ?? -1]; if (m) setOpenMaand(openMaand === m.month ? null : m.month); }}
                  option={{
                    tooltip: { ...echartsTooltip(pal), trigger: "axis", valueFormatter: (v) => (v == null ? "—" : eur(Number(v))),
                      // Zelfde plus/min-lijst als het wekenbeeld (vraag David 20/08
                      // avond: "de maand moet net zo detailed en insightful zijn").
                      formatter: (prs: unknown) => {
                        const arr = prs as { dataIndex: number }[];
                        const m = monthsView[arr[0]?.dataIndex ?? -1];
                        if (!m) return "";
                        const regels: string[] = [];
                        regels.push(`+ instroom (bankseizoen × trend): <b>${eurS(m.inSeason)}</b>`);
                        regels.push(`− uitstroom (bankseizoen × trend): <b>${eurS(-m.outSeason)}</b>`);
                        if (m.adjNet) regels.push(`± aanpassingen (scenario): <b>${eurS(m.adjNet)}</b>`);
                        regels.push(`= netto deze maand: <b>${eurS(m.net + m.adjNet)}</b>`);
                        regels.push(`Saldo eind maand: <b>${eurS(m.cum)}</b>`);
                        const extra: string[] = [];
                        if (arr[0]?.dataIndex === 0) extra.push("lopende maand: alleen het restant vanaf vandaag");
                        if (m.extended) extra.push("verlengd: herhaling seizoensritme");
                        return `<b>${m.month}</b>${extra.length ? ` <i>(${extra.join(" · ")})</i>` : ""}<br/>${regels.join("<br/>")}<br/><i>klik voor de bronmaanden en de opbouw</i>`;
                      } },
                    grid: { left: 64, right: 16, top: 20, bottom: 30 },
                    xAxis: echartsCategoryAxis(pal, { data: monthsView.map((m) => m.month) }),
                    yAxis: echartsValueAxis(pal, (v) => eurS(v)),
                    series: [{
                      name: "Verwacht banksaldo (seizoensbeeld)",
                      type: "bar", barMaxWidth: 34,
                      // CFO-sessie 2 (18/08): eerste 6 maanden concreet gekleurd,
                      // daarna grijs — verder weg = ritme, geen toezegging.
                      // Verlengde maanden nog een tint stiller.
                      data: monthsView.map((m, i) => ({ value: m.cum, itemStyle: { color: i < 6 ? (m.cum < 0 ? pal.negative : pal.info) : pal.budget, opacity: i < 6 ? 1 : m.extended ? 0.55 : 0.75, borderRadius: m.cum < 0 ? [0, 0, 4, 4] : [4, 4, 0, 0] } })),
                      markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: pal.warning, width: 1.5 }, data: [{ yAxis: 0 }] },
                    },
                    ...(hasAdj ? [{
                      name: "Zonder aanpassingen (basis)", type: "line" as const, data: monthsView.map((m) => m.cumBase),
                      lineStyle: { width: 1.5, type: "dotted" as const, color: pal.text }, itemStyle: { color: pal.text }, symbol: "none" as const, z: 5,
                    }] : [])],
                  }} />
                {lowM && (
                  <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                    Laagste punt: <b className={lowM.cum < 0 ? "text-negative" : "text-foreground"}>{eurS(lowM.cum)}</b> in {fmtMonth(lowM.month)}.
                    {firstNegIdx >= 0
                      ? (herstel
                        ? <> Saldo onder nul vanaf {fmtMonth(monthsView[firstNegIdx].month)}, terug positief in <b className="text-foreground">{fmtMonth(herstel.month)}</b>{hasAdj ? " — incl. aanpassingen" : ""}.</>
                        : <> Saldo blijft onder nul vanaf {fmtMonth(monthsView[firstNegIdx].month)} tot het einde van de horizon{hasAdj ? " — ook mét de huidige aanpassingen" : ""}.</>)
                      : <> Saldo blijft positief over de hele horizon{hasAdj ? " — incl. aanpassingen" : ""}.</>}
                  </p>
                )}
                <div className="mt-3 max-h-80 overflow-y-auto overflow-x-auto rounded-lg border border-border/50">
                  <table className="w-full min-w-[680px] text-[11px]">
                    <thead className="sticky top-0 bg-card">
                      <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                        <th className="py-1.5 pl-2 pr-2">Maand</th>
                        <th className="py-1.5 pr-2 text-right">In (seizoen)</th>
                        <th className="py-1.5 pr-2 text-right">Uit (seizoen)</th>
                        <th className="py-1.5 pr-2 text-right" title="netto-effect van de prognose-aanpassingen (scenario-invoer) in deze maand">Aanpassingen</th>
                        <th className="py-1.5 pr-2 text-right">Netto</th>
                        <th className="py-1.5 pr-2 text-right">Saldo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthsView.map((m, i) => (
                        <Fragment key={m.month}>
                        <tr onClick={() => setOpenMaand(openMaand === m.month ? null : m.month)}
                          title="Klik: waar dit maandcijfer vandaan komt"
                          className={`cursor-pointer border-b border-border/40 transition hover:bg-primary/5 ${openMaand === m.month ? "bg-primary/5" : ""}`}>
                          <td className="py-1 pl-2 pr-2 font-medium text-primary underline decoration-dotted underline-offset-2">
                            {m.month}
                            {i === 0 && <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[9px] font-semibold text-muted-foreground ring-1 ring-border" title="Lopende maand pro-rata: alleen het restant vanaf vandaag — wat al gebeurd is zit in de bankstand">rest v/d maand</span>}
                            {m.extended && <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[9px] font-semibold text-muted-foreground ring-1 ring-border" title="Voorbij de standaardhorizon: herhaling van het seizoensritme van dezelfde kalendermaand">verlengd</span>}
                          </td>
                          <td className="py-1 pr-2 text-right tabular-nums">{eurS(m.inSeason)}</td>
                          <td className="py-1 pr-2 text-right tabular-nums">{eurS(-m.outSeason)}</td>
                          <td className="py-1 pr-2 text-right tabular-nums">{m.adjNet ? <span className="font-medium" title="scenario-invoer, geen BC-data">{eurS(m.adjNet)}</span> : "—"}</td>
                          <td className="py-1 pr-2 text-right tabular-nums">{eurS(m.net + m.adjNet)}</td>
                          <td className={`py-1 pr-2 text-right font-semibold tabular-nums ${m.cum < 0 ? "text-negative" : "text-foreground"}`}>{eurS(m.cum)}</td>
                        </tr>
                        {openMaand === m.month && (() => {
                          // Opbouw van dit maandcijfer: de échte bankmaanden van
                          // dezelfde kalendermaand (de seizoensreferentie), de
                          // omzettrendfactor en de aanpassingen die hier landen.
                          const mm = m.month.slice(5, 7);
                          const refs = d.months.filter((x) => x.isActual && x.month.slice(5, 7) === mm);
                          const avgIn = refs.length ? refs.reduce((s, x) => s + x.inSeason, 0) / refs.length : 0;
                          const avgOut = refs.length ? refs.reduce((s, x) => s + x.outSeason, 0) / refs.length : 0;
                          const gf = d.groeiFactor ?? 1;
                          const adjHier = actieveAdjs
                            .map((a) => ({ a, eff: Math.round(pasToeOpMaanden([a], [m.month], vandaag).net[0] || 0) }))
                            .filter((x) => x.eff !== 0);
                          return (
                            <tr>
                              <td colSpan={6} className="bg-muted/30 p-3 text-[11px] leading-relaxed">
                                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Waar komt dit vandaan?</p>
                                {refs.length > 0 ? (
                                  <p>
                                    <b>Basis = de échte bankmutaties van dezelfde kalendermaand:</b>{" "}
                                    {refs.map((x) => `${x.month}: in ${eurS(x.inSeason)} / uit ${eurS(-x.outSeason)}`).join(" · ")}
                                    {refs.length > 1 ? ` → gemiddeld in ${eurS(avgIn)} / uit ${eurS(-avgOut)}` : ""}
                                    {gf !== 1 ? <> × omzettrend <b>{gf.toLocaleString("nl-BE")}</b> (omzet volle maanden dit jaar ÷ zelfde maanden vorig jaar, begrensd 0,8–1,25)</> : " (omzettrend 1,00 — geen schaling)"}
                                    {" "}= <b>in {eurS(m.inSeason)} / uit {eurS(-m.outSeason)}</b>.
                                  </p>
                                ) : (
                                  <p>Geen bankhistoriek voor deze kalendermaand — projectie op het beschikbare ritme.</p>
                                )}
                                {i === 0 && <p className="mt-1">Lopende maand: alleen het <b>restant vanaf vandaag</b> telt (pro-rata op resterende dagen) — wat al gebeurd is, zit in de bankstand (het anker).</p>}
                                {m.extended && <p className="mt-1">Verlengde maand (voorbij de standaardhorizon): kopie van de projectie van dezelfde kalendermaand — ritme, geen toezegging.</p>}
                                {adjHier.length > 0 && (
                                  <p className="mt-1"><b>Aanpassingen in deze maand (scenario-invoer):</b> {adjHier.map((x) => `${x.a.label} (${x.a.categorie}): ${eurS(x.eff)}`).join(" · ")}</p>
                                )}
                                <p className="mt-1 text-muted-foreground">Niet in deze laag: de inhaal van de historische achterstal en de btw-/loonkalenderposten van week 1–6 — die zitten in het 13-wekenbeeld. Bron van de bankhistoriek: BankAccountLedgerEntries, alle merken behalve Factor.</p>
                              </td>
                            </tr>
                          );
                        })()}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            );
          })()}

          <Card title="Prognose-aanpassingen — steek eigen waarden in het model" period={adjs === null ? "laden…" : `${actieveAdjs.length} actief`}
            hint="Bewerkbaar scenario bovenop het gemeten model: besparingen, extra omzet uit sales, bankfinanciering van de historische put, aflossingen (meeting 20/08). Telt mee in de 13-wekenprognose én de maandvooruitblik; het basismodel blijft als stippellijn zichtbaar. Bewaard voor iedereen met CFO-toegang."
            right={
              <button onClick={saveAdjs} disabled={!adjDirty || adjSaving || adjProblemen.length > 0 || adjs === null}
                className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-[10px] font-bold text-primary-foreground transition disabled:opacity-40">
                {adjSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                {adjDirty ? "Bewaren" : "Bewaard"}
              </button>
            }>
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Snel toevoegen:</span>
              {([
                ["Besparing /mnd", { label: "Besparing (vul aan)", categorie: "besparing", richting: "in", frequentie: "maandelijks" }],
                ["Extra omzet /mnd", { label: "Extra omzet sales (netto cash)", categorie: "omzet", richting: "in", frequentie: "maandelijks" }],
                ["Financiering put (eenmalig)", { label: "Bankfinanciering historische put", categorie: "financiering", richting: "in", frequentie: "eenmalig" }],
                ["Aflossing /mnd", { label: "Aflossing financiering", categorie: "aflossing", richting: "uit", frequentie: "maandelijks" }],
                ["DSO/DPO-effect (eenmalig)", { label: "Werkkapitaal vrij door DSO-verbetering", categorie: "werkkapitaal", richting: "in", frequentie: "eenmalig" }],
              ] as const).map(([lbl, base]) => (
                <button key={lbl} onClick={() => addAdj(base as Partial<FcAanpassing>)}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground ring-1 ring-border transition hover:text-foreground">
                  <Plus className="h-3 w-3" />{lbl}
                </button>
              ))}
              <button onClick={() => addAdj()} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground ring-1 ring-border transition hover:text-foreground">
                <Plus className="h-3 w-3" />Leeg
              </button>
            </div>
            {adjs !== null && adjs.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px] text-[11px]">
                  <thead>
                    <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                      <th className="py-1.5 pr-2" title="Uitschakelen = uit het scenario zonder te wissen">Aan</th>
                      <th className="py-1.5 pr-2">Label</th>
                      <th className="py-1.5 pr-2">Categorie</th>
                      <th className="py-1.5 pr-2">Effect</th>
                      <th className="py-1.5 pr-2 text-right">Bedrag (€/keer)</th>
                      <th className="py-1.5 pr-2">Frequentie</th>
                      <th className="py-1.5 pr-2">Start</th>
                      <th className="py-1.5 pr-2" title="Laatste dag — alleen bij herhalende aanpassingen">Einde</th>
                      <th className="py-1.5 pr-2">Onderbouwing (bankdossier)</th>
                      <th className="py-1.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {adjs.map((a) => (
                      <tr key={a.id} className={`border-b border-border/40 ${a.actief ? "" : "opacity-50"}`}>
                        <td className="py-1 pr-2"><input type="checkbox" checked={a.actief} onChange={(e) => updAdj(a.id, { actief: e.target.checked })} className="accent-[var(--primary,#0b8a5e)]" /></td>
                        <td className="py-1 pr-2"><input value={a.label} onChange={(e) => updAdj(a.id, { label: e.target.value })} placeholder="bv. Besparing wagenpark" className={`${inpCls} w-44 ${a.label.trim() ? "" : "border-warning"}`} /></td>
                        <td className="py-1 pr-2">
                          <select value={a.categorie} onChange={(e) => updAdj(a.id, { categorie: e.target.value as FcAdjCategorie })} className={inpCls}>
                            {FC_ADJ_CATEGORIEEN.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                          </select>
                        </td>
                        <td className="py-1 pr-2">
                          <select value={a.richting} onChange={(e) => updAdj(a.id, { richting: e.target.value === "uit" ? "uit" : "in" })} className={inpCls}>
                            <option value="in">kas erbij (+)</option>
                            <option value="uit">kas eraf (−)</option>
                          </select>
                        </td>
                        <td className="py-1 pr-2 text-right">
                          <input type="number" min={0} step={1000} value={a.bedrag || ""} placeholder="0"
                            onChange={(e) => updAdj(a.id, { bedrag: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                            className={`${inpCls} w-28 text-right tabular-nums`} />
                        </td>
                        <td className="py-1 pr-2">
                          <select value={a.frequentie} onChange={(e) => updAdj(a.id, { frequentie: e.target.value as FcAdjFrequentie })} className={inpCls}>
                            <option value="eenmalig">eenmalig</option>
                            <option value="wekelijks">wekelijks</option>
                            <option value="maandelijks">maandelijks</option>
                          </select>
                        </td>
                        <td className="py-1 pr-2"><input type="date" value={a.start} onChange={(e) => e.target.value && updAdj(a.id, { start: e.target.value })} className={inpCls} /></td>
                        <td className="py-1 pr-2"><input type="date" value={a.einde ?? ""} min={a.start} disabled={a.frequentie === "eenmalig"} onChange={(e) => updAdj(a.id, { einde: e.target.value || undefined })} className={`${inpCls} disabled:opacity-40`} /></td>
                        <td className="py-1 pr-2"><input value={a.opmerking ?? ""} onChange={(e) => updAdj(a.id, { opmerking: e.target.value || undefined })} placeholder="waarop is dit gebaseerd?" className={`${inpCls} w-52`} /></td>
                        <td className="py-1"><button onClick={() => delAdj(a.id)} title="Verwijderen" className="rounded p-1 text-muted-foreground transition hover:bg-negative/10 hover:text-negative"><Trash2 className="h-3.5 w-3.5" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {adjs !== null && adjs.length === 0 && (
              <p className="rounded-lg border border-dashed border-border p-3 text-[11px] text-muted-foreground">
                Nog geen aanpassingen. Gebruik de knoppen hierboven om besparingen, extra omzet, de bankfinanciering van de historische put of aflossingen in het model te steken — met bedrag, startmoment en frequentie.
              </p>
            )}
            {adjs === null && <p className="text-[11px] text-muted-foreground">Aanpassingen laden…</p>}
            {adjProblemen.length > 0 && (
              <p className="mt-2 text-[11px] font-medium text-warning">Geef elke aanpassing een label voor je bewaart ({adjProblemen.length} zonder label).</p>
            )}
            {adjMsg && <p className={`mt-2 text-[11px] font-medium ${adjMsg.startsWith("Bewaren mislukt") ? "text-negative" : "text-positive"}`}>{adjMsg}</p>}
            <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
              <b>Rekenhulp DSO/DPO:</b> 1 dag sneller innen (DSO −1) maakt eenmalig ± <b>{eurS(dagIn)}</b> vrij; 1 dag later betalen (DPO +1) houdt eenmalig ± <b>{eurS(dagUit)}</b> langer vast
              (gemeten op het gemiddelde dagritme van deze prognose: instroom aan 100% resp. leveranciersuitstroom excl. lonen/btw/leasing).
              Voeg zo&apos;n effect toe als eenmalige aanpassing (categorie Werkkapitaal) in de maand waarin de verbetering effect krijgt, en zet de onderbouwing in de opmerking — samen vormt dat het aannameregister voor het bankdossier.
              Voorvallen in het verleden tellen nooit mee (die zitten al in de echte bankstand, het anker); een eenmalige post met een datum in het verleden schuift naar vandaag.
              Rijen met bedrag 0 zijn klaargezette concepten — ze tellen niet mee tot er een bedrag in staat.
            </p>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Per vennootschap — 433, btw en niet-toegewezen" period={`stand ${fmtStamp(d.asOf)}`}
              hint="De 'zak met geld': factor-rekening-courant (433), te betalen btw (451) en ontvangsten die nog niet aan een factuur hangen."
              onSource={() => setKpiSrc({ label: "Per vennootschap", value: "", bron: "433*- en 451*-saldi per firma uit trialBalances op vandaag (debet − credit). Niet-toegewezen = alle open klantposten die geen factuur of creditnota zijn (betalingen, terugbetalingen en bankontvangst-documenten zonder koppeling); open CN apart. Deze ontvangsten zijn gesaldeerd in het weekprofiel (week 1–6)." })}>
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
            <Card title="Aannames & wat nog ontbreekt" period="v2 — 20/08/2026"
              hint="Elke aanname staat hier expliciet; fase 2 sluit de gaten met E-trans, CODA en de factorportalen.">
              <ul className="list-disc space-y-1.5 pl-4 text-[11px] leading-snug text-muted-foreground">
                {hasAdj && (
                  <li className="font-medium text-foreground">
                    Prognose-aanpassingen actief ({actieveAdjs.length}): eigen scenario-invoer via het blok &apos;Prognose-aanpassingen&apos; — géén BC-data. Het gemeten basismodel blijft in elke grafiek als stippellijn zichtbaar; voor het bankdossier hoort bij elke aanpassing een onderbouwing in de opmerking.
                  </li>
                )}
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
