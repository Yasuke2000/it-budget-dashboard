import { NextResponse } from "next/server";
import { getContracts } from "@/lib/data-source";

export async function GET() {
  const contracts = await getContracts();
  return NextResponse.json(contracts);
}
