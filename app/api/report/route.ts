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
  // Honour the on-screen date range; default to last 12 months.
  const now0 = new Date();
  const from12 = new Date(now0);
  from12.setMonth(from12.getMonth() - 12);
  const dateFrom = searchParams.get("dateFrom") || from12.toISOString().split("T")[0];
  const dateTo = searchParams.get("dateTo") || now0.toISOString().split("T")[0];

  const [kpis, categories, vendors, monthly, contracts, licenses] = await Promise.all([
    getDashboardKPIs(company, dateFrom, dateTo),
    getCategorySpend(company, dateFrom, dateTo),
    getVendorSummary(company, dateFrom, dateTo),
    getMonthlySpend(company, dateFrom, dateTo),
    getContracts(),
    getLicenses(),
  ]);

  return NextResponse.json({ kpis, categories, vendors, monthly, contracts, licenses });
}
