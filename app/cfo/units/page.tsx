import { auth } from "@/lib/auth";
import { cfoAllowed } from "@/lib/cfo-access";
import { UnitsView } from "@/components/cfo/units-view";
import { Lock } from "lucide-react";

export const dynamic = "force-dynamic";

// Business Units & Activa — P&L per AFDELING-dimensie + vaste activa.
// Zelfde toegangsregels als de CFO-cockpit; data client-side met poll-patroon.
export default async function UnitsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth().catch(() => null);
  if (!cfoAllowed(session?.user?.email)) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-2xl border border-border bg-card p-8 text-center">
        <Lock className="mx-auto h-8 w-8 text-muted-foreground/70" />
        <h1 className="mt-3 text-lg font-semibold text-foreground">Business Units — beperkte toegang</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Deze pagina hoort bij de CFO-cockpit. Vraag toegang aan de beheerder (allowlist <code>CFO_ALLOWED_EMAILS</code>).</p>
      </div>
    );
  }
  const sp = await searchParams;
  const exclude = (sp.exclude || "").split(",").map((s) => s.trim()).filter(Boolean);
  return <UnitsView exclude={exclude} />;
}
