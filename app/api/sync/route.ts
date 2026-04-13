import { NextResponse } from "next/server";
import { getBCToken, fetchBCCompanies, fetchBCInvoices } from "@/lib/bc-client";
import { fetchSubscribedSkus, fetchManagedDevices } from "@/lib/graph-client";
import { fetchJiraWorklogs } from "@/lib/jira-client";
import { setCache } from "@/lib/sync-cache";

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.SYNC_CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, string> = {};
  const errors: Record<string, string> = {};

  // 1. BC sync
  if (process.env.BC_CLIENT_ID && process.env.BC_CLIENT_SECRET) {
    try {
      await getBCToken(); // validate credentials
      const companies = await fetchBCCompanies();
      let invoiceCount = 0;
      const now = new Date();
      const yearStart = `${now.getFullYear()}-01-01`;
      const today = now.toISOString().split("T")[0];
      for (const co of companies) {
        const invoices = await fetchBCInvoices(co.id as string, yearStart, today);
        invoiceCount += invoices.length;
      }
      setCache("bc-companies", companies, 1440);
      results.bc = `OK — ${companies.length} companies, ${invoiceCount} invoices`;
    } catch (err: unknown) {
      errors.bc = err instanceof Error ? err.message : String(err);
    }
  } else {
    results.bc = "skipped (not configured)";
  }

  // 2. Graph sync
  if (process.env.BC_CLIENT_ID) {
    try {
      const licenses = await fetchSubscribedSkus();
      const devices = await fetchManagedDevices();
      setCache("graph-licenses", licenses, 240);
      setCache("graph-devices", devices, 240);
      results.graph = `OK — ${licenses.length} SKUs, ${devices.length} devices`;
    } catch (err: unknown) {
      errors.graph = err instanceof Error ? err.message : String(err);
    }
  } else {
    results.graph = "skipped (not configured)";
  }

  // 3. Jira sync
  if (process.env.JIRA_BASE_URL && process.env.JIRA_API_TOKEN) {
    try {
      const worklogs = await fetchJiraWorklogs();
      setCache("jira-worklogs", worklogs, 360);
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
