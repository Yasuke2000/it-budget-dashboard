import { KPICard } from "@/components/dashboard/kpi-card";
import { BudgetTable } from "@/components/budget/budget-table";
import { ForecastChart } from "@/components/budget/forecast-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getBudgetEntries, getInvoices, getSpendForecast, isDemoMode } from "@/lib/data-source";
import { isITCategory } from "@/lib/constants";
import { formatCurrencyCompact, formatPercent } from "@/lib/utils";
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
      <div>
        <h1 className="text-2xl font-bold text-white">Budget</h1>
        <p className="text-slate-400">
          {hasBudget
            ? `Budget vs actual spend by category — FY ${currentYear}`
            : `IT spend by category — ${currentYear}`}
        </p>
      </div>

      {!hasBudget && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <AlertCircle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-300">
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
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white text-base flex items-center justify-between flex-wrap gap-2">
              <span>12-Month Forecast {forecast.includesPersonnel ? "(incl. internal IT staff)" : "(tools/services)"}</span>
              <span className="text-sm font-normal text-slate-400">
                Next 12 months ≈ <span className="text-amber-300 font-semibold">{formatCurrencyCompact(forecast.annualForecast)}</span>
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ForecastChart points={forecast.points} />
            <p className="text-xs text-slate-500 mt-2">
              {forecast.method}. Each future month is projected from the same calendar month last year, so recurring annual licences (which cluster in Q1) land in the right months — better for cash &amp; budget planning than a flat average. Set per-category budgets in Settings → Budget to track against this.
            </p>
          </CardContent>
        </Card>
      )}

      {hasBudget && (
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

      <BudgetTable entries={entries} hasBudget={hasBudget} year={currentYear} />
    </div>
  );
}
