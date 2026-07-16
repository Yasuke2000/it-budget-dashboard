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
      <div className="mx-auto mt-16 max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
        <Lock className="mx-auto h-8 w-8 text-slate-500" />
        <h1 className="mt-3 text-lg font-semibold text-white">CFO-cockpit — beperkte toegang</h1>
        <p className="mt-1.5 text-sm text-slate-400">Deze financiële cockpit is voorbehouden aan CFO/CEO. Vraag toegang aan de beheerder (allowlist <code>CFO_ALLOWED_EMAILS</code>).</p>
      </div>
    );
  }

  const sp = await searchParams;
  const company = sp.company || "all";
  const year = new Date().getFullYear();
  const from = sp.from || `${year}-01-01`;
  const to = sp.to || `${year}-12-31`;

  const data = await getCfoFinancials(company, from, to).catch(() => null);

  if (!data) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
        Kon de financiële data niet laden. Controleer de Business Central-verbinding in Connectors.
      </div>
    );
  }

  return <CfoCockpit data={data} />;
}
