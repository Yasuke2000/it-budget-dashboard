// CFO-cockpit momentopnames (point-in-time).
// GET  → lijst (id, datum, scope, omzet-headline)
// POST → maak nu een handmatige snapshot van de huidige (gecachete) live view.
// CFO-allowlist-gated; vereist Postgres (DATABASE_URL).

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { cfoAllowed } from "@/lib/cfo-access";
import { listCfoSnapshots, saveCfoSnapshot, snapshotEnabled } from "@/lib/cfo-store";
import { getCfoFinancials } from "@/lib/cfo";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth().catch(() => null);
  if (!cfoAllowed(session?.user?.email)) return NextResponse.json({ error: "CFO-toegang vereist" }, { status: 403 });
  if (!snapshotEnabled()) return NextResponse.json({ enabled: false, snapshots: [] });
  try {
    return NextResponse.json({ enabled: true, snapshots: await listCfoSnapshots() });
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 200) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth().catch(() => null);
  if (!cfoAllowed(session?.user?.email)) return NextResponse.json({ error: "CFO-toegang vereist" }, { status: 403 });
  if (!snapshotEnabled()) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL niet ingesteld — snapshots vereisen Postgres." }, { status: 400 });
  }
  try {
    const body = (await req.json().catch(() => ({}))) as { company?: string; exclude?: string[] };
    const data = await getCfoFinancials(body.company || "all", undefined, undefined, false, body.exclude || []);
    if (!data.isLive) {
      return NextResponse.json({ ok: false, error: "Geen live data beschikbaar — snapshot van demo-data heeft geen zin." }, { status: 409 });
    }
    const id = await saveCfoSnapshot(data, true);
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
  }
}
