import { NextResponse } from "next/server";
import { getInvoices } from "@/lib/data-source";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get("company") || "all";
  const dateFrom = searchParams.get("dateFrom") ?? undefined;
  const dateTo = searchParams.get("dateTo") ?? undefined;

  const invoices = await getInvoices(company, dateFrom, dateTo);

  return NextResponse.json(invoices);
}
