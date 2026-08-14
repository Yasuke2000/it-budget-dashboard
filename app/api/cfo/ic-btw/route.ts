import { auth } from "@/lib/auth";
import { cfoAllowed } from "@/lib/cfo-access";
import { polledResponse } from "@/lib/bc-odata";
import { getIcBtw } from "@/lib/ic-btw";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const session = await auth().catch(() => null);
  if (!cfoAllowed(session?.user?.email)) return new Response("Forbidden", { status: 403 });
  return polledResponse(req, getIcBtw, (sp) => {
    const f = sp.get("from") || "", t = sp.get("to") || "";
    const ISO = /^\d{4}-\d{2}-\d{2}$/;
    return ISO.test(f) && ISO.test(t) && f <= t ? `${f}..${t}` : undefined;
  });
}
