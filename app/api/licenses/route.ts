import { NextResponse } from "next/server";
import { getLicenses } from "@/lib/data-source";

export async function GET() {
  const licenses = await getLicenses();

  return NextResponse.json(licenses);
}
