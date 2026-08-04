"use client";

// Gedeelde bouwstenen voor de CFO-subpagina's (Klanten & Cash, Business Units):
// poll-fetch voor de zware 202-building-endpoints + kaart/KPI-primitieven.

import { useCallback, useEffect, useState } from "react";
import { Info, X, ExternalLink } from "lucide-react";

export function eurAxis(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `€${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `€${Math.round(v / 1e3)}k`;
  return `€${Math.round(v)}`;
}
export function fmtStamp(isoStr: string): string {
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime()) || d.getTime() === 0) return "—";
  return new Intl.DateTimeFormat("nl-BE", {
    timeZone: "Europe/Brussels", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(d);
}
export function fmtMonth(m: string): string {
  const [y, mo] = m.split("-");
  return `${mo}/${y.slice(2)}`;
}
export function fmtDate(s: string): string {
  return s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "—";
}
/** Kort dag/maand-label (bv. "03/08") — voor as-labels met exacte datums i.p.v. weeknummers. */
export function fmtDM(iso: string): string { return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : ""; }
/** Volledige weekrange "ma 03/08 t/m zo 09/08/2026" voor tooltips/drills. */
export function weekRange(weekStartIso: string): string {
  if (!weekStartIso) return "";
  const start = new Date(`${weekStartIso}T00:00:00Z`);
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
  const e = end.toISOString().slice(0, 10);
  return `ma ${fmtDM(weekStartIso)} t/m zo ${e.slice(8, 10)}/${e.slice(5, 7)}/${e.slice(0, 4)}`;
}

// Poll-fetch: 202 = server bouwt nog → blijven pollen tot de data er is.
export function usePolledData<T>(url: string): { data: T | null; building: boolean; error: string | null; reload: (force?: boolean) => void } {
  const [data, setData] = useState<T | null>(null);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [force, setForce] = useState(false);

  // `force` geldt voor precies één ronde: anders zou elke volgende url-wijziging
  // opnieuw een zware herbouw forceren (auditbevinding 04/08/2026).
  const reload = useCallback((f = false) => { setForce(f); setTick((t) => t + 1); }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function run(withForce: boolean) {
      try {
        const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}${withForce ? "refresh=1" : ""}`);
        if (cancelled) return;
        if (res.status === 202) {
          setBuilding(true);
          timer = setTimeout(() => run(false), 12_000);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();
        if (cancelled) return;
        setData(d); setBuilding(false); setError(null);
        if (d.refreshing) timer = setTimeout(() => run(false), 20_000);
      } catch (e) {
        if (!cancelled) { setError(String(e).slice(0, 160)); setBuilding(false); }
      }
    }
    run(force);
    if (force) setForce(false);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [url, tick, force]);

  return { data, building, error, reload };
}

export function Card({ title, hint, source, right, children }: {
  title: string; hint?: string; source?: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {hint && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{hint}</p>}
        </div>
        <div className="flex items-center gap-2">
          {right}
          {source && (
            <span className="group relative inline-flex">
              <Info className="h-3.5 w-3.5 text-muted-foreground/60" />
              <span className="pointer-events-none absolute right-0 top-5 z-30 hidden w-72 rounded-lg border border-border bg-popover p-2.5 text-[11px] leading-snug text-popover-foreground shadow-xl group-hover:block">
                {source}
              </span>
            </span>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

export function Kpi({ label, value, sub, tone, onClick }: {
  label: string; value: string; sub?: string; tone?: "pos" | "neg" | "warn" | "neutral"; onClick?: () => void;
}) {
  const toneCls = tone === "pos" ? "text-positive" : tone === "neg" ? "text-negative" : tone === "warn" ? "text-warning" : "text-foreground";
  const body = (
    <>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${toneCls}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{sub}</p>}
    </>
  );
  if (!onClick) return <div className="rounded-2xl border border-border bg-card p-3.5 shadow-sm">{body}</div>;
  return (
    <button
      onClick={onClick}
      title="Klik voor de bron: formule met de echte bedragen, BC-tabel en waar je het in de Excel terugvindt"
      className="group relative rounded-2xl border border-border bg-card p-3.5 text-left shadow-sm transition hover:border-primary/40 hover:ring-1 hover:ring-primary/25"
    >
      {body}
      <Info className="absolute right-2.5 top-2.5 h-3 w-3 text-muted-foreground/40 transition group-hover:text-primary" />
    </button>
  );
}

// Bronpaneel achter een KPI: de formule met de échte getallen, de BC-tabel/velden en
// waar het cijfer in de Excel-export staat. "Ze wil ook de sources kunnen vinden."
export interface KpiSource {
  label: string; value: string;
  formule?: { tekst: string; delen: { naam: string; waarde: string }[] };
  bron: string;
  excel?: string;
  caveat?: string;
  links?: { label: string; url: string }[];
}
export function KpiSourceModal({ src, onClose }: { src: KpiSource; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Bron van dit cijfer</p>
            <h3 className="mt-0.5 text-base font-bold text-foreground">{src.label}</h3>
            <p className="mt-1 text-2xl font-bold tabular-nums text-primary">{src.value}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Sluiten">
            <X className="h-4 w-4" />
          </button>
        </div>

        {src.formule && (
          <div className="mt-4 rounded-xl border border-border bg-background/50 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Zo is het gerekend</p>
            <p className="mt-1 font-mono text-[11px] leading-relaxed text-foreground">{src.formule.tekst}</p>
            <table className="mt-2 w-full border-collapse text-xs">
              <tbody>
                {src.formule.delen.map((dl) => (
                  <tr key={dl.naam} className="border-t border-border/50">
                    <td className="py-1 pr-2 text-muted-foreground">{dl.naam}</td>
                    <td className="py-1 text-right font-semibold tabular-nums text-foreground">{dl.waarde}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 rounded-xl border border-border bg-background/50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Waar komt het uit Business Central</p>
          <p className="mt-1 text-[11px] leading-snug text-foreground">{src.bron}</p>
        </div>

        {src.excel && (
          <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Terugvinden in de Excel-export</p>
            <p className="mt-1 text-[11px] leading-snug text-foreground">Blad <b>{src.excel}</b> — download via de knop &quot;Excel met de brondata&quot; bovenaan de pagina; daar staan alle onderliggende regels, met doorkliklinks naar de boekingen in BC.</p>
          </div>
        )}

        {src.caveat && (
          <div className="mt-3 rounded-xl border border-warning/30 bg-warning/10 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-warning">Waar je op moet letten</p>
            <p className="mt-1 text-[11px] leading-snug text-foreground">{src.caveat}</p>
          </div>
        )}

        {src.links?.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {src.links.map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground hover:opacity-90">
                {l.label} <ExternalLink className="h-3 w-3" />
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
