"use client";

import React, { createContext, useContext, useState, useMemo, useCallback, ReactNode } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { CompanyFilter } from "@/lib/types";

interface CompanyContextType {
  selectedCompany: CompanyFilter;
  setSelectedCompany: (company: CompanyFilter) => void;
}

const CompanyContext = createContext<CompanyContextType>({
  selectedCompany: "all",
  setSelectedCompany: () => {},
});

export function CompanyProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // URL is the source of truth so SERVER pages (Invoices/Vendors/Budget/…) react
  // to the selector too; client pages read this context.
  const [selectedCompany, setCompany] = useState<CompanyFilter>(
    () => (searchParams.get("company") as CompanyFilter) || "all"
  );

  const setSelectedCompany = useCallback(
    (c: CompanyFilter) => {
      setCompany(c);
      const params = new URLSearchParams(Array.from(searchParams.entries()));
      if (!c || c === "all") params.delete("company");
      else params.set("company", c);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  const value = useMemo(
    () => ({ selectedCompany, setSelectedCompany }),
    [selectedCompany, setSelectedCompany]
  );
  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompany() {
  return useContext(CompanyContext);
}
