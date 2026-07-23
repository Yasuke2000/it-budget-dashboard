"use client";

import { useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatCurrency, getMonthName, getVarianceStatus } from "@/lib/utils";
import { VarianceIndicator } from "./variance-indicator";
import type { BudgetEntry } from "@/lib/types";

interface BudgetTableProps {
  entries: BudgetEntry[];
  hasBudget?: boolean;
  year?: number;
}

type ViewMode = "monthly" | "ytd";

interface CellData {
  actual: number;
  budget: number;
  variance: number;
  variancePercent: number;
}

function buildCategoryMonthMap(entries: BudgetEntry[]): Map<string, Map<string, CellData>> {
  const map = new Map<string, Map<string, CellData>>();
  for (const entry of entries) {
    if (!map.has(entry.category)) {
      map.set(entry.category, new Map());
    }
    map.get(entry.category)!.set(entry.month, {
      actual: entry.actualAmount,
      budget: entry.budgetAmount,
      variance: entry.variance,
      variancePercent: entry.variancePercent,
    });
  }
  return map;
}

function buildCumulativeData(
  categoryMonthMap: Map<string, Map<string, CellData>>,
  months: string[]
): Map<string, Map<string, CellData>> {
  const cumMap = new Map<string, Map<string, CellData>>();
  for (const [cat, monthMap] of categoryMonthMap) {
    const cumMonthMap = new Map<string, CellData>();
    let cumActual = 0;
    let cumBudget = 0;
    for (const month of months) {
      const d = monthMap.get(month);
      if (d) {
        cumActual += d.actual;
        cumBudget += d.budget;
      }
      const cumVariance = cumActual - cumBudget;
      const cumVariancePercent = cumBudget > 0 ? (cumVariance / cumBudget) * 100 : 0;
      cumMonthMap.set(month, {
        actual: cumActual,
        budget: cumBudget,
        variance: cumVariance,
        variancePercent: cumVariancePercent,
      });
    }
    cumMap.set(cat, cumMonthMap);
  }
  return cumMap;
}

function cellBgClass(variancePercent: number, hasData: boolean): string {
  if (!hasData) return "";
  const status = getVarianceStatus(variancePercent);
  if (status === "green") return "bg-positive/10";
  if (status === "amber") return "bg-warning/10";
  return "bg-negative/10";
}

