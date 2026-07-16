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
