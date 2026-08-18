import { auth } from "@/lib/auth";
import { cfoAllowed } from "@/lib/cfo-access";
import { polledResponse } from "@/lib/bc-odata";
import { getDagbrief } from "@/lib/dagbrief";
import { getBank } from "@/lib/bank";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Dagelijkse cashpositie. Toegang: CFO-sessie, óf de ochtend-cron met
// Authorization: Bearer <SYNC_CRON_SECRET> (?refresh=1 ververst dan ook de
// bankstand, zodat de dagbrief elke ochtend op verse cijfers staat).
export async function GET(req: Request) {
  const cronSecret = process.env.SYNC_CRON_SECRET;
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const isCron = Boolean(cronSecret && bearer === cronSecret);
  if (!isCron) {
    const session = await auth().catch(() => null);
    if (!cfoAllowed(session?.user?.email)) return new Response("Forbidden", { status: 403 });
  }
  if (isCron && new URL(req.url).searchParams.get("refresh") === "1") {
    void getBank(true).catch(() => undefined); // bank vers trekken; dagbrief volgt via de polled build
  }
  return polledResponse(req, getDagbrief);
}
