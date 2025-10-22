"use client";

const STORAGE_KEYS = {
  invoices: 'itdash_imported_invoices',
  budget: 'itdash_imported_budget',
  devices: 'itdash_imported_devices',
  licenses: 'itdash_imported_licenses',
} as const;

type DataType = keyof typeof STORAGE_KEYS;

export function saveImportedData(type: DataType, data: unknown[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEYS[type], JSON.stringify(data));
  // Dispatch event so other components know data changed
  window.dispatchEvent(new CustomEvent('itdash-data-imported', { detail: { type } }));
}

export function getImportedData<T>(type: DataType): T[] | null {
  if (typeof window === 'undefined') return null;
  const stored = localStorage.getItem(STORAGE_KEYS[type]);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as T[];
  } catch {
    return null;
  }
}

export function clearImportedData(type: DataType): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEYS[type]);
  window.dispatchEvent(new CustomEvent('itdash-data-imported', { detail: { type } }));
}

export function clearAllImportedData(): void {
  Object.values(STORAGE_KEYS).forEach(key => {
    if (typeof window !== 'undefined') localStorage.removeItem(key);
  });
  window.dispatchEvent(new CustomEvent('itdash-data-imported', { detail: { type: 'all' } }));
}

export function hasImportedData(type: DataType): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(STORAGE_KEYS[type]) !== null;
}

export function getImportedDataStats(): Record<DataType, { count: number; importedAt?: string }> {
  const stats = {} as Record<DataType, { count: number; importedAt?: string }>;
  for (const [type, key] of Object.entries(STORAGE_KEYS) as [DataType, string][]) {
    const stored = typeof window !== 'undefined' ? localStorage.getItem(key) : null;
    if (stored) {
      try {
        const data = JSON.parse(stored);
        stats[type] = { count: Array.isArray(data) ? data.length : 0 };
      } catch {
        stats[type] = { count: 0 };
      }
    } else {
      stats[type] = { count: 0 };
    }
  }
  return stats;
}
