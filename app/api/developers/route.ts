import { NextResponse } from "next/server";
import { getDeveloperDashboard } from "@/lib/azure-devops-client";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  // Default: last 7 days (matches the developer-dashboard cadence). The global
  // date-range picker can override via ?dateFrom/?dateTo.
  const now = new Date();
  const defaultTo = now.toISOString().slice(0, 10);
  const defaultFrom = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  const dateFrom = searchParams.get("dateFrom") || defaultFrom;
  const dateTo = searchParams.get("dateTo") || defaultTo;
  try {
    const data = await getDeveloperDashboard(dateFrom, dateTo);
    return NextResponse.json(data);
  } catch (e) {
    console.error("developer dashboard error:", e);
    return NextResponse.json({ error: "Failed to load developer metrics" }, { status: 500 });
  }
}
