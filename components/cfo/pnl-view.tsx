"use client";

// Management-P&L — EMAsphere-structuur, live uit BC (cluster A ontwerpdossier).
// Maandkolommen + YtD, per firma of geconsolideerd-bruto, met zichtbare controlelijn.

import { Fragment, useState } from "react";
import type { CfoMgmtPnl } from "@/lib/mgmt-pnl";
import { formatCurrency } from "@/lib/utils";
import { usePolledData, Card, KpiSourceModal, fmtStamp } from "./cfo-ui";
import type { KpiSource } from "./cfo-ui";
import { Loader2, RefreshCcw, AlertTriangle, ArrowLeft } from "lucide-react";

const COMPANIES = ["ALL", "GTR", "GDI", "WHS", "TDR", "GRE", "GTG", "GSS", "GPR", "TFO", "LMB", "GEX"];
const MND = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

function eurK(v: number): string {
  if (v === 0) return "—";
  const k = v / 1000;
  return `${k < 0 ? "−" : ""}${Math.abs(k) >= 1000 ? (Math.abs(k) / 1000).toFixed(2).replace(".", ",") + "M" : Math.round(Math.abs(k)).toLocaleString("nl-BE") + "k"}`;
}

export function PnlView() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [company, setCompany] = useState("ALL");
  // Periode-selectie op RAPPORTERINGSMAAND (boekingsperiode) — vraag David 19/08,
  // voor de EMAsphere-check (bv. 01/01 t/m 30/06). Scope: firma's uitvinken.
  const [mFrom, setMFrom] = useState(1);
  const [mTo, setMTo] = useState<number | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]);
  const exclQs = company === "ALL" && excluded.length ? `&exclude=${excluded.join(",")}` : "";
  const pnl = usePolledData<CfoMgmtPnl>(`/api/cfo/pnl?year=${year}&company=${company}${exclQs}`);
  const [kpiSrc, setKpiSrc] = useState<KpiSource | null>(null);
  const [open, setOpen] = useState<string | null>(null); // opengeklikte bucket
  const p = pnl.data;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <a href="/cfo" className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground ring-1 ring-border hover:text-foreground"><ArrowLeft className="h-3 w-3" />CFO-cockpit</a>
              <a href="/cfo/units" className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground ring-1 ring-border hover:text-foreground">Business Units →</a>
              <a href="/cfo/cashflow" className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground ring-1 ring-border hover:text-foreground">Cashflowprognose →</a>
              <h1 className="text-lg font-bold text-foreground">Management-P&L</h1>
              {p && !p.isLive && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold uppercase text-warning">demo</span>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              De P&L in de bucket-structuur die finance kent (EMAsphere Operations P&L) — maar live uit Business Central,
              per maand, met een controlelijn die écht op nul staat. Bedragen: opbrengsten +, kosten −, excl. btw.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {[thisYear, thisYear - 1].map((y) => (
                <button key={y} onClick={() => setYear(y)}
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ring-1 transition ${year === y ? "bg-primary text-primary-foreground ring-primary" : "bg-muted text-muted-foreground ring-border hover:text-foreground"}`}>
                  {y}
                </button>
              ))}
              <span className="mx-1 text-[10px] text-muted-foreground">·</span>
              {COMPANIES.map((c) => (
                <button key={c} onClick={() => setCompany(c)}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 transition ${company === c ? "bg-primary text-primary-foreground ring-primary" : "bg-muted text-muted-foreground ring-border hover:text-foreground"}`}>
                  {c === "ALL" ? "Alle firma's" : c}
                </button>
              ))}
            </div>
            {p && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span className="font-semibold">Periode:</span>
                <select value={Math.min(mFrom, p.months.length)} onChange={(e) => setMFrom(Number(e.target.value))}
                  className="rounded-lg border border-border bg-card px-1.5 py-0.5 text-[11px] text-foreground">
                  {p.months.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
                <span>t/m</span>
                <select value={Math.min(mTo ?? p.months.length, p.months.length)} onChange={(e) => setMTo(Number(e.target.value))}
                  className="rounded-lg border border-border bg-card px-1.5 py-0.5 text-[11px] text-foreground">
                  {p.months.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
                <span className="text-[10px]">(rapporteringsmaand = boekingsperiode in BC, niet het moment van ingave)</span>
              </div>
            )}
            {company === "ALL" && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground">Telt mee:</span>
                {COMPANIES.filter((c) => c !== "ALL").map((c) => {
                  const uit = excluded.includes(c);
                  return (
                    <button key={c} onClick={() => setExcluded(uit ? excluded.filter((x) => x !== c) : [...excluded, c])}
                      title={uit ? `${c} telt NIET mee` : `${c} telt mee — klik om uit te sluiten`}
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 transition ${uit ? "bg-muted text-muted-foreground/50 line-through ring-border" : "bg-positive/10 text-positive ring-positive/30"}`}>
                      {c}
                    </button>
                  );
                })}
                <span className="text-[10px] text-muted-foreground">{11 - excluded.length}/11 geselecteerd</span>
              </div>
            )}
          </div>
          {p && (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>Data per <b className="text-foreground">{fmtStamp(p.asOf)}</b></span>
              {p.refreshing && <span className="inline-flex items-center gap-1 text-primary"><Loader2 className="h-3 w-3 animate-spin" />vernieuwt…</span>}
              <a href={`/api/cfo/export/pnl?year=${year}&company=${company}${exclQs}&from=${mFrom}&to=${mTo ?? 99}`}
                className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 font-semibold text-primary-foreground transition hover:opacity-90">Excel</a>
              <button onClick={() => pnl.reload(true)} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 font-semibold ring-1 ring-border hover:text-foreground"><RefreshCcw className="h-3 w-3" />Vernieuwen</button>
            </div>
          )}
        </div>
      </div>

      {!p && (
        <div className="mx-auto mt-16 max-w-md rounded-2xl border border-border bg-card p-8 text-center">
          {pnl.error ? (
            <>
              <AlertTriangle className="mx-auto h-7 w-7 text-warning" />
              <p className="mt-3 text-sm text-muted-foreground">{pnl.error}</p>
            </>
          ) : (
            <>
              <Loader2 className="mx-auto h-7 w-7 animate-spin text-primary" />
              <p className="mt-3 text-sm font-semibold text-foreground">{pnl.building ? "P&L wordt opgebouwd uit BC…" : "Laden…"}</p>
              {pnl.building && <p className="mt-1.5 text-xs text-muted-foreground">Eerste opbouw van dit venster: alle P&L-boekingen (2–5 min). De pagina ververst zichzelf.</p>}
            </>
          )}
        </div>
      )}

      {p && (() => {
        const mA = Math.min(mFrom, p.months.length);
        const mB = Math.max(mA, Math.min(mTo ?? p.months.length, p.months.length));
        const zicht = <T,>(arr: T[]) => arr.slice(mA - 1, mB);
        const somRij = (id: string) => zicht(p.rows.find((r) => r.id === id)?.monthly || []).reduce((a, b) => a + b, 0);
        const heleJaar = mA === 1 && mB === p.months.length;
        const totaalVan = (r: (typeof p.rows)[number]) => r.id === "brutomarge_pct"
          ? (somRij("omzet") ? Math.round((somRij("brutomarge") / somRij("omzet")) * 1000) / 10 : 0)
          : zicht(r.monthly).reduce((a, b) => a + b, 0);
        return (
        <Card
          title={`P&L ${p.year} — ${p.company === "ALL" ? `${11 - excluded.length}/11 vennootschappen (bruto, incl. IC)` : p.company}`}
          period={`${p.months[mA - 1]} t/m ${p.months[mB - 1]}${excluded.length ? ` · zonder ${excluded.join("/")}` : ""}`}
          hint={`Controlelijn: ${p.controlelijn === 0 ? "✓ €0 — alles gemapt" : `⚠ ${formatCurrency(p.controlelijn)} — zie 'Niet gemapt'`}${p.nonRecurringRev ? ` · niet-recurrent apart: ${formatCurrency(p.nonRecurringRev)}` : ""}`}
          onSource={() => setKpiSrc({
            label: `Management-P&L ${p.year} — ${p.company}`,
            value: formatCurrency(p.rows.find((r) => r.id === "res_na_bel")?.ytd || 0),
            formule: {
              tekst: "De P&L in de EMAsphere-bucketstructuur, live uit het grootboek. Elke bucket is een vaste set rekeningreeksen (mapping gereverse-engineerd uit het gevalideerde EMAsphere-grid, 17/08/2026); subtotalen zijn optelsommen van de detailrijen; EBITDA = bedrijfsresultaat vóór afschrijvingen en voorzieningen.",
              delen: [
                { naam: "Controlelijn (hoort €0)", waarde: formatCurrency(p.controlelijn) },
                { naam: "Niet-recurrent apart (GPR gebouwen)", waarde: formatCurrency(p.nonRecurringRev) },
                { naam: "Niet-gemapte rekeningen", waarde: `${p.unmapped.length}` },
              ],
            },
            bron: p.sources[0]?.detail || "",
            caveat: p.notes.join(" "),
          })}
        >
          {p.klok.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5" title="P&L-klok: doel = elke maand definitief uiterlijk 7 dagen na maandeinde. 'Wacht op lonen' = arbeidersbezoldiging nog niet geboekt.">
              {p.klok.map((k, i) => (
                <span key={k.month} className={`rounded-lg px-2 py-1 text-[10px] font-semibold ${!k.lonenGeboekt && i === p.klok.length - 1 ? "bg-muted text-muted-foreground" : k.lonenGeboekt ? "bg-positive/15 text-positive" : "bg-warning/15 text-warning"}`}>
                  {MND[i]} {k.lonenGeboekt ? "✓" : i === p.klok.length - 1 ? "· loopt" : "⚠ wacht op lonen"} <span className="font-normal opacity-70">D+7: {k.deadline.slice(8)}/{k.deadline.slice(5, 7)}</span>
                </span>
              ))}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="sticky left-0 bg-card px-2 py-1.5 text-left">Bucket</th>
                  {zicht(p.months).map((m) => <th key={m} className="px-2 py-1.5 text-right">{MND[Number(m.slice(5, 7)) - 1]} {String(p.year).slice(2)}</th>)}
                  <th className="px-2 py-1.5 text-right">{heleJaar ? "YtD" : "Periode"}</th>
                </tr>
              </thead>
              <tbody>
                {p.rows.map((r) => {
                  if ((r.id === "niet_gemapt" || r.id === "niet_recurrent") && r.ytd === 0) return null;
                  const isPct = r.id === "brutomarge_pct";
                  const det = p.detail[r.id];
                  const clickable = r.style === "normal" && det && det.length > 0;
                  const rowCls = r.style === "total" ? "border-t-2 border-border bg-muted/40 font-bold"
                    : r.style === "subtotal" ? "border-b border-border font-semibold"
                    : r.style === "memo" ? "border-b border-border/40 text-muted-foreground italic"
                    : "border-b border-border/40";
                  // Detail volgt de gekozen periode (vraag David 19/08): per rekening
                  // het maandprofiel over [mA..mB] optellen; rijen die in de periode
                  // op 0 staan verdwijnen; sortering op |periodebedrag|.
                  const perVan = (d: { monthly?: number[]; ytd: number }) =>
                    d.monthly && d.monthly.length ? d.monthly.slice(mA - 1, mB).reduce((s, x) => s + x, 0) : (heleJaar ? d.ytd : 0);
                  const detP = det
                    ? det.map((d) => ({ ...d, per: perVan(d) })).filter((d) => Math.abs(d.per) >= 0.5)
                        .sort((a, b) => Math.abs(b.per) - Math.abs(a.per))
                    : [];
                  const detSum = detP.reduce((s, d) => s + d.per, 0);
                  return (
                    <Fragment key={r.id}>
                    <tr className={`${rowCls} ${clickable ? "cursor-pointer transition hover:bg-primary/5" : ""}`}
                        onClick={clickable ? () => setOpen(open === r.id ? null : r.id) : undefined}
                        title={clickable ? "Klik: de rekeningen erachter, per vennootschap" : undefined}>
                      <td className={`sticky left-0 bg-card px-2 py-1 ${r.indent ? "pl-6" : ""} ${clickable ? "text-primary underline decoration-dotted underline-offset-2" : r.indent ? "text-muted-foreground" : "text-foreground"}`}>
                        {r.label}{clickable ? (open === r.id ? " ▾" : " ▸") : ""}
                      </td>
                      {zicht(r.monthly).map((v, i) => (
                        <td key={i} className={`px-2 py-1 text-right tabular-nums ${!isPct && v < 0 && (r.style === "total" || r.id === "brutomarge") ? "text-negative" : ""}`}>
                          {isPct ? (v ? `${v.toLocaleString("nl-BE")}%` : "—") : eurK(v)}
                        </td>
                      ))}
                      <td className={`px-2 py-1 text-right font-semibold tabular-nums ${!isPct && totaalVan(r) < 0 && r.style === "total" ? "text-negative" : ""}`}>
                        {isPct ? `${totaalVan(r).toLocaleString("nl-BE")}%` : formatCurrency(totaalVan(r))}
                      </td>
                    </tr>
                    {open === r.id && det && (
                      <tr className="border-b border-border bg-muted/20">
                        <td colSpan={mB - mA + 3} className="px-4 py-2">
                          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Dat + dat + dat — eerst per rekening, dan per vennootschap ({heleJaar ? "YtD" : `${MND[mA - 1]}–${MND[mB - 1]} ${p.year}`})</p>
                          <div className="grid gap-1 md:grid-cols-2">
                            {detP.map((d) => (
                              <div key={`${d.company}-${d.account}`} className="flex items-center justify-between gap-2 rounded bg-card px-2 py-1 text-[11px]">
                                <span className="truncate"><span className="font-mono font-semibold text-foreground">{d.account}</span> <span className="text-muted-foreground">{d.name.slice(0, 34)}</span> <span className="rounded bg-muted px-1 text-[9px] font-bold">{d.company}</span></span>
                                <span className="flex shrink-0 items-center gap-2 tabular-nums font-semibold" title={heleJaar ? undefined : `volledig jaar: ${formatCurrency(d.ytd)}`}>{formatCurrency(d.per)}
                                  <a href={d.bcUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-primary hover:underline">BC↗</a>
                                </span>
                              </div>
                            ))}
                          </div>
                          <p className="mt-1.5 text-[11px] font-semibold text-foreground">= {formatCurrency(detSum)} {Math.abs(detSum - totaalVan(r)) < 1 ? "✓ sluit op de rij" : `(rij: ${formatCurrency(totaalVan(r))} — verschil = kleinere rekeningen buiten de top-40 van het jaar)`}</p>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {p.unmapped.length > 0 && (
            <details className="mt-3 rounded-lg bg-warning/10 p-2.5 text-[11px] text-warning">
              <summary className="cursor-pointer font-semibold">⚠ {p.unmapped.length} niet-gemapte rekening(en) — dit bedrag valt buiten de buckets</summary>
              <ul className="mt-1.5 space-y-0.5">
                {p.unmapped.map((u) => <li key={`${u.company}-${u.account}`}>{u.company} · {u.account} {u.name} — {formatCurrency(u.ytd)}</li>)}
              </ul>
            </details>
          )}
          <p className="mt-2 rounded-lg bg-muted/60 p-2.5 text-[11px] leading-snug text-muted-foreground">
            {p.notes[1]} {p.notes[2]}
          </p>
        </Card>
        );
      })()}

      {kpiSrc && <KpiSourceModal src={kpiSrc} onClose={() => setKpiSrc(null)} />}
    </div>
  );
}
