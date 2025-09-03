import { KPICard } from "@/components/dashboard/kpi-card";
import { SpendTrendChart } from "@/components/dashboard/spend-trend-chart";
import { EntityComparison } from "@/components/dashboard/entity-comparison";
import { TopVendors } from "@/components/dashboard/top-vendors";
import { CategoryBreakdown } from "@/components/dashboard/category-breakdown";
import {
  getDashboardKPIs,
  getMonthlySpend,
  getEntitySpend,
  getVendorSummary,
  getCategorySpend,
} from "@/lib/data-source";
import { formatCurrencyCompact, formatPercent } from "@/lib/utils";

export default async function OverviewPage() {
  const [kpis, monthlySpend, entitySpend, vendors, categories] = await Promise.all([
    getDashboardKPIs(),
    getMonthlySpend(),
    getEntitySpend(),
    getVendorSummary(),
    getCategorySpend(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Overview</h1>
        <p className="text-slate-400">IT spend across all entities — FY 2025</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total IT Spend (YTD)"
          value={formatCurrencyCompact(kpis.totalSpendYTD)}
          change={formatPercent(kpis.spendChangePercent)}
          changeType={kpis.spendTrend === "up" ? "negative" : kpis.spendTrend === "down" ? "positive" : "neutral"}
          iconName="DollarSign"
          description="vs previous quarter"
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
      <SpendTrendChart data={monthlySpend} />

      {/* Bottom row: Entity comparison + Category breakdown + Top vendors */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <EntityComparison data={entitySpend} />
        <CategoryBreakdown data={categories} />
        <TopVendors vendors={vendors} />
      </div>
    </div>
  );
}
