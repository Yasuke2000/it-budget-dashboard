import { auth } from "@/lib/auth";
import { cfoAllowed } from "@/lib/cfo-access";
import { getFullBalance } from "@/lib/balance-full";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Volledige balans op datum (?date=YYYY-MM-DD, default vandaag; ?exclude=GPR,…).
export async function GET(req: Request) {
  const session = await auth().catch(() => null);
  if (!cfoAllowed(session?.user?.email)) return new Response("Forbidden", { status: 403 });
  const url = new URL(req.url);
  const date = url.searchParams.get("date") || undefined;
  const exclude = (url.searchParams.get("exclude") || "").split(",").map((s) => s.trim()).filter(Boolean);
  try {
    return Response.json(await getFullBalance(date, exclude));
  } catch (err) {
    console.error("balance route failed:", err);
    return Response.json({ error: String(err).slice(0, 300) }, { status: 500 });
  }
}
