import { NextResponse } from "next/server";
import { getInvoices } from "@/lib/data-source";
import { getContractsStored } from "@/lib/contract-store";
import { isITCategory } from "@/lib/constants";

export const dynamic = "force-dynamic";

// Auto-discover de-facto contracts/subscriptions from spend: any IT vendor that
// bills across several distinct months is almost certainly a recurring contract.
// Returns suggestions (not saved) the user can review and add with one click.

function normalizeVendor(name: string): string {
  return (name || "")
    .replace(/\b(nv|sa|bv|bvba|vof|gmbh|ltd|inc|comm\.? ?v|scrl|sprl|cvba)\b\.?/gi, "")
    .replace(/\(.*?\)/g, "")
    .replace(/[*.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Map the dashboard cost category → a contract category.
function toContractCategory(itCategory: string): string {
  switch (itCategory) {
    case "Telecom": return "saas";
    case "External IT Services": return "support";
    case "Hardware (Purchases)": return "license";
    case "Cloud & Hosting": return "infrastructure";
    default: return "license"; // Software & Licenses, etc.
  }
}

export async function GET() {
  // Last 12 full months.
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const fromDate = new Date(now);
  fromDate.setMonth(fromDate.getMonth() - 12);
  const from = fromDate.toISOString().slice(0, 10);

  let invoices;
  try {
    invoices = await getInvoices("all", from, to);
  } catch {
    return NextResponse.json({ suggestions: [], error: "Could not load spend" }, { status: 200 });
  }

  // Group IT-category spend by normalised vendor.
  const byVendor = new Map<string, { display: string; net: number; months: Set<string>; category: Record<string, number> }>();
  for (const inv of invoices) {
    if (!isITCategory(inv.costCategory)) continue;
    const norm = normalizeVendor(inv.vendorName).toLowerCase();
    if (!norm || norm.length < 3) continue;
    const month = (inv.postingDate || "").slice(0, 7);
    const g = byVendor.get(norm) || { display: normalizeVendor(inv.vendorName), net: 0, months: new Set<string>(), category: {} };
    g.net += inv.totalAmountExcludingTax || 0;
    if (month) g.months.add(month);
    g.category[inv.costCategory] = (g.category[inv.costCategory] || 0) + (inv.totalAmountExcludingTax || 0);
    byVendor.set(norm, g);
  }

  // Already-tracked vendors (so we don't re-suggest them).
  const tracked = new Set((await getContractsStored()).map((c) => normalizeVendor(c.vendor).toLowerCase()));

  const suggestions = [...byVendor.entries()]
    .filter(([norm, g]) => g.months.size >= 4 && g.net > 500 && !tracked.has(norm))
    .map(([, g]) => {
      const months = g.months.size;
      const billingCycle = months >= 10 ? "monthly" : months >= 5 ? "quarterly" : "annual";
      // Dominant category.
      const topCat = Object.entries(g.category).sort((a, b) => b[1] - a[1])[0]?.[0] || "Software & Licenses";
      return {
        vendor: g.display,
        annualCost: Math.round(g.net),
        monthsActive: months,
        billingCycle,
        category: toContractCategory(topCat),
        itCategory: topCat,
      };
    })
    .sort((a, b) => b.annualCost - a.annualCost);

  return NextResponse.json({ suggestions, window: { from, to } });
}
