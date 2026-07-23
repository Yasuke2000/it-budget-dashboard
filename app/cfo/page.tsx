import { getCfoFinancials } from "@/lib/cfo";
import { CfoCockpit } from "@/components/cfo/cfo-cockpit";
import { auth } from "@/lib/auth";
import { cfoAllowed } from "@/lib/cfo-access";
import { Lock } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CfoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth().catch(() => null);
  if (!cfoAllowed(session?.user?.email)) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-2xl border border-border bg-card p-8 text-center">
        <Lock className="mx-auto h-8 w-8 text-muted-foreground/70" />
        <h1 className="mt-3 text-lg font-semibold text-foreground">CFO-cockpit — beperkte toegang</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Deze financiële cockpit is voorbehouden aan CFO/CEO. Vraag toegang aan de beheerder (allowlist <code>CFO_ALLOWED_EMAILS</code>).</p>
      </div>
    );
  }

  const sp = await searchParams;
  const company = sp.company || "all";
  // from/to bewust NIET hier defaulten: lib/cfo.ts zet einde = vandaag (echte YTD,
  // vooruit-gedateerde boekingen uitgesloten) en begin = 1 januari.
  const from = sp.from;
  const to = sp.to;
  const force = sp.refresh === "1"; // "vernieuwen"-link: cache overslaan, vers uit BC
  // Consolidatiescope: ?exclude=GPR,GRE sluit vennootschappen uit de groepsview.
  const exclude = (sp.exclude || "").split(",").map((s) => s.trim()).filter(Boolean);

  // Momentopname bekijken: ?snapshot=<id> → exact de opgeslagen dataset van die dag.
  if (sp.snapshot && /^\d+$/.test(sp.snapshot)) {
    const { getCfoSnapshot } = await import("@/lib/cfo-store");
    const snap = await getCfoSnapshot(Number(sp.snapshot)).catch(() => null);
    if (snap) {
      return <CfoCockpit data={{ ...snap.payload, snapshotOf: snap.takenAt }} />;
    }
    // Snapshot niet gevonden → val door naar live met een duidelijke melding.
  }

  const data = await getCfoFinancials(company, from, to, force, exclude).catch(() => null);

  if (!data) {
    return (
      <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
        Kon de financiële data niet laden. Controleer de Business Central-verbinding in Connectors.
      </div>
    );
  }

  return <CfoCockpit data={data} />;
}
