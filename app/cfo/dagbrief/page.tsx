import { auth } from "@/lib/auth";
import { cfoAllowed } from "@/lib/cfo-access";
import { DagbriefView } from "@/components/cfo/dagbrief-view";
import { Lock } from "lucide-react";

export const dynamic = "force-dynamic";

// Dagelijkse cashpositie (vraag CFO 18/08/2026).
export default async function DagbriefPage() {
  const session = await auth().catch(() => null);
  if (!cfoAllowed(session?.user?.email)) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-2xl border border-border bg-card p-8 text-center">
        <Lock className="mx-auto h-8 w-8 text-muted-foreground/70" />
        <h1 className="mt-3 text-lg font-semibold text-foreground">Dagelijkse cashpositie — beperkte toegang</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Deze pagina hoort bij de CFO-cockpit en is voorbehouden aan CFO/CEO.</p>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <DagbriefView />
    </div>
  );
}
