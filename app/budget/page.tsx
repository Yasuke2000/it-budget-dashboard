import { KPICard } from "@/components/dashboard/kpi-card";
import { BudgetTable } from "@/components/budget/budget-table";
import { getBudgetEntries } from "@/lib/data-source";
import { formatCurrencyCompact, formatPercent } from "@/lib/utils";

export default async function BudgetPage() {
  const entries = await getBudgetEntries();

  const ytdActual = entries.reduce((s, e) => s + e.actualAmount, 0);
  const ytdBudget = entries.reduce((s, e) => s + e.budgetAmount, 0);
  const overallVariancePct = ytdBudget > 0 ? ((ytdActual - ytdBudget) / ytdBudget) * 100 : 0;

  const varianceChangeType =
    Math.abs(overallVariancePct) <= 5
      ? "positive"
      : Math.abs(overallVariancePct) <= 10
      ? "neutral"
      : "negative";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Budget</h1>
        <p className="text-slate-400">Budget vs actual spend by category — FY 2025</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KPICard
          title="YTD Actual"
          value={formatCurrencyCompact(ytdActual)}
          iconName="DollarSign"
          description="Total actual spend year-to-date"
        />
        <KPICard
          title="YTD Budget"
          value={formatCurrencyCompact(ytdBudget)}
          iconName="BarChart2"
          description="Total budget year-to-date"
        />
        <KPICard
          title="Overall Variance"
          value={formatPercent(overallVariancePct)}
          changeType={varianceChangeType}
          change={
            overallVariancePct > 0
              ? `€${((ytdActual - ytdBudget) / 1000).toFixed(1)}K over budget`
              : `€${((ytdBudget - ytdActual) / 1000).toFixed(1)}K under budget`
          }
          iconName="TrendingUp"
          description="vs full-year budget"
        />
      </div>

      <div className="flex items-center gap-6 px-1">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
          Variance legend
        </p>
        <span className="flex items-center gap-1.5 text-xs text-emerald-400">
          <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" />
          {"<5% — On track"}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-amber-400">
          <span className="h-2 w-2 rounded-full bg-amber-500 inline-block" />
          5–10% — Watch
        </span>
        <span className="flex items-center gap-1.5 text-xs text-red-400">
          <span className="h-2 w-2 rounded-full bg-red-500 inline-block" />
          {">10% — Over budget"}
        </span>
        <span className="text-xs text-slate-600 ml-auto italic">
          Each cell shows actual (top) / budget (bottom)
        </span>
      </div>

      <BudgetTable entries={entries} />
    </div>
  );
}