export function BudgetTable({ entries, hasBudget = true, year }: BudgetTableProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("monthly");

  const displayYear = year ?? new Date().getFullYear();
  const MONTHS = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const m = (i + 1).toString().padStart(2, "0");
        return `${displayYear}-${m}`;
      }),
    [displayYear]
  );

  const categoryMonthMap = useMemo(() => buildCategoryMonthMap(entries), [entries]);
  const cumulativeMap = useMemo(
    () => buildCumulativeData(categoryMonthMap, MONTHS),
    [categoryMonthMap, MONTHS]
  );

  const activeMap = viewMode === "monthly" ? categoryMonthMap : cumulativeMap;
  const categories = useMemo(() => Array.from(categoryMonthMap.keys()).sort(), [categoryMonthMap]);

  const ytdPerCategory = useMemo(() => {
    const result = new Map<string, CellData>();
    for (const [cat, monthMap] of categoryMonthMap) {
      let actual = 0;
      let budget = 0;
      for (const d of monthMap.values()) {
        actual += d.actual;
        budget += d.budget;
      }
      const variance = actual - budget;
      result.set(cat, {
        actual,
        budget,
        variance,
        variancePercent: budget > 0 ? (variance / budget) * 100 : 0,
      });
    }
    return result;
  }, [categoryMonthMap]);

  const totalsPerMonth = useMemo(() => {
    return MONTHS.map((month) => {
      let actual = 0;
      let budget = 0;
      for (const monthMap of activeMap.values()) {
        const d = monthMap.get(month);
        if (d) {
          actual += d.actual;
          budget += d.budget;
        }
      }
      const variance = actual - budget;
      return {
        month,
        actual,
        budget,
        variance,
        variancePercent: budget > 0 ? (variance / budget) * 100 : 0,
      };
    });
  }, [activeMap, MONTHS]);

  const grandTotal = useMemo(() => {
    let actual = 0;
    let budget = 0;
    for (const d of ytdPerCategory.values()) {
      actual += d.actual;
      budget += d.budget;
    }
    const variance = actual - budget;
    return { actual, budget, variance, variancePercent: budget > 0 ? (variance / budget) * 100 : 0 };
  }, [ytdPerCategory]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <CardTitle className="text-foreground">
          {hasBudget ? "Budget vs Actual" : "Actual Spend by Category"}
        </CardTitle>
        {hasBudget && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setViewMode("monthly")}
              className={cn(
                "border-border text-foreground hover:text-foreground hover:bg-accent",
                viewMode === "monthly" && "bg-muted text-foreground border-border-strong"
              )}
            >
              Monthly
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setViewMode("ytd")}
              className={cn(
                "border-border text-foreground hover:text-foreground hover:bg-accent",
                viewMode === "ytd" && "bg-muted text-foreground border-border-strong"
              )}
            >
              YTD Cumulative
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground font-semibold sticky left-0 bg-card z-10 min-w-[180px] pl-6">
                Category
              </TableHead>
              {MONTHS.map((month) => (
                <TableHead
                  key={month}
                  className="text-muted-foreground font-semibold text-center min-w-[90px] px-1"
                >
                  {getMonthName(month)}
                </TableHead>
              ))}
              <TableHead className="text-muted-foreground font-semibold text-center min-w-[110px] pr-6">
                YTD Total
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.map((category) => {
              const monthMap = activeMap.get(category)!;
              const ytd = ytdPerCategory.get(category)!;
              return (
                <TableRow key={category} className="border-border/50 hover:bg-accent">
                  <TableCell className="sticky left-0 bg-card z-10 pl-6 py-2">
                    <span className="text-sm font-medium text-foreground">{category}</span>
                  </TableCell>
                  {MONTHS.map((month) => {
                    const d = monthMap.get(month);
                    const hasData = !!d && d.actual > 0;
                    return (
                      <TableCell
                        key={month}
                        className={cn(
                          "text-center px-1 py-2",
                          hasBudget && hasData && d && cellBgClass(d.variancePercent, true)
                        )}
                      >
                        {hasData ? (
                          <div className="flex flex-col items-center leading-tight">
                            <span className="text-xs font-mono text-foreground tabular-nums">
                              {d!.actual >= 1000
                                ? `€${(d!.actual / 1000).toFixed(1)}K`
                                : `€${d!.actual.toFixed(0)}`}
                            </span>
                            {hasBudget && (
                              <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
                                {d!.budget >= 1000
                                  ? `€${(d!.budget / 1000).toFixed(1)}K`
                                  : `€${d!.budget.toFixed(0)}`}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground/70 text-xs">—</span>
                        )}
                      </TableCell>
                    );
                  })}
                  <TableCell
                    className={cn(
                      "text-center pr-6 py-2",
                      hasBudget && cellBgClass(ytd.variancePercent, true)
                    )}
                  >
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-xs font-mono font-semibold text-foreground tabular-nums">
                        {formatCurrency(ytd.actual)}
                      </span>
                      {hasBudget && (
                        <>
                          <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
                            {formatCurrency(ytd.budget)}
                          </span>
                          <VarianceIndicator variancePercent={ytd.variancePercent} />
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}

            {/* Totals row */}
            <TableRow className="border-t-2 border-border hover:bg-accent bg-muted/50">
              <TableCell className="sticky left-0 bg-muted z-10 pl-6 py-3">
                <span className="text-sm font-bold text-foreground">Total</span>
              </TableCell>
              {totalsPerMonth.map(({ month, actual, budget, variancePercent }) => {
                const hasData = actual > 0 || budget > 0;
                return (
                  <TableCell
                    key={month}
                    className={cn(
                      "text-center px-1 py-3",
                      hasBudget && hasData && cellBgClass(variancePercent, true)
                    )}
                  >
                    {hasData ? (
                      <div className="flex flex-col items-center leading-tight">
                        <span className="text-xs font-mono font-bold text-foreground tabular-nums">
                          {actual >= 1000
                            ? `€${(actual / 1000).toFixed(1)}K`
                            : `€${actual.toFixed(0)}`}
                        </span>
                        {hasBudget && (
                          <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
                            {budget >= 1000
                              ? `€${(budget / 1000).toFixed(1)}K`
                              : `€${budget.toFixed(0)}`}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground/70 text-xs">—</span>
                    )}
                  </TableCell>
                );
              })}
              <TableCell
                className={cn(
                  "text-center pr-6 py-3",
                  hasBudget && cellBgClass(grandTotal.variancePercent, true)
                )}
              >
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-xs font-mono font-bold text-foreground tabular-nums">
                    {formatCurrency(grandTotal.actual)}
                  </span>
                  {hasBudget && (
                    <>
                      <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
                        {formatCurrency(grandTotal.budget)}
                      </span>
                      <VarianceIndicator variancePercent={grandTotal.variancePercent} />
                    </>
                  )}
                </div>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
