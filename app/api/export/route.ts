import {
  getDashboardKPIs,
  getLicenses,
  getVendorSummary,
  getCategorySpend,
  getMonthlySpend,
  getContracts,
} from "@/lib/data-source";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get("company") || "all";
  const format = searchParams.get("format") || "markdown";

  const [kpis, licenses, vendors, categories, monthly, contracts] =
    await Promise.all([
      getDashboardKPIs(company),
      getLicenses(),
      getVendorSummary(company),
      getCategorySpend(company),
      getMonthlySpend(company),
      getContracts(),
    ]);

  const fmt = (n: number) =>
    new Intl.NumberFormat("nl-BE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

  const now = new Date();
  const dateStr = now.toLocaleDateString("nl-BE");

  if (format === "json") {
    return Response.json({ kpis, licenses, vendors, categories, monthly, contracts });
  }

  // Markdown format — optimized for LLM context
  const md = `# IT Finance Status — ${dateStr}
Company: ${company === "all" ? "All entities (GDI, WHS, GRE, TDR)" : company}

## Key Metrics
| Metric | Value |
|--------|-------|
| Total IT Spend YTD | ${fmt(kpis.totalSpendYTD)} |
| Total Budget YTD | ${fmt(kpis.totalBudgetYTD)} |
| Budget Variance | ${kpis.budgetVariancePercent >= 0 ? "+" : ""}${kpis.budgetVariancePercent.toFixed(1)}% |
| License Utilization | ${kpis.licenseUtilizationPercent.toFixed(1)}% |
| Managed Devices | ${kpis.deviceCount} |
| Spend Trend | ${kpis.spendTrend} (${kpis.spendChangePercent >= 0 ? "+" : ""}${kpis.spendChangePercent.toFixed(1)}%) |

## Cost Categories
| Category | Actual | Budget | Variance |
|----------|--------|--------|----------|
${categories.map((c) => `| ${c.category} | ${fmt(c.amount)} | ${fmt(c.budget)} | ${c.variancePercent >= 0 ? "+" : ""}${c.variancePercent.toFixed(1)}% |`).join("\n")}

## Monthly Spend Trend
| Month | Actual | Budget |
|-------|--------|--------|
${monthly.map((m) => `| ${m.month} | ${fmt(m.actual)} | ${fmt(m.budget)} |`).join("\n")}

## Top Vendors
| Vendor | YTD Spend | % of Total | Invoices | Concentration Risk |
|--------|-----------|------------|----------|-------------------|
${vendors.slice(0, 15).map((v) => `| ${v.vendorName} | ${fmt(v.totalSpend)} | ${v.percentOfTotal.toFixed(1)}% | ${v.invoiceCount} | ${v.isConcentrationRisk ? "YES" : "No"} |`).join("\n")}

## Licenses (paid)
| SKU | Purchased | Used | Unused | Price/User/mo | Monthly Waste |
|-----|-----------|------|--------|---------------|---------------|
${licenses.filter((l) => l.pricePerUser > 0).map((l) => `| ${l.displayName} | ${l.prepaidUnits} | ${l.consumedUnits} | ${l.wastedUnits} | ${fmt(l.pricePerUser)} | ${fmt(l.wastedCost)} |`).join("\n")}

## Contracts
| Vendor | Description | End Date | Days Left | Annual Cost | Status | Auto-Renew |
|--------|-------------|----------|-----------|-------------|--------|------------|
${contracts.map((c) => {
  const daysLeft = Math.ceil((new Date(c.endDate).getTime() - now.getTime()) / 86400000);
  return `| ${c.vendor} | ${c.description} | ${c.endDate} | ${daysLeft} | ${fmt(c.annualCost)} | ${c.status} | ${c.autoRenew ? "Yes" : "No"} |`;
}).join("\n")}
`;

  return new Response(md, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="it-finance-status-${now.toISOString().split("T")[0]}.md"`,
    },
  });
}
