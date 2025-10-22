"use client";

import { useState, useEffect, useCallback } from "react";
import { getImportedData } from "./imported-data";
import type {
  PurchaseInvoice,
  BudgetEntry,
  ManagedDevice,
  M365License,
} from "./types";

/**
 * Hook that checks localStorage for imported data.
 * Returns imported data if available, null otherwise.
 * Listens for import events to re-check.
 */
export function useImportedData<T>(
  type: "invoices" | "budget" | "devices" | "licenses"
): { data: T[] | null; isImported: boolean; refresh: () => void } {
  const [data, setData] = useState<T[] | null>(null);

  const refresh = useCallback(() => {
    const imported = getImportedData<T>(type);
    setData(imported);
  }, [type]);

  useEffect(() => {
    refresh();

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

/** Check if any imported data exists (for showing badges/indicators) */
export function useHasImportedData(): boolean {
  const [has, setHas] = useState(false);

  useEffect(() => {
    const check = () => {
      const keys = [
        "itdash_imported_invoices",
        "itdash_imported_budget",
        "itdash_imported_devices",
        "itdash_imported_licenses",
      ];
      setHas(keys.some((k) => localStorage.getItem(k) !== null));
    };

    check();
    window.addEventListener("itdash-data-imported", check);
    return () => window.removeEventListener("itdash-data-imported", check);
  }, []);

  return has;
}
