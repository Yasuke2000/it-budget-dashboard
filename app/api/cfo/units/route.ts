import { auth } from "@/lib/auth";
import { cfoAllowed } from "@/lib/cfo-access";
import { polledResponse } from "@/lib/bc-odata";
import { getUnits } from "@/lib/units";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const session = await auth().catch(() => null);
  if (!cfoAllowed(session?.user?.email)) return new Response("Forbidden", { status: 403 });
  return polledResponse(req, getUnits);
}
