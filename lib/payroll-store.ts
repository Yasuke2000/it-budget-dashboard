// Server-side store for EasyPay payroll cost entries.
//
// EasyPay Group (Belgian social secretariat) has no API — data arrives as a
// CSV/TXT file, either uploaded manually on the Import page or dropped by an
// automated job. Both paths POST to /api/import/easypay, which persists here.
//
// Persistence is best-effort file storage under a data dir (works on the homelab
// / any long-lived host; mount it as a Docker volume to survive restarts). If the
// filesystem isn't writable (e.g. serverless), it transparently falls back to an
// in-memory store for the life of the process.

import { promises as fs } from "fs";
import path from "path";
import type { PayrollCostEntry } from "./types";

const DATA_DIR = process.env.PAYROLL_DATA_DIR || path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "easypay-payroll.json");

let memoryStore: PayrollCostEntry[] | null = null;

async function readFromDisk(): Promise<PayrollCostEntry[] | null> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PayrollCostEntry[]) : [];
  } catch {
    return null; // not present or unreadable
  }
}

async function writeToDisk(entries: PayrollCostEntry[]): Promise<boolean> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(STORE_PATH, JSON.stringify(entries, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}

/** All stored payroll entries (disk first, then in-memory fallback). */
export async function getPayrollEntries(): Promise<PayrollCostEntry[]> {
  const disk = await readFromDisk();
  if (disk) return disk;
  return memoryStore ?? [];
}

/**
 * Upsert entries by (month, companyId, source) — re-importing a month replaces it
 * rather than double-counting. Returns the merged set.
 */
export async function savePayrollEntries(
  incoming: PayrollCostEntry[]
): Promise<PayrollCostEntry[]> {
  const existing = await getPayrollEntries();
  const key = (e: PayrollCostEntry) => `${e.source}__${e.companyId}__${e.month}`;
  const merged = new Map<string, PayrollCostEntry>();
  for (const e of existing) merged.set(key(e), e);
  for (const e of incoming) merged.set(key(e), e);

  const result = Array.from(merged.values()).sort((a, b) => a.month.localeCompare(b.month));
  const wrote = await writeToDisk(result);
  if (!wrote) memoryStore = result; // keep in memory if disk unavailable
  return result;
}

/** Remove all entries for a source (default EasyPay). */
export async function clearPayrollEntries(source = "EasyPay"): Promise<void> {
  const existing = await getPayrollEntries();
  const remaining = existing.filter((e) => e.source !== source);
  const wrote = await writeToDisk(remaining);
  if (!wrote) memoryStore = remaining;
}
