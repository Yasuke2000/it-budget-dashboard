import { auth } from "@/lib/auth";
import { cfoAllowed } from "@/lib/cfo-access";
import { Formularium } from "@/components/cfo/formularium";
import { Lock } from "lucide-react";

export const dynamic = "force-dynamic";

// Formularium — het begrippenregister van de CFO-pagina's ("hoe kom je daaraan?",
// vraag David 10/08/2026 voor de F&A-meeting). Zelfde toegangsregel als de cockpit.
export default async function FormulariumPage() {
  const session = await auth().catch(() => null);
  if (!cfoAllowed(session?.user?.email)) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-2xl border border-border bg-card p-8 text-center">
        <Lock className="mx-auto h-8 w-8 text-muted-foreground/70" />
        <h1 className="mt-3 text-lg font-semibold text-foreground">Formularium — beperkte toegang</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Deze pagina hoort bij de CFO-cockpit en is voorbehouden aan CFO/CEO.</p>
      </div>
    );
  }
  return <Formularium />;
}
