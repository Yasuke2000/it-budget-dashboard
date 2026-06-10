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

const DATA_DIR = process.env.PAYROLL_DATA_DIR || path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "software-licenses.json");

let memoryStore: SoftwareLicense[] | null = null;

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
  const disk = await readFromDisk();
  if (disk) return disk;
  return memoryStore ?? [];
}

/** Upsert by (vendor, product) so re-importing updates seats/cost rather than duplicating. */
export async function saveSoftwareLicenses(
  incoming: SoftwareLicense[]
): Promise<SoftwareLicense[]> {
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
  const wrote = await writeToDisk([]);
  if (!wrote) memoryStore = [];
}
