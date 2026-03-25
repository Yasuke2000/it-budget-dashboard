"use client";

import React, { createContext, useContext, useState, ReactNode, useMemo } from "react";

export interface DateRangeOption {
  label: string;
  value: string;
  from: string;
  to: string;
}

function getDateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

function buildPresets(): DateRangeOption[] {
  const now = new Date();
  const today = getDateStr(now);

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
  const startOfQuarter = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  const startOfLastQuarter = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 - 3, 1);
  const endOfLastQuarter = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 0);
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const startOfLastYear = new Date(now.getFullYear() - 1, 0, 1);
  const endOfLastYear = new Date(now.getFullYear() - 1, 11, 31);
  const last30 = new Date(now); last30.setDate(last30.getDate() - 30);
  const last90 = new Date(now); last90.setDate(last90.getDate() - 90);
  const last6m = new Date(now); last6m.setMonth(last6m.getMonth() - 6);
  const last12m = new Date(now); last12m.setMonth(last12m.getMonth() - 12);
  // For demo mode, use 2025 dates since mock data is in 2025
  const fy2025start = "2025-01-01";
  const fy2025end = "2025-12-31";

  return [
    { label: "FY 2025", value: "fy2025", from: fy2025start, to: fy2025end },
    { label: "This year", value: "this_year", from: getDateStr(startOfYear), to: today },
    { label: "Last year", value: "last_year", from: getDateStr(startOfLastYear), to: getDateStr(endOfLastYear) },
    { label: "This quarter", value: "this_quarter", from: getDateStr(startOfQuarter), to: today },
    { label: "Last quarter", value: "last_quarter", from: getDateStr(startOfLastQuarter), to: getDateStr(endOfLastQuarter) },
    { label: "This month", value: "this_month", from: getDateStr(startOfMonth), to: today },
    { label: "Last month", value: "last_month", from: getDateStr(startOfLastMonth), to: getDateStr(endOfLastMonth) },
    { label: "Last 30 days", value: "last_30d", from: getDateStr(last30), to: today },
    { label: "Last 90 days", value: "last_90d", from: getDateStr(last90), to: today },
    { label: "Last 6 months", value: "last_6m", from: getDateStr(last6m), to: today },
    { label: "Last 12 months", value: "last_12m", from: getDateStr(last12m), to: today },
    { label: "H1 2025", value: "h1_2025", from: "2025-01-01", to: "2025-06-30" },
    { label: "H2 2025", value: "h2_2025", from: "2025-07-01", to: "2025-12-31" },
    { label: "All time", value: "all", from: "2020-01-01", to: today },
  ];
}

interface DateRangeContextType {
  selectedRange: DateRangeOption;
  setSelectedRange: (range: DateRangeOption) => void;
  presets: DateRangeOption[];
}

const presets = buildPresets();

const DateRangeContext = createContext<DateRangeContextType>({
  selectedRange: presets[0], // FY 2025 default
  setSelectedRange: () => {},
  presets,
});

export function DateRangeProvider({ children }: { children: ReactNode }) {
  const [selectedRange, setSelectedRange] = useState<DateRangeOption>(presets[0]);
  const value = useMemo(() => ({ selectedRange, setSelectedRange, presets }), [selectedRange]);
  return (
    <DateRangeContext.Provider value={value}>
      {children}
    </DateRangeContext.Provider>
  );
}

export function useDateRange() {
  return useContext(DateRangeContext);
}
