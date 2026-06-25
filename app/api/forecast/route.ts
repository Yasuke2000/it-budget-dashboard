import { NextResponse } from "next/server";
import { getSpendForecast } from "@/lib/data-source";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get("company") || "all";
  // Scenario knobs: growth % on variable spend, flat extra €/month (new tool/hire).
  const growthPct = Math.max(-50, Math.min(100, Number(searchParams.get("growthPct")) || 0));
  const extraMonthly = Math.max(0, Number(searchParams.get("extraMonthly")) || 0);
  try {
    const forecast = await getSpendForecast(company, { growthPct, extraMonthly });
    return NextResponse.json(forecast);
  } catch (e) {
    console.error("forecast error:", e);
    return NextResponse.json({ error: "Failed to compute forecast" }, { status: 500 });
  }
}
