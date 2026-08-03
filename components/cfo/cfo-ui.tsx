"use client";

// Gedeelde bouwstenen voor de CFO-subpagina's (Klanten & Cash, Business Units):
// poll-fetch voor de zware 202-building-endpoints + kaart/KPI-primitieven.

import { useCallback, useEffect, useState } from "react";
import { Info } from "lucide-react";

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

export function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "pos" | "neg" | "warn" | "neutral" }) {
  const toneCls = tone === "pos" ? "text-positive" : tone === "neg" ? "text-negative" : tone === "warn" ? "text-warning" : "text-foreground";
  return (
    <div className="rounded-2xl border border-border bg-card p-3.5 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${toneCls}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{sub}</p>}
    </div>
  );
}
