// Server-side store for non-Microsoft software licenses (Adobe, antivirus, SaaS,
// perpetual licenses, etc.). Tracked manually or via CSV/automated import — there's
// no single API for these the way Graph covers M365.
//
// Same persistence model as payroll-store: best-effort JSON file under the data dir
// (mount as a Docker volume to survive restarts), in-memory fallback otherwise.
// Ports cleanly to Postgres later behind the data-source abstraction.

import { promises as fs } from "fs";
import path from "path";
import type { SoftwareLicense } from "./types";
import { isDbEnabled, ensureSchema, withClient } from "./db/client";

const DATA_DIR = process.env.PAYROLL_DATA_DIR || path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "software-licenses.json");

let memoryStore: SoftwareLicense[] | null = null;

function rowToLicense(r: Record<string, unknown>): SoftwareLicense {
  return {
    id: r.id as string,
    vendor: r.vendor as string,
    product: r.product as string,
    licenseType: r.license_type as SoftwareLicense["licenseType"],
    seats: Number(r.seats),
    assignedSeats: Number(r.assigned_seats),
    unitCost: Number(r.unit_cost),
    billingCycle: r.billing_cycle as SoftwareLicense["billingCycle"],
    monthlyCost: Number(r.monthly_cost),
    annualCost: Number(r.annual_cost),
    renewalDate: (r.renewal_date as string) || undefined,
    autoRenew: r.auto_renew == null ? undefined : Boolean(r.auto_renew),
    category: r.category as string,
    source: r.source as string,
    notes: (r.notes as string) || undefined,
  };
}

async function readFromDisk(): Promise<SoftwareLicense[] | null> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SoftwareLicense[]) : [];
  } catch {
    return null;
  }
}

async function writeToDisk(entries: SoftwareLicense[]): Promise<boolean> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(STORE_PATH, JSON.stringify(entries, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}

export async function getSoftwareLicensesStored(): Promise<SoftwareLicense[]> {
  if (isDbEnabled()) {
    await ensureSchema();
    return withClient(async (c) => {
      const { rows } = await c.query(`SELECT * FROM software_licenses ORDER BY vendor, product`);
      return rows.map(rowToLicense);
    });
  }
  const disk = await readFromDisk();
  if (disk) return disk;
  return memoryStore ?? [];
}

/** Upsert by (vendor, product) so re-importing updates seats/cost rather than duplicating. */
export async function saveSoftwareLicenses(
  incoming: SoftwareLicense[]
): Promise<SoftwareLicense[]> {
  if (isDbEnabled()) {
    await ensureSchema();
    await withClient(async (c) => {
      for (const l of incoming) {
        await c.query(
          `INSERT INTO software_licenses
             (id, vendor, product, license_type, seats, assigned_seats, unit_cost,
              billing_cycle, monthly_cost, annual_cost, renewal_date, auto_renew,
              category, source, notes, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, NOW())
           ON CONFLICT (vendor, product) DO UPDATE SET
             license_type = EXCLUDED.license_type, seats = EXCLUDED.seats,
             assigned_seats = EXCLUDED.assigned_seats, unit_cost = EXCLUDED.unit_cost,
             billing_cycle = EXCLUDED.billing_cycle, monthly_cost = EXCLUDED.monthly_cost,
             annual_cost = EXCLUDED.annual_cost, renewal_date = EXCLUDED.renewal_date,
             auto_renew = EXCLUDED.auto_renew, category = EXCLUDED.category,
             source = EXCLUDED.source, notes = EXCLUDED.notes, updated_at = NOW()`,
          [l.id, l.vendor, l.product, l.licenseType, l.seats, l.assignedSeats, l.unitCost,
           l.billingCycle, l.monthlyCost, l.annualCost, l.renewalDate ?? null,
           l.autoRenew ?? null, l.category, l.source, l.notes ?? null]
        );
      }
    });
    return getSoftwareLicensesStored();
  }

  const existing = await getSoftwareLicensesStored();
  const key = (l: SoftwareLicense) => `${l.vendor.toLowerCase()}__${l.product.toLowerCase()}`;
  const merged = new Map<string, SoftwareLicense>();
  for (const l of existing) merged.set(key(l), l);
  for (const l of incoming) merged.set(key(l), l);

  const result = Array.from(merged.values()).sort((a, b) =>
    `${a.vendor} ${a.product}`.localeCompare(`${b.vendor} ${b.product}`)
  );
  const wrote = await writeToDisk(result);
  if (!wrote) memoryStore = result;
  return result;
}

export async function clearSoftwareLicenses(): Promise<void> {
  if (isDbEnabled()) {
    await ensureSchema();
    await withClient((c) => c.query(`DELETE FROM software_licenses`));
    return;
  }
  const wrote = await writeToDisk([]);
  if (!wrote) memoryStore = [];
}
