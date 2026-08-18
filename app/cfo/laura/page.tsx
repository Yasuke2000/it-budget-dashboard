import { auth } from "@/lib/auth";
import { cfoAllowed } from "@/lib/cfo-access";
import { LauraView } from "@/components/cfo/laura-view";
import { Lock } from "lucide-react";

export const dynamic = "force-dynamic";

// Laura-modus (vraag David 18/08/2026): een volledig eigen, supersimpele
// bouwblokken-pagina voor de CFO — roze & goud, dummy-proof, gescheiden van de
// rest. De MCP-koppel-URL wordt hier server-side samengesteld zodat zij hem
// met één klik kan kopiëren (pagina is CFO/CEO-only).
export default async function LauraPage() {
  const session = await auth().catch(() => null);
  if (!cfoAllowed(session?.user?.email)) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-2xl border border-border bg-card p-8 text-center">
        <Lock className="mx-auto h-8 w-8 text-muted-foreground/70" />
        <h1 className="mt-3 text-lg font-semibold text-foreground">Laura-modus — beperkte toegang</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Deze pagina is voorbehouden aan CFO/CEO.</p>
      </div>
    );
  }
  const mcpUrl = process.env.MCP_TOKEN
    ? `https://itfinance.daviddelporte.com/api/mcp/${process.env.MCP_TOKEN}`
    : "";
  return <LauraView mcpUrl={mcpUrl} />;
}
