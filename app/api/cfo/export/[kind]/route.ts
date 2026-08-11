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
  if (kind !== "ap" && kind !== "ar" && kind !== "leasing" && kind !== "klantencash" && kind !== "uitgaven") return new Response("Unknown export", { status: 404 });

  try {
    const pulledAt = new Date();

    // Overzicht uitgaven per categorie × firma × maand (FINSIT/OVZ-stijl, live).
    // Optioneel ?from=YYYY-MM-DD&to=YYYY-MM-DD; default = 1 jan t/m laatste volledige maand.
    if (kind === "uitgaven") {
      const url = new URL(req.url);
      const { fetchUitgaven, buildUitgavenWorkbook, defaultUitgavenRange } = await import("@/lib/uitgaven-export");
      const def = defaultUitgavenRange(pulledAt);
      const iso = /^\d{4}-\d{2}-\d{2}$/;
      const from = iso.test(url.searchParams.get("from") || "") ? url.searchParams.get("from")! : def.from;
      const to = iso.test(url.searchParams.get("to") || "") ? url.searchParams.get("to")! : def.to;
      if (from > to) {
        return Response.json({ error: `Ongeldige periode: van-datum (${from}) ligt na tot-datum (${to}).` }, { status: 400 });
      }
      const data = await fetchUitgaven(from, to);
      if (!data.rows) {
        return Response.json({ error: `Geen boekingen gevonden in ${from} t/m ${to} — ligt de periode (deels) in de toekomst, of is de BC-verbinding inactief (demomodus)?` }, { status: 503 });
      }
      const { buffer, filename } = await buildUitgavenWorkbook(data, from, to, pulledAt);
      return xlsxResponse(buffer, filename, pulledAt);
    }

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
      // Stempel = de échte pull-tijd van de data (asOf, oudste firmabundel) — niet het
      // downloadmoment: het bestand claimt anders een verse pull op 12u oude cache.
      const stampAt = "asOf" in data && data.asOf ? new Date(data.asOf) : pulledAt;
      const { buffer, filename } = await buildRcvWorkbook(data, stampAt);
      return xlsxResponse(buffer, filename, stampAt);
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
