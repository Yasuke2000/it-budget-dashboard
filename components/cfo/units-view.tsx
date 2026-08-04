"use client";

// Business Units & Activa — operationele P&L per AFDELING-dimensie
// (Grootboekposten_Excel) + facturatie/DSO per unit (klantposten) + vaste activa
// (FALedgerEntries). Zelfde poll-patroon en designtaal als Klanten & Cash.

import { useMemo, useState } from "react";
import * as echarts from "echarts";
import type { CfoReceivables } from "@/lib/types";
import type { CfoUnits } from "@/lib/units";
import type { CfoAssets } from "@/lib/assets";
import { EChart } from "./echart";
import { formatCurrency, formatCurrencyCompact } from "@/lib/utils";
import { useChartPalette } from "@/lib/chart-theme";
import { usePolledData, Card, Kpi, KpiSourceModal, eurAxis, fmtStamp, fmtMonth, fmtDate } from "./cfo-ui";
import type { KpiSource } from "./cfo-ui";
import { Loader2, RefreshCcw, AlertTriangle, ArrowLeft } from "lucide-react";

export function UnitsView({ exclude }: { exclude: string[] }) {
  const qs = exclude.length ? `?exclude=${exclude.join(",")}` : "";
  const units = usePolledData<CfoUnits>(`/api/cfo/units${qs}`);
  const assets = usePolledData<CfoAssets>(`/api/cfo/assets${qs}`);
  const rcv = usePolledData<CfoReceivables>(`/api/cfo/receivables${qs}`);
  const p = useChartPalette();
  const u = units.data;
  const [kpiSrc, setKpiSrc] = useState<KpiSource | null>(null);

  // Periode: elk cijfer op deze pagina draagt zichtbaar over welke periode het gaat.
  const vandaag = fmtDate(new Date().toISOString().slice(0, 10));
  const perYtd = u ? `01/01/${u.year} t/m ${vandaag}` : "year-to-date";
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
    </div>
  );
}
