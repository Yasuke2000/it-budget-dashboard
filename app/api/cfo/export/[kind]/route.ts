import { auth } from "@/lib/auth";
import { cfoAllowed } from "@/lib/cfo-access";
import { fetchAgingAP, fetchAgingAR, buildAgingWorkbook } from "@/lib/aging-export";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Aging export button: pulls LIVE from BC and streams an Excel with the pull
// timestamp in filename + title. kind = "ap" (leveranciers) | "ar" (klanten).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ kind: string }> }
) {
  const session = await auth().catch(() => null);
  if (!cfoAllowed(session?.user?.email)) return new Response("Forbidden", { status: 403 });

  const { kind } = await params;
  if (kind !== "ap" && kind !== "ar") return new Response("Unknown export", { status: 404 });

  try {
    const pulledAt = new Date();
    const rows = kind === "ap" ? await fetchAgingAP() : await fetchAgingAR();
    if (!rows.length) {
      return Response.json({ error: "Geen open posten gevonden — is de BC-verbinding actief (geen demomodus)?" }, { status: 503 });
    }
    const { buffer, filename } = await buildAgingWorkbook(kind, rows, pulledAt);
    return new Response(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Pulled-At": pulledAt.toISOString(),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error(`aging export ${kind} failed:`, err);
    return Response.json({ error: String(err).slice(0, 300) }, { status: 500 });
  }
}
