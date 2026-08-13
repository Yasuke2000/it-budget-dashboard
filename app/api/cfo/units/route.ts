import { auth } from "@/lib/auth";
import { cfoAllowed } from "@/lib/cfo-access";
import { polledResponse } from "@/lib/bc-odata";
import { getUnits } from "@/lib/units";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const session = await auth().catch(() => null);
  if (!cfoAllowed(session?.user?.email)) return new Response("Forbidden", { status: 403 });
  // ?from/?to (vraag David 13/08/2026): instelbaar venster, default YTD in de builder.
  return polledResponse(req, getUnits, (sp) => {
    const f = sp.get("from") || "", t = sp.get("to") || "";
    const ISO = /^\d{4}-\d{2}-\d{2}$/;
    return ISO.test(f) && ISO.test(t) && f <= t ? `${f}..${t}` : undefined;
  });
}
