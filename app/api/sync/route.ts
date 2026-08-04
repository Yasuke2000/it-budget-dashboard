import { NextResponse } from "next/server";
import { authorizeOperator } from "@/lib/api-auth";
import { getBCToken } from "@/lib/bc-client";
import { getGraphToken } from "@/lib/graph-client";
import { clearCache } from "@/lib/sync-cache";
import {
  getCompanies,
  getInvoices,
  getLicenses,
  getDevices,
} from "@/lib/data-source";

// Sync: verwarmt de in-memory cache onder DEZELFDE keys (en vormen) die de
// pagina-datasource leest, zodat de volgende paginaload warm bediend wordt.
//
// Twee aanroepers, allebei geldig (audit 05/08/2026 — daarvóór eiste deze route
// het cron-secret, waardoor de knop "Sync Now" op de Settings-pagina áltijd 401
// gaf: een browser kan die header niet meesturen):
//   • de dagelijkse cron-job met `Authorization: Bearer <SYNC_CRON_SECRET>`;
//   • een ingelogde gebruiker die op "Sync Now" klikt (NextAuth-sessie of
//     Authelia's Remote-User via de ingress).
// De actie is bewust niet-destructief: ze leest enkel upstream en vult caches.
export async function POST(request: Request) {
  const who = await authorizeOperator(request);
  if (!who.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  console.info(`sync: gestart door ${who.via}${who.user ? ` (${who.user})` : ""}`);

  const results: Record<string, string> = {};
  const errors: Record<string, string> = {};

  // Start from a clean slate so the getters re-fetch live data instead of
  // returning whatever is already cached.
  clearCache();

  const now = new Date();
  const yearStart = `${now.getFullYear()}-01-01`;
  const today = now.toISOString().split("T")[0];

  // 1. Business Central — validate credentials, then warm companies/invoices/GL.
  if (process.env.BC_CLIENT_ID && process.env.BC_CLIENT_SECRET) {
    try {
      await getBCToken(); // surfaces auth failures explicitly
      const companies = await getCompanies();
      const invoices = await getInvoices("all", yearStart, today);
      results.bc = `OK — ${companies.length} companies, ${invoices.length} IT ledger lines`;
    } catch (err: unknown) {
      errors.bc = err instanceof Error ? err.message : String(err);
    }
  } else {
    results.bc = "skipped (not configured)";
  }

  // 2. Microsoft Graph — licenses + devices (same app registration as BC).
  if (process.env.BC_CLIENT_ID) {
    try {
      await getGraphToken();
      const licenses = await getLicenses();
      const devices = await getDevices();
      results.graph = `OK — ${licenses.length} SKUs, ${devices.length} devices`;
    } catch (err: unknown) {
      errors.graph = err instanceof Error ? err.message : String(err);
    }
  } else {
    results.graph = "skipped (not configured)";
  }

  return NextResponse.json({
    success: Object.keys(errors).length === 0,
    results,
    errors: Object.keys(errors).length > 0 ? errors : undefined,
    timestamp: new Date().toISOString(),
  });
}

export async function GET() {
  return NextResponse.json({
    message: "POST om te synchroniseren — als ingelogde gebruiker, of met Authorization: Bearer <SYNC_CRON_SECRET> voor de cron-job",
  });
}
