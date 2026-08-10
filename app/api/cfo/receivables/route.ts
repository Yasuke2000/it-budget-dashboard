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
    // De server houdt de VOLLEDIGE bellijst in cache (2.200+ klantrijen) omdat het
    // Excel-blad "Bellijst" die nodig heeft. De pagina toont er 40 per blok, dus
    // sturen we niet meer dan dat mee: anders groeit deze respons van ±290 KB naar
    // 1,3 MB voor rijen die nooit op het scherm komen. `customerCount` blijft het
    // echte totaal, zodat de UI correct "40 grootste van 414" kan melden.
    const UI_CAP = 40;
    const lean = "behaviour" in data && data.behaviour?.ageing?.length
      ? {
          ...data,
          behaviour: {
            ...data.behaviour,
            ageing: data.behaviour.ageing.map((b) => (
              b.customers.length > UI_CAP ? { ...b, customers: b.customers.slice(0, UI_CAP) } : b
            )),
          },
        }
      : data;
    return Response.json(lean, { headers: noStore });
  } catch (err) {
    console.error("receivables route failed:", err);
    return Response.json({ error: String(err).slice(0, 300) }, { status: 500, headers: noStore });
  }
}
