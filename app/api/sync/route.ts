import { NextResponse } from "next/server";
import { getBCToken, fetchBCCompanies, fetchBCInvoices } from "@/lib/bc-client";
import { getGraphToken, fetchSubscribedSkus, fetchManagedDevices } from "@/lib/graph-client";
import { fetchJiraWorklogs } from "@/lib/jira-client";
import { setCache, clearCache } from "@/lib/sync-cache";

export async function POST(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.SYNC_CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, string> = {};
  const errors: Record<string, string> = {};

  // 1. BC sync
  if (process.env.BC_CLIENT_ID && process.env.BC_CLIENT_SECRET) {
    try {
      const token = await getBCToken();
      const companies = await fetchBCCompanies();
      let invoiceCount = 0;
      const now = new Date();
      const yearStart = `${now.getFullYear()}-01-01`;
      const today = now.toISOString().split("T")[0];
      for (const co of companies) {
        const invoices = await fetchBCInvoices(co.id as string, yearStart, today);
        invoiceCount += invoices.length;
      }
      setCache("bc-companies", companies, 1440); // 24h
      results.bc = `OK — ${companies.length} companies, ${invoiceCount} invoices`;
    } catch (err: any) {
      errors.bc = err.message;
    }
  } else {
    results.bc = "skipped (not configured)";
  }

  // 2. Graph sync (licenses + devices)
  if (process.env.BC_CLIENT_ID) { // same app registration
    try {
      const licenses = await fetchSubscribedSkus();
      const devices = await fetchManagedDevices();
      setCache("graph-licenses", licenses, 240); // 4h
      setCache("graph-devices", devices, 240);
      results.graph = `OK — ${licenses.length} SKUs, ${devices.length} devices`;
    } catch (err: any) {
      errors.graph = err.message;
    }
  } else {
    results.graph = "skipped (not configured)";
  }

  // 3. Jira sync
  if (process.env.JIRA_BASE_URL && process.env.JIRA_API_TOKEN) {
    try {
      const worklogs = await fetchJiraWorklogs();
      setCache("jira-worklogs", worklogs, 360); // 6h
      results.jira = `OK — ${worklogs.length} worklogs`;
    } catch (err: any) {
      errors.jira = err.message;
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

// GET for manual trigger / health check
export async function GET() {
  return NextResponse.json({ message: "Use POST with SYNC_CRON_SECRET to trigger sync" });
}
