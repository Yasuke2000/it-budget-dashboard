import { auth } from "@/lib/auth";
import { cfoAllowed } from "@/lib/cfo-access";
import { KlantenCash } from "@/components/cfo/klanten-cash";
import { Lock } from "lucide-react";

export const dynamic = "force-dynamic";

// Klanten & cash — DSO-deep-dive, betaalgedrag, factoring en BTW. Zelfde toegangs-
// regel als de CFO-cockpit; de data komt client-side van /api/cfo/receivables en
// /api/cfo/vat (zware pulls → poll-patroon, nooit een geblokkeerde page-load).
export default async function KlantenCashPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth().catch(() => null);
  if (!cfoAllowed(session?.user?.email)) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-2xl border border-border bg-card p-8 text-center">
        <Lock className="mx-auto h-8 w-8 text-muted-foreground/70" />
        <h1 className="mt-3 text-lg font-semibold text-foreground">Klanten & cash — beperkte toegang</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Deze pagina hoort bij de CFO-cockpit en is voorbehouden aan CFO/CEO. Vraag toegang aan de beheerder (allowlist <code>CFO_ALLOWED_EMAILS</code>).</p>
      </div>
    );
  }
  const sp = await searchParams;
  const exclude = (sp.exclude || "").split(",").map((s) => s.trim()).filter(Boolean);
  return <KlantenCash exclude={exclude} />;
}
