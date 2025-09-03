import { NextResponse } from "next/server";
import { getVendorSummary } from "@/lib/data-source";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get("company") || "all";

  const vendors = await getVendorSummary(company);

  return NextResponse.json(vendors);
}
