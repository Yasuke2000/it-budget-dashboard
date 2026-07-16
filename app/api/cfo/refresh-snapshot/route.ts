import { auth } from "@/lib/auth";
import { cfoAllowed } from "@/lib/cfo-access";
import { refreshGlSnapshot, snapshotEnabled } from "@/lib/cfo-store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Materialize the full GL balance snapshot (heavy). CFO-gated; requires Postgres.
export async function POST() {
  const session = await auth().catch(() => null);
  if (!cfoAllowed(session?.user?.email)) return new Response("Forbidden", { status: 403 });
  if (!snapshotEnabled()) {
    return Response.json({ ok: false, error: "DATABASE_URL niet ingesteld — snapshot vereist Postgres." }, { status: 400 });
  }
  try {
    const result = await refreshGlSnapshot();
    return Response.json({ ok: true, ...result, refreshedAt: new Date().toISOString() });
  } catch (err) {
    return Response.json({ ok: false, error: String(err).slice(0, 300) }, { status: 500 });
  }
}
