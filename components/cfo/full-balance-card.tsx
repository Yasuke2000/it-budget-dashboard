"use client";

// Volledige balans op datum — lazy geladen naast de condensed cockpit-balans
// (zelfde patroon als LeasingCard: client-side fetch van /api/cfo/balance).
// Datumkiezer → "hard close"-blik: de balans zoals op bv. de dag na de btw-afsluiting.

import { useEffect, useState } from "react";
import type { CfoFullBalance, BalanceRubriek } from "@/lib/balance-full";
import { formatCurrency, formatCurrencyCompact } from "@/lib/utils";
import { Loader2, Scale, ChevronDown, Info } from "lucide-react";
import { fmtDate } from "./cfo-ui";

function RubriekRows({ rows }: { rows: BalanceRubriek[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      {rows.map((r) => (
        <div key={r.key}>
          <button
            onClick={() => setOpen(open === r.key ? null : r.key)}
            className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-xs hover:bg-accent"
            title={`${r.accountCount} rekeningen — klik voor de grootste`}
          >
            <span className="flex items-center gap-1 text-foreground">
              <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${open === r.key ? "" : "-rotate-90"}`} />
              {r.label} <span className="font-mono text-[9px] text-muted-foreground">{r.key}</span>
            </span>
            <span className="font-semibold tabular-nums text-foreground">{formatCurrencyCompact(r.amount)}</span>
          </button>
          {open === r.key && (
            <div className="mb-1 ml-5 space-y-0.5 border-l border-border pl-2">
              {r.accounts.map((a) => (
                <div key={a.number} className="flex items-center justify-between text-[11px]">
                  <span className="truncate text-muted-foreground" title={a.name}><span className="font-mono">{a.number}</span> {a.name}</span>
                  <span className="ml-2 shrink-0 tabular-nums text-foreground">{formatCurrency(a.amount)}</span>
                </div>
              ))}
              {r.accountCount > r.accounts.length && <p className="text-[10px] text-muted-foreground">… nog {r.accountCount - r.accounts.length} kleinere rekeningen</p>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function FullBalanceCard({ excluded }: { excluded: string[] }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<CfoFullBalance | null>(null);
  const [loading, setLoading] = useState(true); // gezet in event-handlers, niet in het effect zelf
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ date });
    if (excluded.length) params.set("exclude", excluded.join(","));
    fetch(`/api/cfo/balance?${params}`)
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(String(e).slice(0, 120)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [date, excluded]);

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Scale className="h-4 w-4 text-primary" /> Volledige balans op datum</h2>
            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary ring-1 ring-primary/30">
              momentopname {fmtDate(date)}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            Alle balansrekeningen (klasse 1–5) uit BC&apos;s trialBalances, PCMN-rubrieken met rekening-drill. Deze kaart volgt de datumkiezer hiernaast, NIET de periodekiezer bovenaan de pagina — kies een datum voor een &quot;hard close&quot;-blik.
          </p>
          <details className="mt-1.5">
            <summary className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-muted px-2 py-1 text-[10px] font-semibold text-muted-foreground ring-1 ring-border transition hover:bg-primary/10 hover:text-primary hover:ring-primary/40">
              <Info className="h-3 w-3" />bron &amp; uitleg
            </summary>
            <div className="mt-2 space-y-1.5">
              <p className="text-[11px] leading-snug text-foreground"><b>Periode:</b> geen periode maar een STAND op één dag — {fmtDate(date)}. Een balans is per definitie een momentopname; de periodekiezer bovenaan de pagina heeft hier geen invloed op.</p>
              <p className="text-[11px] leading-snug text-muted-foreground"><b className="text-foreground">Wat staat er:</b> links alles wat de groep op die dag bezit, rechts hoe dat gefinancierd is (eigen vermogen en schulden). De rubrieken volgen het Belgische rekeningstelsel (MAR/PCMN); klik een rubriek om de onderliggende rekeningen te zien en van daaruit door te gaan naar de boekingen in Business Central.</p>
              <p className="text-[11px] leading-snug text-muted-foreground"><b className="text-foreground">Bron in Business Central:</b> het rapport trialBalances per vennootschap, opgevraagd tot en met de gekozen datum. Let op dat BC de bedragen daar als tekst met komma-duizendscheiders teruggeeft; wij parsen die strikt en laten de opbouw falen in plaats van stil een verkeerd getal te tonen.</p>
              <p className="text-[11px] leading-snug text-muted-foreground"><b className="text-foreground">Waar je op moet letten:</b> de Δ tussen activa en passiva is niet een fout maar het nog niet verwerkte resultaat van het lopende boekjaar — dat wordt pas bij de jaarafsluiting naar het eigen vermogen geboekt.</p>
            </div>
          </details>
        </div>
        <input
          type="date" value={date} max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => { if (e.target.value) { setDate(e.target.value); setLoading(true); setError(null); } }}
          className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground"
          aria-label="Balansdatum"
        />
      </div>
      {loading && <p className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Balans per {date} wordt opgebouwd…</p>}
      {error && <p className="py-4 text-center text-xs text-warning">Balans kon niet geladen worden: {error}</p>}
      {data && !loading && (
        <>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 flex items-center justify-between text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Activa <span className="tabular-nums text-foreground">{formatCurrencyCompact(data.totalAssets)}</span></p>
              <RubriekRows rows={data.assets} />
            </div>
            <div>
              <p className="mb-1.5 flex items-center justify-between text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Passiva & eigen vermogen <span className="tabular-nums text-foreground">{formatCurrencyCompact(data.totalLiabilities)}</span></p>
              <RubriekRows rows={data.liabilities} />
            </div>
          </div>
          <p className="mt-3 text-[10px] leading-snug text-muted-foreground">
            Δ activa − passiva = <b className="tabular-nums">{formatCurrency(data.delta)}</b> ≈ het nog niet verwerkte resultaat van het lopende boekjaar. {data.notes[1]}
          </p>
        </>
      )}
    </section>
  );
}
