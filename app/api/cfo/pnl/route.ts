import { auth } from "@/lib/auth";
import { cfoAllowed } from "@/lib/cfo-access";
import { polledResponse } from "@/lib/bc-odata";
import { getMgmtPnl } from "@/lib/mgmt-pnl";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ?year=2026&company=GTR|ALL — default: huidig jaar, alle firma's.
export async function GET(req: Request) {
  const session = await auth().catch(() => null);
  if (!cfoAllowed(session?.user?.email)) return new Response("Forbidden", { status: 403 });
  return polledResponse(req, getMgmtPnl, (sp) => {
    const y = sp.get("year") || String(new Date().getUTCFullYear());
    const c = (sp.get("company") || "ALL").toUpperCase();
    return /^\d{4}$/.test(y) && /^([A-Z]{2,5}|ALL)$/.test(c) ? `${y}|${c}` : undefined;
  });
}
