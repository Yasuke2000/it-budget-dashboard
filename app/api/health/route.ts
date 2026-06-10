import { NextResponse } from "next/server";

// Lightweight liveness/readiness probe. No external calls, no DB — just confirms
// the Next.js server is up. (Use /api/status for the richer connector report.)
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true });
}
