import { NextResponse } from "next/server";
import {
  getDashboardKPIs,
  getCategorySpend,
  getVendorSummary,
  getMonthlySpend,
  getContracts,
  getLicenses,
} from "@/lib/data-source";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get("company") || "all";

  const [kpis, categories, vendors, monthly, contracts, licenses] = await Promise.all([
    getDashboardKPIs(company),
    getCategorySpend(company),
    getVendorSummary(company),
    getMonthlySpend(company),
    getContracts(),
    getLicenses(),
  ]);

  return NextResponse.json({ kpis, categories, vendors, monthly, contracts, licenses });
}
