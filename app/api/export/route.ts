import {
  getDashboardKPIs,
  getLicenses,
  getVendorSummary,
  getCategorySpend,
  getMonthlySpend,
  getContracts,
  getEntitySpend,
  getCostInsights,
  getDevices,
} from "@/lib/data-source";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get("company") || "all";
  const format = searchParams.get("format") || "markdown";

  // Use full date range including current year
  const currentYear = new Date().getFullYear();
  const fullFrom = "2025-01-01";
  const fullTo = `${currentYear}-12-31`;

  const [kpis, licenses, vendors, categories, monthly, contracts, entities, insights, devices] =
    await Promise.all([
      getDashboardKPIs(company, fullFrom, fullTo),
      getLicenses(),
      getVendorSummary(company, fullFrom, fullTo),
      getCategorySpend(company, fullFrom, fullTo),
      getMonthlySpend(company, fullFrom, fullTo),
      getContracts(),
      getEntitySpend(fullFrom, fullTo),
      getCostInsights(),
      getDevices(),
    ]);

  const now = new Date();

  if (format === "json") {
    return Response.json({ kpis, licenses, vendors, categories, monthly, contracts, entities, insights, devices });
  }

  const fmt = (n: number) =>
    new Intl.NumberFormat("nl-BE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

  const fmtFull = (n: number) =>
    new Intl.NumberFormat("nl-BE", { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(n);

  const dateStr = now.toLocaleDateString("nl-BE");

  // Fix contract statuses: compute real status from days left
  const enrichedContracts = contracts.map((c) => {
    const daysLeft = Math.ceil((new Date(c.endDate).getTime() - now.getTime()) / 86400000);
    let realStatus: string;
    if (daysLeft < 0) realStatus = c.autoRenew ? "auto-renewed (past end date)" : "EXPIRED";
    else if (daysLeft <= 90) realStatus = "expiring_soon";
    else realStatus = "active";
    return { ...c, daysLeft, realStatus };
  });

  // License waste summary
  const totalWastedUnits = licenses.filter(l => l.pricePerUser > 0).reduce((s, l) => s + l.wastedUnits, 0);
  const totalMonthlyWaste = licenses.reduce((s, l) => s + l.wastedCost, 0);
  const totalAnnualWaste = totalMonthlyWaste * 12;

  // Device age breakdown
  const devicesByAge = {
    under2: devices.filter(d => d.ageYears < 2).length,
    twoToFour: devices.filter(d => d.ageYears >= 2 && d.ageYears < 4).length,
    fourPlus: devices.filter(d => d.ageYears >= 4).length,
  };
  const complianceRate = devices.length > 0
    ? ((devices.filter(d => d.complianceState === "compliant").length / devices.length) * 100).toFixed(1)
    : "N/A";

  // Data coverage: which months have actual data
  const monthsWithData = monthly.filter(m => m.actual > 0).map(m => m.month);
  const firstMonth = monthsWithData[0] || "N/A";
  const lastMonth = monthsWithData[monthsWithData.length - 1] || "N/A";

  // Total entity spend for % calculation
  const totalEntitySpend = entities.reduce((s, e) => s + e.totalSpend, 0);

  const md = `# IT Finance Status Export
> Generated: ${dateStr} | Currency: EUR | Fiscal Year: Jan–Dec
> Entity scope: ${company === "all" ? "Consolidated (GDI, WHS, GRE, TDR)" : company}
> Data coverage: ${firstMonth} to ${lastMonth} (${monthsWithData.length} months with actuals)
> Data sources: Microsoft Business Central, Microsoft Graph (licenses), Intune (devices)
> Purpose: LLM-ready financial context for IT cost analysis

---

## Executive Summary
- **Total IT Spend YTD:** ${fmt(kpis.totalSpendYTD)} against a budget of ${fmt(kpis.totalBudgetYTD)} (variance: ${kpis.budgetVariancePercent >= 0 ? "+" : ""}${kpis.budgetVariancePercent.toFixed(1)}%)
- **Spend trend:** ${kpis.spendTrend} (${kpis.spendChangePercent >= 0 ? "+" : ""}${kpis.spendChangePercent.toFixed(1)}% vs prior period)
- **License waste:** ${totalWastedUnits} unused paid licenses = ${fmt(totalMonthlyWaste)}/month (${fmt(totalAnnualWaste)}/year)
- **Managed devices:** ${kpis.deviceCount} enrolled in Intune (${complianceRate}% compliant)
- **Contracts requiring action:** ${enrichedContracts.filter(c => c.realStatus === "EXPIRED" || c.realStatus === "expiring_soon").length} (expired or expiring within 90 days)

---

## Key Metrics
| Metric | Value |
|--------|-------|
| Total IT Spend YTD | ${fmt(kpis.totalSpendYTD)} |
| Total Budget YTD | ${fmt(kpis.totalBudgetYTD)} |
| Budget Variance | ${kpis.budgetVariancePercent >= 0 ? "+" : ""}${kpis.budgetVariancePercent.toFixed(1)}% |
| License Utilization | ${kpis.licenseUtilizationPercent.toFixed(1)}% |
| Managed Devices | ${kpis.deviceCount} |
| Spend Trend | ${kpis.spendTrend} (${kpis.spendChangePercent >= 0 ? "+" : ""}${kpis.spendChangePercent.toFixed(1)}%) |
| License Waste (monthly) | ${fmt(totalMonthlyWaste)} |
| License Waste (annual) | ${fmt(totalAnnualWaste)} |

## Entity Breakdown
| Entity | Total Spend | % of Total | Users | IT Cost/User | Avg Monthly |
|--------|-------------|------------|-------|--------------|-------------|
${entities.map((e) => {
  const pct = totalEntitySpend > 0 ? ((e.totalSpend / totalEntitySpend) * 100).toFixed(1) : "0";
  const avgMonthly = monthsWithData.length > 0 ? e.totalSpend / monthsWithData.length : 0;
  return `| ${e.companyName} | ${fmt(e.totalSpend)} | ${pct}% | ${e.userCount} | ${fmt(e.perUserSpend)} | ${fmt(avgMonthly)} |`;
}).join("\n")}
| **Total** | **${fmt(totalEntitySpend)}** | **100%** | **${entities.reduce((s, e) => s + e.userCount, 0)}** | **${fmt(totalEntitySpend / Math.max(entities.reduce((s, e) => s + e.userCount, 0), 1))}** | **${fmt(monthsWithData.length > 0 ? totalEntitySpend / monthsWithData.length : 0)}** |

## Cost Categories (sorted by spend)
| Category | Actual | Budget | Variance | Variance % | Over/Under |
|----------|--------|--------|----------|------------|------------|
${categories.sort((a, b) => b.amount - a.amount).map((c) => `| ${c.category} | ${fmt(c.amount)} | ${fmt(c.budget)} | ${fmt(c.variance)} | ${c.variancePercent >= 0 ? "+" : ""}${c.variancePercent.toFixed(1)}% | ${c.variancePercent > 5 ? "OVER" : c.variancePercent < -20 ? "significantly under" : "on track"} |`).join("\n")}

## Monthly Spend Trend
| Month | Actual | Budget | Delta | Notes |
|-------|--------|--------|-------|-------|
${monthly.map((m) => {
  const delta = m.actual - m.budget;
  const pct = m.budget > 0 ? ((delta / m.budget) * 100).toFixed(1) : "0";
  const note = Math.abs(delta) > m.budget * 0.1 ? (delta > 0 ? "⚠ overspend" : "underspend") : "";
  return `| ${m.month} | ${fmt(m.actual)} | ${fmt(m.budget)} | ${delta >= 0 ? "+" : ""}${fmt(delta)} (${pct}%) | ${note} |`;
}).join("\n")}

## Vendor Analysis
| # | Vendor | YTD Spend | % of Total | Invoices | Categories | Concentration Risk |
|---|--------|-----------|------------|----------|------------|-------------------|
${vendors.map((v, i) => `| ${i + 1} | ${v.vendorName} | ${fmt(v.totalSpend)} | ${v.percentOfTotal.toFixed(1)}% | ${v.invoiceCount} | ${v.categories.join(", ")} | ${v.isConcentrationRisk ? "⚠ YES (>30%)" : "No"} |`).join("\n")}

## License Inventory (paid licenses only)
| SKU | Purchased | Assigned | Unused | Utilization | Price/User/mo | Monthly Cost | Monthly Waste | Annual Waste |
|-----|-----------|----------|--------|-------------|---------------|-------------|---------------|--------------|
${licenses.filter((l) => l.pricePerUser > 0).map((l) => {
  const util = l.prepaidUnits > 0 ? ((l.consumedUnits / l.prepaidUnits) * 100).toFixed(0) : "0";
  return `| ${l.displayName} | ${l.prepaidUnits} | ${l.consumedUnits} | ${l.wastedUnits} | ${util}% | ${fmtFull(l.pricePerUser)} | ${fmt(l.monthlyCost)} | ${fmt(l.wastedCost)} | ${fmt(l.wastedCost * 12)} |`;
}).join("\n")}

**Total license waste: ${fmt(totalMonthlyWaste)}/month = ${fmt(totalAnnualWaste)}/year**

## Contracts & Renewals
| Vendor | Description | Start | End | Days Left | Annual Cost | Billing | Status | Renewal | Notice Period |
|--------|-------------|-------|-----|-----------|-------------|---------|--------|---------|---------------|
${enrichedContracts.sort((a, b) => a.daysLeft - b.daysLeft).map((c) => `| ${c.vendor} | ${c.description} | ${c.startDate} | ${c.endDate} | ${c.daysLeft} | ${fmt(c.annualCost)} | ${c.billingCycle} | ${c.realStatus} | ${c.autoRenew ? "Auto" : "Manual"} | ${c.noticePeriodDays}d |`).join("\n")}

**Total annual contract commitment: ${fmt(enrichedContracts.filter(c => c.realStatus !== "EXPIRED").reduce((s, c) => s + c.annualCost, 0))}**

## Device Fleet
| Metric | Value |
|--------|-------|
| Total enrolled | ${devices.length} |
| Compliant | ${devices.filter(d => d.complianceState === "compliant").length} (${complianceRate}%) |
| Non-compliant | ${devices.filter(d => d.complianceState === "noncompliant").length} |
| < 2 years old | ${devicesByAge.under2} |
| 2–4 years old | ${devicesByAge.twoToFour} |
| > 4 years old (refresh candidates) | ${devicesByAge.fourPlus} |
| Company-owned | ${devices.filter(d => d.managedDeviceOwnerType === "company").length} |
| Personal (BYOD) | ${devices.filter(d => d.managedDeviceOwnerType === "personal").length} |

## AI-Generated Insights (pre-computed)
${insights.sort((a, b) => {
  const sev = { critical: 0, warning: 1, info: 2 };
  return (sev[a.severity] ?? 2) - (sev[b.severity] ?? 2);
}).map((i) => `### ${i.severity === "critical" ? "🔴" : i.severity === "warning" ? "🟡" : "🔵"} ${i.title}
- **Category:** ${i.category} | **Severity:** ${i.severity}
- **Detail:** ${i.description}
- **Potential savings:** ${fmt(i.potentialSavings)}/year
- **Recommended action:** ${i.action}
`).join("\n")}

---
*Export generated by IT Finance Dashboard — it-budget-dashboard.vercel.app*
`;

  return new Response(md, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="it-finance-status-${now.toISOString().split("T")[0]}.md"`,
    },
  });
}
