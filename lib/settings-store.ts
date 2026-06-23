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
}

async function getSetting<T>(key: string): Promise<T | null> {
  if (isDbEnabled()) {
    await ensureSchema();
    return withClient(async (c) => {
      const { rows } = await c.query(`SELECT value FROM app_settings WHERE key = $1`, [key]);
      return rows.length ? (rows[0].value as T) : null;
    });
  }
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return (parsed[key] as T) ?? null;
  } catch {
    return (memoryStore[key] as T) ?? null;
  }
}

async function setSetting(key: string, value: unknown): Promise<void> {
  if (isDbEnabled()) {
    await ensureSchema();
    await withClient((c) =>
      c.query(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, JSON.stringify(value)]
      )
    );
    return;
  }
  // File fallback (best-effort), then in-memory.
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(await fs.readFile(STORE_PATH, "utf8"));
  } catch {
    current = { ...memoryStore };
  }
  current[key] = value;
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(STORE_PATH, JSON.stringify(current, null, 2), "utf8");
  } catch {
    memoryStore = current;
  }
}

/** Settings merged over the compiled defaults. */
export async function getAppSettings(): Promise<AppSettings> {
  const [gl, prices, vendors, budgets, opVendors, includeOp, consolidatedRev, benchmarkPct, showPeppol] = await Promise.all([
    getSetting<Record<string, string>>("glMappings"),
    getSetting<Record<string, number>>("licensePrices"),
    getSetting<Record<string, string>>("itVendorRules"),
    getSetting<Record<string, number>>("budgets"),
    getSetting<string[]>("operationalSoftwareVendors"),
    getSetting<boolean>("includeOperationalSoftware"),
    getSetting<number>("consolidatedRevenue"),
    getSetting<number>("revenueBenchmarkPercent"),
    getSetting<boolean>("showPeppol"),
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
    consolidatedRevenue: consolidatedRev ?? 0,
    // Gartner transport-industry median IT-spend-of-revenue.
    revenueBenchmarkPercent: benchmarkPct ?? 3.3,
    showPeppol: showPeppol ?? false,
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
  return getAppSettings();
}
