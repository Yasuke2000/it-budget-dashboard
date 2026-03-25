import { getCostInsights } from "@/lib/data-source";
import type { CostInsight } from "@/lib/cost-insights";
import { KPICard } from "@/components/dashboard/kpi-card";
import { InsightsClient } from "./insights-client";

function formatEur(amount: number): string {
  return new Intl.NumberFormat("en-BE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(amount);
}

// Category labels for display
const CATEGORY_LABELS: Record<CostInsight["category"], string> = {
  license_waste: "License Waste",
  vendor_risk: "Vendor Risk",
  hardware_lifecycle: "Hardware",
  budget_overrun: "Budget Overrun",
  optimization: "Optimization",
  shadow_it: "Shadow IT",
  duplicate_cost: "Duplicate Cost",
};

export default async function InsightsPage() {
  const insights = await getCostInsights();

  const totalSavings = insights.reduce((s, i) => s + i.potentialSavings, 0);
  const criticalCount = insights.filter(i => i.severity === "critical").length;
  const warningCount = insights.filter(i => i.severity === "warning").length;
  const totalCount = insights.length;

  // Savings breakdown by category
  const categoryTotals = insights.reduce<Record<string, number>>((acc, insight) => {
    if (insight.potentialSavings > 0) {
      const label = CATEGORY_LABELS[insight.category];
      acc[label] = (acc[label] ?? 0) + insight.potentialSavings;
    }
    return acc;
  }, {});

  const categorySavings = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Cost Insights</h1>
          <p className="mt-1 text-slate-400">
            Automated cost discovery and optimization recommendations
          </p>
        </div>

        {/* Generate Report stub */}
        <button
          disabled
          className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-400 cursor-not-allowed opacity-60 transition-colors"
          title="PDF export coming soon"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Generate Report
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Potential Annual Savings"
          value={formatEur(totalSavings)}
          iconName="DollarSign"
          description="Across all actionable insights"
          changeType="positive"
        />
        <KPICard
          title="Critical Issues"
          value={String(criticalCount)}
          iconName="AlertTriangle"
          description="Require immediate attention"
          changeType={criticalCount > 0 ? "negative" : "positive"}
        />
        <KPICard
          title="Warnings"
          value={String(warningCount)}
          iconName="Shield"
          description="Should be addressed soon"
          changeType="neutral"
        />
        <KPICard
          title="Insights Found"
          value={String(totalCount)}
          iconName="Lightbulb"
          description="Automated findings from all data sources"
          changeType="neutral"
        />
      </div>

      {/* Savings breakdown summary card */}
      {categorySavings.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="text-sm font-semibold text-white mb-1">Potential Annual Savings Breakdown</h2>
          <p className="text-xs text-slate-500 mb-4">By cost category — actioning all recommendations</p>

          <div className="flex items-end gap-3 mb-6">
            <span className="text-4xl font-bold font-mono text-white">{formatEur(totalSavings)}</span>
            <span className="text-slate-400 text-sm mb-1">/ year</span>
          </div>

          <div className="space-y-3">
            {categorySavings.map(([label, amount]) => {
              const pct = totalSavings > 0 ? (amount / totalSavings) * 100 : 0;
              return (
                <div key={label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300 font-medium">{label}</span>
                    <span className="text-slate-400 font-mono">{formatEur(amount)}</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-teal-500 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Interactive insights list (client component for filter) */}
      <InsightsClient insights={insights} categoryLabels={CATEGORY_LABELS} />
    </div>
  );
}
