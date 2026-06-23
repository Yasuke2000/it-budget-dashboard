import { KPICard } from "@/components/dashboard/kpi-card";
import { BudgetTable } from "@/components/budget/budget-table";
import { getBudgetEntries, getInvoices, isDemoMode } from "@/lib/data-source";
import { isITCategory } from "@/lib/constants";
import { formatCurrencyCompact, formatPercent } from "@/lib/utils";
import { AlertCircle } from "lucide-react";
import type { BudgetEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const company = sp.company || "all";
  const currentYear = new Date().getFullYear();
  const from = sp.from || `${currentYear}-01-01`;
  const to = sp.to || `${currentYear}-12-31`;

  const demo = isDemoMode();
  let entries: BudgetEntry[];

  if (demo) {
    entries = await getBudgetEntries();
  } else {
    // No budget configured — build actual spend from real BC invoices
    const invoices = await getInvoices(company, from, to);
    const actualByKey = new Map<string, number>();
    for (const inv of invoices) {
      if (!isITCategory(inv.costCategory)) continue;
      const month = inv.postingDate?.substring(0, 7);
      if (!month) continue;
      const key = `${inv.costCategory}:${month}`;
      actualByKey.set(key, (actualByKey.get(key) ?? 0) + inv.totalAmountExcludingTax);
    }
    entries = Array.from(actualByKey.entries()).map(([key, actualAmount]) => {
      const sep = key.indexOf(":");
      const category = key.substring(0, sep);
      const month = key.substring(sep + 1);
      return {
        id: key,
        category,
        month,
        budgetAmount: 0,
        actualAmount,
        variance: actualAmount,
        variancePercent: 0,
        companyId: "all",
      };
    });
  }

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
        <p className="text-slate-400">
          {demo
            ? `Budget vs actual spend by category — FY ${currentYear}`
            : `IT spend by category — ${currentYear}`}
        </p>
      </div>

      {!demo && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <AlertCircle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-300">
            No budget configured yet — showing actual IT spend from Business Central only.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KPICard
          title="YTD Actual"
          value={formatCurrencyCompact(ytdActual)}
          iconName="DollarSign"
          description={`Total IT spend ${currentYear}`}
        />
        {demo && (
          <>
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
          </>
        )}
      </div>

      {demo && (
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
      )}

      <BudgetTable entries={entries} hasBudget={demo} year={currentYear} />
    </div>
  );
}
