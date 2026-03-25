"use client";

import { useState, useEffect } from "react";
import { KPICard } from "@/components/dashboard/kpi-card";
import { SpendTrendChart } from "@/components/dashboard/spend-trend-chart";
import { EntityComparison } from "@/components/dashboard/entity-comparison";
import { TopVendors } from "@/components/dashboard/top-vendors";
import { CategoryBreakdown } from "@/components/dashboard/category-breakdown";
import { useDateRange } from "@/components/layout/date-range-context";
import { useCompany } from "@/components/layout/company-context";
import { formatCurrencyCompact, formatPercent } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardKPIs, MonthlySpend, EntitySpend, VendorSummary, CategorySpend } from "@/lib/types";

export default function OverviewPage() {
  const { selectedRange } = useDateRange();
  const { selectedCompany } = useCompany();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{
    kpis: DashboardKPIs;
    monthly: MonthlySpend[];
    entities: EntitySpend[];
    vendors: VendorSummary[];
    categories: CategorySpend[];
  } | null>(null);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({
      company: selectedCompany,
      dateFrom: selectedRange.from,
      dateTo: selectedRange.to,
    });
    fetch(`/api/dashboard?${params}`)
      .then((res) => res.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [selectedRange, selectedCompany]);

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Overview</h1>
          <p className="text-slate-400">Loading dashboard data...</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-28 bg-slate-800 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-[400px] bg-slate-800 rounded-xl" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-[300px] bg-slate-800 rounded-xl" />
          <Skeleton className="h-[300px] bg-slate-800 rounded-xl" />
        </div>
      </div>
    );
  }

  const { kpis, monthly, entities, vendors, categories } = data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Overview</h1>
        <p className="text-slate-400">
          IT spend across all entities — {selectedRange.label}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total IT Spend"
          value={formatCurrencyCompact(kpis.totalSpendYTD)}
          change={formatPercent(kpis.spendChangePercent)}
          changeType={kpis.spendTrend === "up" ? "negative" : kpis.spendTrend === "down" ? "positive" : "neutral"}
          iconName="DollarSign"
          description={selectedRange.label}
        />
        <KPICard
          title="Budget Variance"
          value={formatPercent(kpis.budgetVariancePercent)}
          changeType={Math.abs(kpis.budgetVariancePercent) <= 5 ? "positive" : Math.abs(kpis.budgetVariancePercent) <= 10 ? "neutral" : "negative"}
          iconName="TrendingUp"
          description={`Budget: ${formatCurrencyCompact(kpis.totalBudgetYTD)}`}
        />
        <KPICard
          title="License Utilization"
          value={`${kpis.licenseUtilizationPercent.toFixed(1)}%`}
          changeType={kpis.licenseUtilizationPercent >= 90 ? "positive" : kpis.licenseUtilizationPercent >= 70 ? "neutral" : "negative"}
          iconName="Key"
          description="Paid licenses only"
        />
        <KPICard
          title="Managed Devices"
          value={kpis.deviceCount.toString()}
          iconName="Monitor"
          description="Enrolled in Intune"
        />
      </div>

      {/* Spend Trend */}
      <SpendTrendChart data={monthly} />

      {/* Category breakdown — full width */}
      <CategoryBreakdown data={categories} />

      {/* Entity comparison + Top vendors */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <EntityComparison data={entities} />
        <TopVendors vendors={vendors} />
      </div>
    </div>
  );
}
