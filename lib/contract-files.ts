// Storage for uploaded contract documents (PDF/images/office docs). Files live
// on the data volume (PVC) under contract-files/, keyed by a random id. We never
// put blobs in Postgres — only the contract record references {fileId, fileName}.
// Filenames are sanitised; the stored path is `${id}__${safeName}`.

import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

const DATA_DIR = process.env.PAYROLL_DATA_DIR || path.join(process.cwd(), "data");
const FILES_DIR = path.join(DATA_DIR, "contract-files");

const ALLOWED_EXT = new Set([".pdf", ".png", ".jpg", ".jpeg", ".docx", ".doc", ".xlsx", ".xls", ".txt", ".eml", ".msg"]);
export const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

function sanitize(name: string): string {
  return (name || "document")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(-120);
}

export interface StoredFileRef {
  fileId: string;
  fileName: string;
}

/** Persist an uploaded file, returning the id + original (sanitised) name. */
export async function saveContractFile(originalName: string, bytes: Buffer): Promise<StoredFileRef> {
  const safe = sanitize(originalName);
  const ext = path.extname(safe).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    throw new Error(`Unsupported file type "${ext || "(none)"}". Allowed: ${[...ALLOWED_EXT].join(", ")}`);
  }
  if (bytes.length > MAX_FILE_BYTES) {
    throw new Error(`File too large (${(bytes.length / 1048576).toFixed(1)} MB, max 20 MB)`);
  }
  const fileId = randomUUID();
  await fs.mkdir(FILES_DIR, { recursive: true });
  await fs.writeFile(path.join(FILES_DIR, `${fileId}__${safe}`), bytes);
  return { fileId, fileName: safe };
}

/** Resolve the on-disk path + content for a stored file id. Null if missing. */
export async function readContractFile(fileId: string): Promise<{ name: string; data: Buffer } | null> {
  // Guard against path traversal — fileId must be a bare UUID.
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return null;
  let entries: string[];
  try {
    entries = await fs.readdir(FILES_DIR);
  } catch {
    return null;
  }
  const match = entries.find((e) => e.startsWith(`${fileId}__`));
  if (!match) return null;
  const data = await fs.readFile(path.join(FILES_DIR, match));
  return { name: match.slice(fileId.length + 2), data };
}

export async function deleteContractFile(fileId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return;
  try {
    const entries = await fs.readdir(FILES_DIR);
    const match = entries.find((e) => e.startsWith(`${fileId}__`));
    if (match) await fs.unlink(path.join(FILES_DIR, match));
  } catch {
    /* best effort */
  }
}

export function contentTypeFor(name: string): string {
  const ext = path.extname(name).toLowerCase();
  const map: Record<string, string> = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".txt": "text/plain; charset=utf-8",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
  return map[ext] || "application/octet-stream";
}
