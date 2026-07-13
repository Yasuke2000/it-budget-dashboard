import { NextResponse } from "next/server";
import { fetchContractDocuments, SharePointPermissionError } from "@/lib/sharepoint-client";

export const dynamic = "force-dynamic";

// Live lijst van contractdocumenten uit SharePoint (Finance → IT →
// Dienstverleningsovereenkomsten), zodat het register naar de brondocumenten
// kan verwijzen zonder handmatig zoeken.
export async function GET() {
  const configured = Boolean(process.env.BC_CLIENT_ID && process.env.BC_CLIENT_SECRET && process.env.BC_TENANT_ID);
  if (!configured) {
    return NextResponse.json({ configured, connected: false, documents: [], error: "Graph-credentials ontbreken" });
  }
  try {
    const documents = await fetchContractDocuments();
    return NextResponse.json({ configured, connected: true, count: documents.length, documents });
  } catch (err) {
    const permission = err instanceof SharePointPermissionError;
    return NextResponse.json({
      configured,
      connected: false,
      documents: [],
      error: permission
        ? "Machtiging ontbreekt: ken in Azure (App registrations → API permissions) de Microsoft Graph APPLICATION-machtiging 'Sites.Read.All' toe en geef admin consent. Daarna werkt deze connector zonder herstart."
        : `SharePoint niet bereikbaar: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
