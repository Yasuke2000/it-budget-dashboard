"use client";

import { useState, useEffect, useCallback } from "react";
import { getImportedData } from "./imported-data";

/**
 * Hook that checks localStorage for imported data.
 * Returns imported data if available, null otherwise.
 * Listens for import events to re-check.
 */
export function useImportedData<T>(
  type: "invoices" | "budget" | "devices" | "licenses"
): { data: T[] | null; isImported: boolean; refresh: () => void } {
  const [data, setData] = useState<T[] | null>(() => getImportedData<T>(type));

  const refresh = useCallback(() => {
    const imported = getImportedData<T>(type);
    setData(imported);
  }, [type]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail.type === type || detail.type === "all") {
        refresh();
      }
    };

    window.addEventListener("itdash-data-imported", handler);
    return () => window.removeEventListener("itdash-data-imported", handler);
  }, [type, refresh]);

  return { data, isImported: data !== null, refresh };
}

const IMPORTED_KEYS = [
  "itdash_imported_invoices",
  "itdash_imported_budget",
  "itdash_imported_devices",
  "itdash_imported_licenses",
];

function checkHasImportedData(): boolean {
  if (typeof window === "undefined") return false;
  return IMPORTED_KEYS.some((k) => localStorage.getItem(k) !== null);
}

/** Check if any imported data exists (for showing badges/indicators) */
export function useHasImportedData(): boolean {
  const [has, setHas] = useState(() => checkHasImportedData());

  useEffect(() => {
    const check = () => setHas(checkHasImportedData());
    window.addEventListener("itdash-data-imported", check);
    return () => window.removeEventListener("itdash-data-imported", check);
  }, []);

  return has;
}
