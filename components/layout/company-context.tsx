"use client";

import React, { createContext, useContext, useState, ReactNode } from "react";
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
  const [selectedCompany, setSelectedCompany] = useState<CompanyFilter>("all");
  return (
    <CompanyContext.Provider value={{ selectedCompany, setSelectedCompany }}>
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  return useContext(CompanyContext);
}
