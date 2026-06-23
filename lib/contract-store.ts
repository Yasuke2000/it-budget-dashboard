// Server-side store for IT contracts & renewals (manually tracked, optionally
// seeded from recurring vendor spend). Same persistence model as the software-
// license store: Postgres when DATABASE_URL is set, else a JSON file under the
// data dir (mount as a volume to survive restarts), in-memory as last resort.
//
// `status` is NOT stored — it is derived from the end date at read time (see
// getContracts in data-source.ts), so it can never drift from reality.

import { promises as fs } from "fs";
import path from "path";
import type { Contract } from "./types";
import { isDbEnabled, ensureSchema, withClient } from "./db/client";

const DATA_DIR = process.env.PAYROLL_DATA_DIR || path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "contracts.json");

// Everything on Contract except the derived `status`.
export type StoredContract = Omit<Contract, "status">;

let memoryStore: StoredContract[] | null = null;

function rowToContract(r: Record<string, unknown>): StoredContract {
  return {
    id: r.id as string,
    vendor: r.vendor as string,
    description: (r.description as string) || "",
    category: (r.category as StoredContract["category"]) || "saas",
    startDate: (r.start_date as string) || "",
    endDate: (r.end_date as string) || "",
    renewalType: (r.renewal_type as StoredContract["renewalType"]) || "manual",
    autoRenew: Boolean(r.auto_renew),
    noticePeriodDays: Number(r.notice_period_days) || 0,
    monthlyCost: Number(r.monthly_cost) || 0,
    annualCost: Number(r.annual_cost) || 0,
    billingCycle: (r.billing_cycle as StoredContract["billingCycle"]) || "annual",
    owner: (r.owner as string) || "",
    notes: (r.notes as string) || "",
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    fileId: (r.file_id as string) || undefined,
    fileName: (r.file_name as string) || undefined,
  };
}

async function readFromDisk(): Promise<StoredContract[] | null> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredContract[]) : [];
  } catch {
    return null;
  }
}

async function writeToDisk(entries: StoredContract[]): Promise<boolean> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(STORE_PATH, JSON.stringify(entries, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}

export async function getContractsStored(): Promise<StoredContract[]> {
  if (isDbEnabled()) {
    await ensureSchema();
    return withClient(async (c) => {
      const { rows } = await c.query(`SELECT * FROM contracts ORDER BY end_date NULLS LAST, vendor`);
      return rows.map(rowToContract);
    });
  }
  const disk = await readFromDisk();
  if (disk) return disk;
  return memoryStore ?? [];
}

/** Insert or update a single contract by id. */
export async function upsertContract(c: StoredContract): Promise<StoredContract> {
  if (isDbEnabled()) {
    await ensureSchema();
    await withClient((cl) =>
      cl.query(
        `INSERT INTO contracts
           (id, vendor, description, category, start_date, end_date, renewal_type,
            auto_renew, notice_period_days, monthly_cost, annual_cost, billing_cycle,
            owner, notes, tags, file_id, file_name, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, NOW())
         ON CONFLICT (id) DO UPDATE SET
           vendor = EXCLUDED.vendor, description = EXCLUDED.description,
           category = EXCLUDED.category, start_date = EXCLUDED.start_date,
           end_date = EXCLUDED.end_date, renewal_type = EXCLUDED.renewal_type,
           auto_renew = EXCLUDED.auto_renew, notice_period_days = EXCLUDED.notice_period_days,
           monthly_cost = EXCLUDED.monthly_cost, annual_cost = EXCLUDED.annual_cost,
           billing_cycle = EXCLUDED.billing_cycle, owner = EXCLUDED.owner,
           notes = EXCLUDED.notes, tags = EXCLUDED.tags, file_id = EXCLUDED.file_id,
           file_name = EXCLUDED.file_name, updated_at = NOW()`,
        [c.id, c.vendor, c.description, c.category, c.startDate || null, c.endDate || null,
         c.renewalType, c.autoRenew, c.noticePeriodDays, c.monthlyCost, c.annualCost,
         c.billingCycle, c.owner, c.notes, JSON.stringify(c.tags || []),
         c.fileId ?? null, c.fileName ?? null]
      )
    );
    return c;
  }
  const existing = (await getContractsStored()).filter((x) => x.id !== c.id);
  const result = [...existing, c].sort((a, b) => (a.endDate || "9999").localeCompare(b.endDate || "9999"));
  const wrote = await writeToDisk(result);
  if (!wrote) memoryStore = result;
  return c;
}

export async function deleteContract(id: string): Promise<void> {
  if (isDbEnabled()) {
    await ensureSchema();
    await withClient((c) => c.query(`DELETE FROM contracts WHERE id = $1`, [id]));
    return;
  }
  const result = (await getContractsStored()).filter((x) => x.id !== id);
  const wrote = await writeToDisk(result);
  if (!wrote) memoryStore = result;
}
