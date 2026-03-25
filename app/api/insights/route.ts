import { NextResponse } from "next/server";
import { getCostInsights } from "@/lib/data-source";

export async function GET() {
  const insights = await getCostInsights();
  return NextResponse.json(insights);
}
