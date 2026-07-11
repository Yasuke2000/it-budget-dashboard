// Durable settings (GL account → category mappings, license prices, …).
// Postgres-backed when DATABASE_URL is set, else a JSON file / in-memory map.
// Stored values OVERRIDE the compiled defaults in constants.ts.

import { promises as fs } from "fs";
import path from "path";
import { DEFAULT_GL_MAPPING, DEFAULT_LICENSE_PRICES, IT_VENDOR_RULES, OPERATIONAL_SOFTWARE_VENDORS, IT_DEPRECIATION_ACCOUNTS } from "./constants";

// Accounts that must NEVER be counted as IT spend, even if a mis-edit in Settings
// adds them to the GL mapping: depreciation/amortisation (class 63 — would
// double-count the asset + its write-down, breaching the Belgian-GAAP matching
// rule) and suspense/clearing accounts (49x — e.g. prepaid-card holding accounts,
// not expenses). Stripped from the merged mapping defensively.
function isForbiddenSpendAccount(acct: string): boolean {
  // 63x = depreciation/amortisation expense; 49x = suspense/clearing; 2…09 =
  // class-2 accumulated-depreciation contra accounts (e.g. 240209, 215009) — all
  // would distort the spend total if mapped.
  return /^(63|49)/.test(acct) || /^2\d*09$/.test(acct) || IT_DEPRECIATION_ACCOUNTS.includes(acct);
}
import { isDbEnabled, ensureSchema, withClient } from "./db/client";

const DATA_DIR = process.env.PAYROLL_DATA_DIR || path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "settings.json");

let memoryStore: Record<string, unknown> = {};

function envNumber(name: string): number | null {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

export interface AppSettings {
  glMappings: Record<string, string>;
  licensePrices: Record<string, number>;
  itVendorRules: Record<string, string>;
  // Per-category MONTHLY budget (EUR). Empty until configured in Settings → Budget.
  budgets: Record<string, number>;
  // Operational/business-system software (TMS/telematics) vendor patterns, and
  // whether their spend counts toward the IT total.
  operationalSoftwareVendors: string[];
  includeOperationalSoftware: boolean;
  // IT-spend-%-of-revenue benchmark. consolidatedRevenue = audited external
  // revenue (overrides the gross class-70 figure, which is inflated by
  // intercompany); 0/undefined → use gross. benchmarkPercent = industry median
  // to compare against (transport ≈ 3.3%).
  consolidatedRevenue: number;
  revenueBenchmarkPercent: number;
  // Show the Peppol e-invoicing page in the nav. Off by default — the page isn't
  // connected to a live Peppol Access Point yet, so it's hidden until enabled.
  showPeppol: boolean;
  // License-optimization buffer: spare seats per SKU NOT counted as reclaimable
  // waste (you keep a few for new hires). 0 = flag every unused seat.
  licenseBufferSeats: number;
}

// Resilience: settings are written to BOTH Postgres (when enabled) and the
// JSON file on the data PVC, and reads fall back DB → file → memory. A DB
// wipe/outage therefore never loses configuration (the file copy backfills
// the DB on the next read), and a broken read degrades instead of throwing.

async function readFileStore(): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(STORE_PATH, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function writeFileStore(key: string, value: unknown): Promise<void> {
  const current = (await readFileStore()) ?? { ...memoryStore };
  current[key] = value;
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(STORE_PATH, JSON.stringify(current, null, 2), "utf8");
  } catch {
    memoryStore = current;
  }
}

async function dbUpsert(key: string, value: unknown): Promise<void> {
  await ensureSchema();
  await withClient((c) =>
    c.query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, JSON.stringify(value)]
    )
  );
}

async function getSetting<T>(key: string): Promise<T | null> {
  // 1) Postgres (best effort — a DB outage must not take settings down).
  if (isDbEnabled()) {
    try {
      await ensureSchema();
      const fromDb = await withClient(async (c) => {
        const { rows } = await c.query(`SELECT value FROM app_settings WHERE key = $1`, [key]);
        return rows.length ? (rows[0].value as T) : null;
      });
      if (fromDb !== null) return fromDb;
    } catch (err) {
      console.warn(`settings: DB read failed for "${key}" — falling back to file store:`, err);
    }
  }
  // 2) JSON file on the data PVC (survives DB wipes; backfills the DB).
  const fileStore = await readFileStore();
  if (fileStore && fileStore[key] !== undefined && fileStore[key] !== null) {
    if (isDbEnabled()) dbUpsert(key, fileStore[key]).catch(() => {});
    return fileStore[key] as T;
  }
  // 3) In-memory last resort.
  return (memoryStore[key] as T) ?? null;
}

