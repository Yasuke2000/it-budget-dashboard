// Gedeelde helpers voor de zware ODataV4/api-pulls van de CFO-modules:
// paging zonder $top (de €776k-les), en het "building"-getterpatroon
// (cache 12h → force = achtergrond-rebuild → koud = 202-building + poll).

import { getBCToken } from "./bc-client";
import { fetchWithRetry } from "./http";
import { getCache, setCache } from "./sync-cache";

export const ODATA_ROOT = `https://api.businesscentral.dynamics.com/v2.0/${process.env.BC_TENANT_ID}/${process.env.BC_ENVIRONMENT || "production"}`;
export const API_ROOT = `${ODATA_ROOT}/api/v2.0`;

export function isDemoMode(): boolean { return process.env.NEXT_PUBLIC_DEMO_MODE !== "false"; }
export function isOperatingCompany(name: string): boolean { return !/^_/.test(name) && !/test|copie|fleetmate/i.test(name); }

export async function pageAllOData(url: string, cb: (row: Record<string, unknown>) => void, token?: string): Promise<void> {
  const tok = token || await getBCToken();
  let next: string | null = url; let page = 0;
  while (next && page < 800) {
    const res: Response = await fetchWithRetry(next, {
      headers: { Authorization: `Bearer ${tok}`, "Data-Access-Intent": "ReadOnly", Accept: "application/json" },
    }, { timeoutMs: 90_000, maxAttempts: 3 });
    if (!res.ok) throw new Error(`BC ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const data: { value?: Record<string, unknown>[]; "@odata.nextLink"?: string } = await res.json();
    for (const v of data.value || []) cb(v);
    next = data["@odata.nextLink"] || null;
    page++;
  }
  // Audit 11/08/2026: NOOIT stil afkappen — zelfde foutklasse als de $top-bug.
  if (next) throw new Error("BC-paging: 800-paginalimiet bereikt, dataset onvolledig — limiet verhogen i.p.v. stil afkappen");
}

export interface BuildingState { building: true; isLive: boolean }

/** Getter met het 202-building-patroon: cache 12h; force → achtergrond-rebuild met
 *  oude data + refreshing-vlag; koude cache → build start, 20s-race, anders {building}. */
export function makePolledGetter<T extends { refreshing?: boolean }>(
  keyPrefix: string,
  // `extra` = vrije sleutel-suffix (bv. "2026-01-01..2026-06-30" voor een datumrange,
  // vraag David 13/08/2026); getters die er niets mee doen negeren hem gewoon.
  build: (exclude: string[], extra?: string) => Promise<T>,
  demo: () => T
): (force?: boolean, exclude?: string[], extra?: string) => Promise<T | BuildingState> {
  const inflight = new Map<string, Promise<T>>();
  return async (force = false, exclude: string[] = [], extra?: string) => {
    if (isDemoMode()) return demo();
    const excl = [...new Set(exclude.map((x) => x.trim().toUpperCase()).filter(Boolean))].sort();
    const cacheKey = `${keyPrefix}-x:${excl.join(",")}${extra ? `-r:${extra}` : ""}`;
    const cached = getCache<T>(cacheKey);
    if (cached && !force) return cached;
    if (!inflight.has(cacheKey)) {
      const p = build(excl, extra)
        .then((r) => { setCache(cacheKey, r, 720); return r; })
        .finally(() => inflight.delete(cacheKey));
      inflight.set(cacheKey, p);
      p.catch((e) => console.error(`${keyPrefix} build failed:`, e));
    }
    if (cached) return { ...cached, refreshing: true };
    const winner = await Promise.race([
      inflight.get(cacheKey)!.then((r) => ({ done: r as T | null })),
      new Promise<{ done: null }>((res) => setTimeout(() => res({ done: null }), 20_000)),
    ]);
    if (winner.done) return winner.done;
    return { building: true, isLive: true };
  };
}

/** Route-helper: standaard GET-afhandeling voor een polled getter (CFO-gated door de caller). */
export async function polledResponse<T extends { refreshing?: boolean }>(
  req: Request,
  getter: (force?: boolean, exclude?: string[], extra?: string) => Promise<T | BuildingState>,
  extraFrom?: (sp: URLSearchParams) => string | undefined
): Promise<Response> {
  const url = new URL(req.url);
  const force = url.searchParams.get("refresh") === "1";
  const exclude = (url.searchParams.get("exclude") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const extra = extraFrom ? extraFrom(url.searchParams) : undefined;
  // no-store: de browser mag deze payloads NOOIT cachen. Een verouderde dataset naast
  // verse pagina-code liet de DSO-grafiek een piek van 132.302 dagen tonen die in de
  // huidige berekening niet meer bestaat (CFO-melding 04/08/2026).
  const noStore = { "Cache-Control": "no-store, max-age=0, must-revalidate" };
  try {
    const data = await getter(force, exclude, extra);
    if ("building" in data && data.building) return Response.json(data, { status: 202, headers: noStore });
    return Response.json(data, { headers: noStore });
  } catch (err) {
    console.error("polled route failed:", err);
    return Response.json({ error: String(err).slice(0, 300) }, { status: 500, headers: noStore });
  }
}
