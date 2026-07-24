// GET /api/cfo/leasing?exclude=GPR,GRE&from&to
// Leasing & huur rollend materieel (spec Birgit) — CFO-gated, scope-aware.
// Zware pull (GL per rekening + VLE-join per firma) → 12h-cache in lib/leasing.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { cfoAllowed } from "@/lib/cfo-access";
import { buildLeasing } from "@/lib/leasing";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const session = await auth().catch(() => null);
  if (!cfoAllowed(session?.user?.email)) {
    return NextResponse.json({ error: "CFO-toegang vereist" }, { status: 403 });
  }
  const sp = req.nextUrl.searchParams;
  const exclude = (sp.get("exclude") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const from = sp.get("from") || undefined;
  const to = sp.get("to") || undefined;
  if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to))) {
    return NextResponse.json({ error: "from/to ongeldig" }, { status: 400 });
  }
  try {
    const data = await buildLeasing(exclude, from, to);
    // De cockpit-kaart heeft het boekingen-detail niet nodig — dat is voor de
    // Excel-export (die buildLeasing rechtstreeks aanspreekt). Payload klein houden.
    const light = { ...data };
    delete light.entries;
    delete light.perCompanyMonthly;
    return NextResponse.json(light);
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 200) }, { status: 502 });
  }
}