async function setSetting(key: string, value: unknown): Promise<void> {
  if (isDbEnabled()) {
    try {
      await dbUpsert(key, value);
    } catch (err) {
      console.warn(`settings: DB write failed for "${key}" — keeping file copy:`, err);
    }
  }
  // Always keep a durable copy on the PVC too.
  await writeFileStore(key, value);
}

/** Settings merged over the compiled defaults. */
export async function getAppSettings(): Promise<AppSettings> {
  const [gl, prices, vendors, budgets, opVendors, includeOp, consolidatedRev, benchmarkPct, showPeppol, licBuffer] = await Promise.all([
    getSetting<Record<string, string>>("glMappings"),
    getSetting<Record<string, number>>("licensePrices"),
    getSetting<Record<string, string>>("itVendorRules"),
    getSetting<Record<string, number>>("budgets"),
    getSetting<string[]>("operationalSoftwareVendors"),
    getSetting<boolean>("includeOperationalSoftware"),
    getSetting<number>("consolidatedRevenue"),
    getSetting<number>("revenueBenchmarkPercent"),
    getSetting<boolean>("showPeppol"),
    getSetting<number>("licenseBufferSeats"),
  ]);
  // Merge stored GL overrides over defaults, then strip any forbidden account
  // (depreciation 63x / suspense 49x) so it can never leak into the spend total.
  const mergedGl: Record<string, string> = { ...DEFAULT_GL_MAPPING, ...(gl ?? {}) };
  for (const acct of Object.keys(mergedGl)) {
    if (isForbiddenSpendAccount(acct)) delete mergedGl[acct];
  }
  return {
    glMappings: mergedGl,
    licensePrices: { ...DEFAULT_LICENSE_PRICES, ...(prices ?? {}) },
    itVendorRules: { ...IT_VENDOR_RULES, ...(vendors ?? {}) },
    budgets: { ...(budgets ?? {}) },
    operationalSoftwareVendors: opVendors ?? OPERATIONAL_SOFTWARE_VENDORS,
    // Default: count operational software in the IT total (true) unless told otherwise.
    includeOperationalSoftware: includeOp ?? true,
    // Env vars are the last-resort default so a full storage loss still shows
    // the audited consolidated figure instead of silently reverting to gross.
    consolidatedRevenue: consolidatedRev ?? envNumber("CONSOLIDATED_REVENUE") ?? 0,
    // Gartner transport-industry median IT-spend-of-revenue.
    revenueBenchmarkPercent: benchmarkPct ?? envNumber("REVENUE_BENCHMARK_PERCENT") ?? 3.3,
    showPeppol: showPeppol ?? false,
    licenseBufferSeats: licBuffer ?? 0,
  };
}

export async function saveAppSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  if (settings.glMappings) await setSetting("glMappings", settings.glMappings);
  if (settings.licensePrices) await setSetting("licensePrices", settings.licensePrices);
  if (settings.itVendorRules) await setSetting("itVendorRules", settings.itVendorRules);
  if (settings.budgets) await setSetting("budgets", settings.budgets);
  if (settings.operationalSoftwareVendors) await setSetting("operationalSoftwareVendors", settings.operationalSoftwareVendors);
  if (settings.includeOperationalSoftware !== undefined) await setSetting("includeOperationalSoftware", settings.includeOperationalSoftware);
  if (settings.consolidatedRevenue !== undefined) await setSetting("consolidatedRevenue", settings.consolidatedRevenue);
  if (settings.revenueBenchmarkPercent !== undefined) await setSetting("revenueBenchmarkPercent", settings.revenueBenchmarkPercent);
  if (settings.showPeppol !== undefined) await setSetting("showPeppol", settings.showPeppol);
  if (settings.licenseBufferSeats !== undefined) await setSetting("licenseBufferSeats", settings.licenseBufferSeats);
  return getAppSettings();
}
