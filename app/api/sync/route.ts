import { NextResponse } from "next/server";
import { getBCToken } from "@/lib/bc-client";
import { getGraphToken } from "@/lib/graph-client";
import { clearCache } from "@/lib/sync-cache";
import {
  getCompanies,
  getInvoices,
  getGLEntries,
  getLicenses,
  getDevices,
  getJiraWorklogs,
} from "@/lib/data-source";

// Daily cron-triggered sync. Refreshes the in-memory cache under the SAME keys
// (and mapped shapes) that the page data-source reads, so subsequent page loads
// are served warm instead of hitting the upstream APIs on first access.
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.SYNC_CRON_SECRET || authHeader !== `Bearer ${process.env.SYNC_CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
      await getGLEntries("all", yearStart, today);
      results.bc = `OK — ${companies.length} companies, ${invoices.length} invoices`;
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

  // 3. Jira worklogs.
  if (process.env.JIRA_BASE_URL && process.env.JIRA_API_TOKEN) {
    try {
      const worklogs = await getJiraWorklogs();
      results.jira = `OK — ${worklogs.length} worklogs`;
    } catch (err: unknown) {
      errors.jira = err instanceof Error ? err.message : String(err);
    }
  } else {
    results.jira = "skipped (not configured)";
  }

  return NextResponse.json({
    success: Object.keys(errors).length === 0,
    results,
    errors: Object.keys(errors).length > 0 ? errors : undefined,
    timestamp: new Date().toISOString(),
  });
}

export async function GET() {
  return NextResponse.json({ message: "Use POST with SYNC_CRON_SECRET to trigger sync" });
}
