import { NextResponse } from "next/server";
import { getCompanies } from "@/lib/data-source";

export const dynamic = "force-dynamic";

// Powers the company selector in the header so it uses real company IDs (BC
// GUIDs in live mode, comp-* in demo) instead of hardcoded short labels that
// never matched the data layer's company.id filter.
export async function GET() {
  try {
    const companies = await getCompanies();
    return NextResponse.json(
      companies.map((c) => ({ id: c.id, name: c.displayName || c.name })),
    );
  } catch {
    return NextResponse.json([]);
  }
}
