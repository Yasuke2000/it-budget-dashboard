import { KPICard } from "@/components/dashboard/kpi-card";
import { BudgetTable } from "@/components/budget/budget-table";
import { ForecastPanel } from "@/components/budget/forecast-panel";
import { getBudgetEntries, getInvoices, getSpendForecast, isDemoMode } from "@/lib/data-source";
import { isITCategory } from "@/lib/constants";
import { formatCurrencyCompact, formatPercent } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-header";
import { AlertCircle } from "lucide-react";
import type { BudgetEntry, SpendForecast } from "@/lib/types";

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
  const forecast: SpendForecast | null = await getSpendForecast(company).catch(() => null);

  if (demo) {
    entries = await getBudgetEntries();
  } else {
    // Actual spend from real BC invoices, overlaid with any configured budget
    // (Settings → Budget). Budget-only categories still show (actual 0).
    const [invoices, budgetEntries] = await Promise.all([
      getInvoices(company, from, to),
      getBudgetEntries(company),
    ]);
    const budgetByKey = new Map<string, number>();
    for (const b of budgetEntries) budgetByKey.set(`${b.category}:${b.month}`, b.budgetAmount);
    const actualByKey = new Map<string, number>();
    for (const inv of invoices) {
      if (!isITCategory(inv.costCategory)) continue;
      const month = inv.postingDate?.substring(0, 7);
      if (!month) continue;
      const key = `${inv.costCategory}:${month}`;
      actualByKey.set(key, (actualByKey.get(key) ?? 0) + inv.totalAmountExcludingTax);
    }
    const keys = new Set<string>([...actualByKey.keys(), ...budgetByKey.keys()]);
    entries = Array.from(keys).map((key) => {
      const sep = key.indexOf(":");
      const category = key.substring(0, sep);
      const month = key.substring(sep + 1);
      const actualAmount = actualByKey.get(key) ?? 0;
      const budgetAmount = budgetByKey.get(key) ?? 0;
      const variance = actualAmount - budgetAmount;
      return {
        id: key,
        category,
        month,
        budgetAmount,
        actualAmount,
        variance,
        variancePercent: budgetAmount > 0 ? (variance / budgetAmount) * 100 : 0,
        companyId: "all",
      };
    });
  }

  // Budget columns/variance show when a budget is actually configured.
  const hasBudget = entries.some((e) => e.budgetAmount > 0);
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
      <PageHeader
        title="Budget"
        description={
          hasBudget
            ? `Budget vs actual spend by category — FY ${currentYear}`
            : `IT spend by category — ${currentYear}`
        }
      />

      {!hasBudget && (
        <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3">
          <AlertCircle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
          <p className="text-sm text-warning">
            No budget configured yet — showing actual IT spend only. Set per-category budgets in
            Settings → Budget to see variance.
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
        {hasBudget && (
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

      {forecast && forecast.points.length > 1 && (
        <ForecastPanel company={company} initial={forecast} />
      )}

      {hasBudget && (
        <div className="flex items-center gap-6 px-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Variance legend
          </p>
          <span className="flex items-center gap-1.5 text-xs text-positive">
            <span className="h-2 w-2 rounded-full bg-positive inline-block" />
            {"<5% — On track"}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-warning">
            <span className="h-2 w-2 rounded-full bg-warning inline-block" />
            5–10% — Watch
          </span>
          <span className="flex items-center gap-1.5 text-xs text-negative">
            <span className="h-2 w-2 rounded-full bg-negative inline-block" />
            {">10% — Over budget"}
          </span>
          <span className="text-xs text-muted-foreground/70 ml-auto italic">
            Each cell shows actual (top) / budget (bottom)
          </span>
        </div>
      )}

      <BudgetTable entries={entries} hasBudget={hasBudget} year={currentYear} />
    </div>
  );
}
