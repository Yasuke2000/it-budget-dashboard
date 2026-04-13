import { NextResponse } from "next/server";
import { getBCToken } from "@/lib/bc-client";
import { getGraphToken } from "@/lib/graph-client";
import { getCacheStats } from "@/lib/sync-cache";

interface ServiceStatus {
  configured: boolean;
  connected: boolean;
  error: string | null;
}

export async function GET() {
  const status: Record<string, ServiceStatus> = {
    bc: { configured: false, connected: false, error: null },
    graph: { configured: false, connected: false, error: null },
    jira: { configured: false, connected: false, error: null },
    dell: { configured: false, connected: false, error: null },
    lenovo: { configured: false, connected: false, error: null },
  };

  // BC
  if (process.env.BC_CLIENT_ID && process.env.BC_CLIENT_SECRET && process.env.BC_TENANT_ID) {
    status.bc.configured = true;
    try { await getBCToken(); status.bc.connected = true; }
    catch (e: unknown) { status.bc.error = e instanceof Error ? e.message : String(e); }
  }

  // Graph (same app registration as BC)
  if (process.env.BC_CLIENT_ID && process.env.BC_CLIENT_SECRET && process.env.BC_TENANT_ID) {
    status.graph.configured = true;
    try { await getGraphToken(); status.graph.connected = true; }
    catch (e: unknown) { status.graph.error = e instanceof Error ? e.message : String(e); }
  }

  // Jira
  if (process.env.JIRA_BASE_URL && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN) {
    status.jira.configured = true;
    status.jira.connected = true; // no cheap auth test for Jira, assume OK if configured
  }

  // Dell
  if (process.env.DELL_CLIENT_ID && process.env.DELL_CLIENT_SECRET) {
    status.dell.configured = true;
    status.dell.connected = true; // test on first warranty call
  }

  // Lenovo
  if (process.env.LENOVO_CLIENT_ID) {
    status.lenovo.configured = true;
    status.lenovo.connected = true;
  }

  const cache = getCacheStats();
  const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE !== "false";

  return NextResponse.json({ demoMode, services: status, cache });
}
