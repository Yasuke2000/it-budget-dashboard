import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import {
  getDashboardKPIs,
  getLicenses,
  getVendorSummary,
  getCategorySpend,
  getContracts,
} from "@/lib/data-source";

export async function POST(req: Request) {
  const { messages } = await req.json();

  // Demo mode: return canned responses when no API key is configured
  if (!process.env.ANTHROPIC_API_KEY) {
    const q =
      messages[messages.length - 1]?.content?.toLowerCase() || "";
    let response: string;

    if (q.includes("license") || q.includes("licentie")) {
      response =
        "Based on the data, you have 46 unused paid licenses costing \u20AC589.60/month (\u20AC7,075/year). The biggest waste is in M365 Business Premium (18 unused at \u20AC20.60/user) and Entra ID P1 (19 unused at \u20AC6.00/user). I recommend a license reclamation review with HR.";
    } else if (q.includes("vendor") || q.includes("easi")) {
      response =
        "EASI is your largest vendor at \u20AC42,365 YTD (29.1% of total spend). Microsoft is at 30.4% \u2014 above the 30% concentration threshold. Consider negotiating multi-year pricing.";
    } else if (q.includes("budget")) {
      response =
        "Overall budget variance is +0.1% (\u20AC172.6K actual vs \u20AC172.5K budget). Hardware Purchases is the biggest overspend at +22.0%. Software & Licenses is well-controlled at +0.6%.";
    } else if (
      q.includes("bespar") ||
      q.includes("saving") ||
      q.includes("optim") ||
      q.includes("cost") ||
      q.includes("cut")
    ) {
      response =
        "Top savings opportunities: 1) License reclamation: \u20AC7,075/year, 2) E5\u2192E3 downgrade for non-power users: \u20AC504/year, 3) Consolidate hardware vendors. Total addressable savings: ~\u20AC10,000/year.";
    } else if (
      q.includes("contract") ||
      q.includes("expir") ||
      q.includes("renew")
    ) {
      response =
        "You have 2 contracts expiring within 90 days: Sectigo SSL certificates (45 days, \u20AC180/yr \u2014 manual renewal required) and Dell ProSupport (48 days, \u20AC900/yr). Both need action soon. Total annual commitment across 20 contracts is \u20AC143,910.";
    } else {
      response =
        "I can analyze your IT spending data. Try asking about license waste, vendor concentration, budget variance, contract renewals, or savings opportunities.";
    }

    return Response.json({ role: "assistant", content: response });
  }

  // Live mode: stream response using the Anthropic model
  const context = await buildDashboardContext();

  const result = streamText({
    model: anthropic("claude-sonnet-4-20250514"),
    system: `You are an IT Finance Analyst for a Belgian logistics company (4 entities: GDI, WHS, GRE, TDR). Answer questions using ONLY the data below. Be specific with EUR amounts. Keep answers concise (max 200 words). If asked about something not in the data, say so.\n\n${context}`,
    messages,
    maxOutputTokens: 500,
  });

  return result.toTextStreamResponse();
}

async function buildDashboardContext(): Promise<string> {
  const [kpis, licenses, vendors, categories, contracts] = await Promise.all([
    getDashboardKPIs(),
    getLicenses(),
    getVendorSummary(),
    getCategorySpend(),
    getContracts(),
  ]);

  const lines: string[] = [];

  // KPIs
  lines.push("## Dashboard KPIs");
  lines.push(`Total Spend YTD: \u20AC${kpis.totalSpendYTD.toFixed(2)}`);
  lines.push(`Budget YTD: \u20AC${kpis.totalBudgetYTD.toFixed(2)}`);
  lines.push(`Actual YTD: \u20AC${kpis.totalActualYTD.toFixed(2)}`);
  lines.push(
    `Budget Variance: ${kpis.budgetVariancePercent >= 0 ? "+" : ""}${kpis.budgetVariancePercent.toFixed(1)}%`
  );
  lines.push(
    `License Utilization: ${kpis.licenseUtilizationPercent.toFixed(1)}%`
  );
  lines.push(`Device Count: ${kpis.deviceCount}`);
  lines.push(
    `Spend Trend: ${kpis.spendTrend} (${kpis.spendChangePercent >= 0 ? "+" : ""}${kpis.spendChangePercent.toFixed(1)}%)`
  );
  lines.push("");

  // Licenses
  lines.push("## Licenses");
  lines.push(
    "| Name | Prepaid | Used | Wasted | Price/User | Wasted Cost/mo |"
  );
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const l of licenses) {
    lines.push(
      `| ${l.displayName} | ${l.prepaidUnits} | ${l.consumedUnits} | ${l.wastedUnits} | \u20AC${l.pricePerUser.toFixed(2)} | \u20AC${l.wastedCost.toFixed(2)} |`
    );
  }
  lines.push("");

  // Vendors
  lines.push("## Top Vendors");
  lines.push("| Vendor | Spend | % of Total | Concentration Risk |");
  lines.push("| --- | --- | --- | --- |");
  for (const v of vendors.slice(0, 10)) {
    lines.push(
      `| ${v.vendorName} | \u20AC${v.totalSpend.toFixed(2)} | ${v.percentOfTotal.toFixed(1)}% | ${v.isConcentrationRisk ? "YES" : "No"} |`
    );
  }
  lines.push("");

  // Categories
  lines.push("## Spending by Category");
  lines.push("| Category | Actual | Budget | Variance % |");
  lines.push("| --- | --- | --- | --- |");
  for (const c of categories) {
    lines.push(
      `| ${c.category} | \u20AC${c.amount.toFixed(2)} | \u20AC${c.budget.toFixed(2)} | ${c.variancePercent >= 0 ? "+" : ""}${c.variancePercent.toFixed(1)}% |`
    );
  }
  lines.push("");

  // Contracts
  lines.push("## Contracts");
  lines.push(
    "| Vendor | Description | End Date | Renewal | Annual Cost | Status |"
  );
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const ct of contracts) {
    lines.push(
      `| ${ct.vendor} | ${ct.description} | ${ct.endDate} | ${ct.renewalType} | \u20AC${ct.annualCost.toFixed(2)} | ${ct.status} |`
    );
  }

  return lines.join("\n");
}
