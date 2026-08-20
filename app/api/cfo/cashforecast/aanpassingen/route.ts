// Prognose-aanpassingen van de cashflowprognose (meeting 20/08/2026):
// GET → de bewaarde lijst; PUT → volledige lijst vervangen (gevalideerd).
// Opslag via settings-store (Postgres + JSON-file-fallback) zodat het scenario
// gedeeld is voor iedereen met CFO-toegang en een DB-wipe niets verliest.
// De toepassing op het model gebeurt client-side bovenop de gecachete
// basisprognose — bewaren hoeft dus nooit een BC-herbouw te triggeren.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { cfoAllowed } from "@/lib/cfo-access";
import { getStoredJson, setStoredJson } from "@/lib/settings-store";
import { valideerAanpassingen, type FcAanpassing } from "@/lib/cashfc-aanpassingen";

const KEY = "cashfcAanpassingen";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth().catch(() => null);
  if (!cfoAllowed(session?.user?.email)) return NextResponse.json({ error: "CFO-toegang vereist" }, { status: 403 });
  try {
    const aanpassingen = (await getStoredJson<FcAanpassing[]>(KEY)) ?? [];
    return NextResponse.json({ aanpassingen });
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 200) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const session = await auth().catch(() => null);
  if (!cfoAllowed(session?.user?.email)) return NextResponse.json({ error: "CFO-toegang vereist" }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { aanpassingen?: unknown } | null;
  const v = valideerAanpassingen(body?.aanpassingen);
  if ("fout" in v) return NextResponse.json({ error: v.fout }, { status: 400 });
  try {
    await setStoredJson(KEY, v.ok);
    return NextResponse.json({ ok: true, aanpassingen: v.ok });
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 200) }, { status: 500 });
  }
}
