// Durable settings (GL account → category mappings, license prices, …).
// Postgres-backed when DATABASE_URL is set, else a JSON file / in-memory map.
// Stored values OVERRIDE the compiled defaults in constants.ts.

import { promises as fs } from "fs";
import path from "path";
import { DEFAULT_GL_MAPPING, DEFAULT_LICENSE_PRICES, IT_VENDOR_RULES } from "./constants";
import { isDbEnabled, ensureSchema, withClient } from "./db/client";

const DATA_DIR = process.env.PAYROLL_DATA_DIR || path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "settings.json");

let memoryStore: Record<string, unknown> = {};

export interface AppSettings {
  glMappings: Record<string, string>;
  licensePrices: Record<string, number>;
  itVendorRules: Record<string, string>;
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
  const [gl, prices, vendors] = await Promise.all([
    getSetting<Record<string, string>>("glMappings"),
    getSetting<Record<string, number>>("licensePrices"),
    getSetting<Record<string, string>>("itVendorRules"),
  ]);
  return {
    glMappings: { ...DEFAULT_GL_MAPPING, ...(gl ?? {}) },
    licensePrices: { ...DEFAULT_LICENSE_PRICES, ...(prices ?? {}) },
    itVendorRules: { ...IT_VENDOR_RULES, ...(vendors ?? {}) },
  };
}

export async function saveAppSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  if (settings.glMappings) await setSetting("glMappings", settings.glMappings);
  if (settings.licensePrices) await setSetting("licensePrices", settings.licensePrices);
  if (settings.itVendorRules) await setSetting("itVendorRules", settings.itVendorRules);
  return getAppSettings();
}
