import { auth } from "@/lib/auth";
import { cfoAllowed } from "@/lib/cfo-access";
import { getReceivables } from "@/lib/receivables";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Klanten & cash-payload (DSO/factoring/betaalgedrag). Zware BC-pull: zonder cache
// antwoordt dit 202 {building:true} en bouwt de server op de achtergrond door —
// de client pollt tot de data er is (Cloudflare kapt requests >100s af).
export async function GET(req: Request) {
  const session = await auth().catch(() => null);
  if (!cfoAllowed(session?.user?.email)) return new Response("Forbidden", { status: 403 });

  const url = new URL(req.url);
  const force = url.searchParams.get("refresh") === "1";
  const exclude = (url.searchParams.get("exclude") || "").split(",").map((s) => s.trim()).filter(Boolean);

  const noStore = { "Cache-Control": "no-store, max-age=0, must-revalidate" };
  try {
    const data = await getReceivables(force, exclude);
    if ("building" in data && data.building) {
      return Response.json(data, { status: 202, headers: noStore });
    }
    return Response.json(data, { headers: noStore });
  } catch (err) {
    console.error("receivables route failed:", err);
    return Response.json({ error: String(err).slice(0, 300) }, { status: 500, headers: noStore });
  }
}
