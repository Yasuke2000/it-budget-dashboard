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
  const dateFrom = searchParams.get("dateFrom") || undefined;
  const dateTo = searchParams.get("dateTo") || undefined;

  const [kpis, monthly, categories, entities, vendors] = await Promise.all([
    getDashboardKPIs(company, dateFrom, dateTo),
    getMonthlySpend(company, dateFrom, dateTo),
    getCategorySpend(company, dateFrom, dateTo),
    getEntitySpend(dateFrom, dateTo),
    getVendorSummary(company, dateFrom, dateTo),
  ]);

  return NextResponse.json({ kpis, monthly, categories, entities, vendors });
}
