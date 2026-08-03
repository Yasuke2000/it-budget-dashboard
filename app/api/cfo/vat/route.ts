import { auth } from "@/lib/auth";
import { cfoAllowed } from "@/lib/cfo-access";
import { getVat } from "@/lib/vat";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// BTW-positie van de groep (maandposities, YTD/YoY, voorfinanciering, BTW-eenheid).
export async function GET(req: Request) {
  const session = await auth().catch(() => null);
  if (!cfoAllowed(session?.user?.email)) return new Response("Forbidden", { status: 403 });

  const url = new URL(req.url);
  const force = url.searchParams.get("refresh") === "1";
  const exclude = (url.searchParams.get("exclude") || "").split(",").map((s) => s.trim()).filter(Boolean);

  try {
    const data = await getVat(force, exclude);
    if ("building" in data && data.building) {
      return Response.json(data, { status: 202 });
    }
    return Response.json(data);
  } catch (err) {
    console.error("vat route failed:", err);
    return Response.json({ error: String(err).slice(0, 300) }, { status: 500 });
  }
}
