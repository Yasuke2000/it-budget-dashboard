import { NextResponse } from "next/server";
import { getBudgetEntries } from "@/lib/data-source";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get("company") || "all";

  const entries = await getBudgetEntries(company);

  return NextResponse.json(entries);
}
