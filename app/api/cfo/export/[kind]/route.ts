import { auth } from "@/lib/auth";
import { cfoAllowed } from "@/lib/cfo-access";
import { fetchAgingAP, fetchAgingAR, buildAgingWorkbook } from "@/lib/aging-export";
import { buildLeasing } from "@/lib/leasing";
import { buildLeasingWorkbook } from "@/lib/leasing-export";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function xlsxResponse(buffer: ArrayBuffer, filename: string, pulledAt: Date): Response {
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Pulled-At": pulledAt.toISOString(),
      "Cache-Control": "no-store",
    },
  });
}

// Export-knoppen: pull LIVE uit BC en stream een Excel met de pull-timestamp in
// bestandsnaam + titelrij. kind = "ap" | "ar" (aging) | "leasing" (cash-out).
// Vaste featureset per export: timestamp, IC-markering, BC-deeplinks, methodiek.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ kind: string }> }
) {
  const session = await auth().catch(() => null);
  if (!cfoAllowed(session?.user?.email)) return new Response("Forbidden", { status: 403 });

  const { kind } = await params;
  if (kind !== "ap" && kind !== "ar" && kind !== "leasing" && kind !== "klantencash") return new Response("Unknown export", { status: 404 });

  try {
    const pulledAt = new Date();

    // Klanten & Cash: de volledige brondata achter de pagina (DSO per maand,
    // betaalgedrag per klant, open posten met BC-links, factoring, facturatie per week).
    if (kind === "klantencash") {
      const url = new URL(req.url);
      const exclude = (url.searchParams.get("exclude") || "").split(",").map((s) => s.trim()).filter(Boolean);
      const { getReceivables } = await import("@/lib/receivables");
      const data = await getReceivables(false, exclude);
      if ("building" in data && data.building) {
        return Response.json({ error: "De data wordt nog opgebouwd uit Business Central — probeer over een paar minuten opnieuw." }, { status: 503 });
      }
      if (!("dso" in data)) {
        return Response.json({ error: "Geen data beschikbaar om te exporteren." }, { status: 503 });
      }
      const { buildRcvWorkbook } = await import("@/lib/rcv-export");
      const { buffer, filename } = await buildRcvWorkbook(data, pulledAt);
      return xlsxResponse(buffer, filename, pulledAt);
    }

    if (kind === "leasing") {
      const url = new URL(req.url);
      const exclude = (url.searchParams.get("exclude") || "").split(",").map((s) => s.trim()).filter(Boolean);
      const data = await buildLeasing(exclude);
      if (data.demo || !data.enabled) {
        return Response.json({ error: data.demo ? "Demomodus — geen live BC-data om te exporteren." : "Leasing-analyse staat uit (Settings → Budget)." }, { status: 503 });
      }
      const { buffer, filename } = await buildLeasingWorkbook(data, pulledAt);
      return xlsxResponse(buffer, filename, pulledAt);
    }

    const rows = kind === "ap" ? await fetchAgingAP() : await fetchAgingAR();
    if (!rows.length) {
      return Response.json({ error: "Geen open posten gevonden — is de BC-verbinding actief (geen demomodus)?" }, { status: 503 });
    }
    const { buffer, filename } = await buildAgingWorkbook(kind, rows, pulledAt);
    return xlsxResponse(buffer, filename, pulledAt);
  } catch (err) {
    console.error(`export ${kind} failed:`, err);
    return Response.json({ error: String(err).slice(0, 300) }, { status: 500 });
  }
}
