import { NextResponse } from "next/server";
import { getEmployees, getPersonnelKPIs } from "@/lib/data-source";

export async function GET() {
  const [employees, kpis] = await Promise.all([
    getEmployees(),
    getPersonnelKPIs(),
  ]);

  return NextResponse.json({ employees, kpis });
}
