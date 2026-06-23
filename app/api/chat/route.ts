import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import {
  getDashboardKPIs,
  getLicenses,
  getVendorSummary,
  getCategorySpend,
  getContracts,
} from "@/lib/data-source";

export async function POST(req: Request) {
  const { messages } = await req.json();

  // No API key configured \u2192 say so plainly. We must NEVER return invented figures
  // (the old canned replies showed stale/fake numbers that contradict the live
  // dashboard \u2014 dangerous in front of finance).
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return Response.json({
      role: "assistant",
      content:
        "The AI assistant isn't configured yet (no Gemini API key set on this environment). All figures are available on the dashboard pages and via the Export button \u2014 I just can't answer free-text questions until the key is added.",
    });
  }

  // Live mode: generate response using Gemini
  try {
    const context = await buildDashboardContext();

    const result = await generateText({
      model: google("gemini-2.5-flash"),
      system: `You are an IT Finance Analyst for a Belgian transport & logistics group. Answer questions using ONLY the data below. Be specific with EUR amounts. Keep answers concise (max 200 words). If asked about something not in the data, say so.\n\n${context}`,
      messages,
    });

    return Response.json({ role: "assistant", content: result.text });
  } catch (err) {
    console.error("Gemini API error:", err);
    return Response.json({
      role: "assistant",
      content: "AI is temporarily unavailable. The Gemini API returned an error. The dashboard data is still accessible via the Export button.",
    });
  }
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
