import { NextResponse } from "next/server";
import {
  getDashboardKPIs,
  getMonthlySpend,
  getCategorySpend,
  getEntitySpend,
  getVendorSummary,
} from "@/lib/data-source";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get("company") || "all";

  const [kpis, monthly, categories, entities, vendors] = await Promise.all([
    getDashboardKPIs(company),
    getMonthlySpend(company),
    getCategorySpend(company),
    getEntitySpend(),
    getVendorSummary(company),
  ]);

  return NextResponse.json({ kpis, monthly, categories, entities, vendors });
}
