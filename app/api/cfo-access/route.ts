import { auth } from "@/lib/auth";
import { cfoAllowed } from "@/lib/cfo-access";

export const dynamic = "force-dynamic";

// Whether the current signed-in user may see the CFO cockpit. Used by the sidebar
// to hide the nav item; the page itself also enforces this server-side.
export async function GET() {
  const session = await auth().catch(() => null);
  return Response.json({ allowed: cfoAllowed(session?.user?.email) });
}
