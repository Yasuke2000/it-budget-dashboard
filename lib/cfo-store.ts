// Materialized GL-balance snapshot for the CFO cockpit.
//
// SCAFFOLD / infra item: the full statutory balance sheet needs cumulative
// balances for GL classes 4/5, which exceed the live API row cap. This module
// materializes per-account net balances into Postgres so the balance sheet can be
// a fast read. Populate with POST /api/cfo/refresh-snapshot (nightly/cron).
// Reading is best-effort and gated on DATABASE_URL — absent it, the cockpit falls
// back to the live condensed balance. Wiring the read into the balance sheet is
// the remaining step (kept out of the live path until validated against the DB).

import { isDbEnabled, ensureSchema, withClient } from "./db/client";
import { fetchBCCompanies, fetchBCGlNetByAccount } from "./bc-client";
import type { CfoFinancials } from "./types";

function isOperatingCompany(name: string): boolean {
  return !/^_/.test(name) && !/test|copie|fleetmate/i.test(name);
}

export function snapshotEnabled(): boolean {
  return isDbEnabled();
}

/** Read materialized net balances for the given company codes → { code: { account: net } }. */
export async function getGlSnapshot(codes: string[]): Promise<Record<string, Record<string, number>> | null> {
  if (!isDbEnabled()) return null;
  try {
    await ensureSchema();
    return await withClient(async (c) => {
      const { rows } = await c.query(
        `SELECT company_code, account, net_balance FROM cfo_gl_snapshot WHERE company_code = ANY($1)`,
        [codes]
      );
      const out: Record<string, Record<string, number>> = {};
      for (const r of rows) {
        (out[r.company_code] = out[r.company_code] || {})[r.account] = Number(r.net_balance);
      }
      return Object.keys(out).length ? out : null;
    });
  } catch (err) {
    console.warn("cfo snapshot read failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Point-in-time cockpit snapshots (SAP-achtig "cijfers zoals op dag X").
// ---------------------------------------------------------------------------

export interface CfoSnapshotMeta {
  id: number;
  takenAt: string;   // ISO timestamp
  takenOn: string;   // "YYYY-MM-DD"
  company: string;
  excluded: string;  // "GPR,GRE" of ""
  manual: boolean;
  revenue: number;   // headline voor de lijstweergave
}

/** Sla de volledige berekende cockpit-dataset op. `manual` = via de knop (vs auto-daily). */
export async function saveCfoSnapshot(data: CfoFinancials, manual: boolean): Promise<number | null> {
  if (!isDbEnabled()) return null;
  await ensureSchema();
  const excluded = (data.scope?.excluded || []).join(",");
  return withClient(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO cfo_snapshots (company, excluded, manual, payload) VALUES ($1, $2, $3, $4) RETURNING id`,
      [data.company, excluded, manual, JSON.stringify(data)]
    );
    return Number(rows[0].id);
  });
}

/** Bestaat er vandaag al een auto-snapshot voor deze view? (dedupe voor de daily) */
export async function hasSnapshotToday(company: string, excluded: string): Promise<boolean> {
  if (!isDbEnabled()) return true; // zonder DB nooit auto-saven
  await ensureSchema();
  return withClient(async (c) => {
    const { rows } = await c.query(
      `SELECT 1 FROM cfo_snapshots WHERE taken_on = CURRENT_DATE AND company = $1 AND excluded = $2 AND manual = FALSE LIMIT 1`,
      [company, excluded]
    );
    return rows.length > 0;
  });
}

export async function listCfoSnapshots(limit = 60): Promise<CfoSnapshotMeta[]> {
  if (!isDbEnabled()) return [];
  await ensureSchema();
  return withClient(async (c) => {
    const { rows } = await c.query(
      `SELECT id, taken_at, taken_on, company, excluded, manual, payload->'kpis'->>'revenue' AS revenue
       FROM cfo_snapshots ORDER BY taken_at DESC LIMIT $1`,
      [limit]
    );
    return rows.map((r) => ({
      id: Number(r.id), takenAt: new Date(r.taken_at).toISOString(), takenOn: new Date(r.taken_on).toISOString().slice(0, 10),
      company: r.company, excluded: r.excluded, manual: r.manual, revenue: Number(r.revenue) || 0,
    }));
  });
}

export async function getCfoSnapshot(id: number): Promise<{ takenAt: string; payload: CfoFinancials } | null> {
  if (!isDbEnabled()) return null;
  await ensureSchema();
  return withClient(async (c) => {
    const { rows } = await c.query(`SELECT taken_at, payload FROM cfo_snapshots WHERE id = $1`, [id]);
    if (!rows.length) return null;
    return { takenAt: new Date(rows[0].taken_at).toISOString(), payload: rows[0].payload as CfoFinancials };
  });
}

/** Pull the full ledger for every operating company and upsert per-account net balances. Heavy — background job. */
export async function refreshGlSnapshot(): Promise<{ companies: number; accounts: number }> {
  if (!isDbEnabled()) throw new Error("DATABASE_URL not set — snapshot needs Postgres");
  await ensureSchema();
  const comps = (await fetchBCCompanies()).filter((c) => isOperatingCompany(String(c.name)));
  let accounts = 0;
  for (const c of comps) {
    const balances = await fetchBCGlNetByAccount(String(c.id));
    const entries = Object.entries(balances);
    await withClient(async (cl) => {
      for (const [account, net] of entries) {
        await cl.query(
          `INSERT INTO cfo_gl_snapshot (company_code, account, net_balance, refreshed_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (company_code, account) DO UPDATE SET net_balance = EXCLUDED.net_balance, refreshed_at = NOW()`,
          [String(c.name), account, net]
        );
      }
    });
    accounts += entries.length;
  }
  return { companies: comps.length, accounts };
}
