import { NextResponse } from "next/server";
import { getVendorSummary } from "@/lib/data-source";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get("company") || "all";
  // Honour the global date range (was dropped — the route always returned the
  // current calendar year regardless of the picker).
  const dateFrom = searchParams.get("dateFrom") ?? undefined;
  const dateTo = searchParams.get("dateTo") ?? undefined;

  const vendors = await getVendorSummary(company, dateFrom, dateTo);

  return NextResponse.json(vendors);
}
