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
    officient: { configured: false, connected: false, error: null },
    sharepoint: { configured: false, connected: false, error: null },
    jira: { configured: false, connected: false, error: null },
    azureDevops: { configured: false, connected: false, error: null },
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

  // Officient HR — a static API token works (Bearer); the OAuth client_id/secret
  // alone CANNOT authenticate headlessly. Live-probe /people/list when a token is set.
  if (process.env.OFFICIENT_API_TOKEN || (process.env.OFFICIENT_CLIENT_ID && process.env.OFFICIENT_CLIENT_SECRET)) {
    status.officient.configured = true;
    if (!process.env.OFFICIENT_API_TOKEN) {
      status.officient.error = "OAuth app present, but a personal access token is required for server-to-server access";
    } else {
      try {
        const r = await fetch("https://api.officient.io/1.0/people/list?page=0&include_archived=0", {
          headers: { Authorization: `Bearer ${process.env.OFFICIENT_API_TOKEN}`, Accept: "application/json" },
        });
        status.officient.connected = r.ok;
        if (!r.ok) status.officient.error = `HTTP ${r.status}`;
      } catch (e: unknown) { status.officient.error = e instanceof Error ? e.message : String(e); }
    }
  }

  // SharePoint (contractdocumenten) — zelfde app-registratie als Graph; vereist
  // de APPLICATION-machtiging Sites.Read.All. Probe = de contractenmap listen.
  if (process.env.BC_CLIENT_ID && process.env.BC_CLIENT_SECRET && process.env.BC_TENANT_ID) {
    status.sharepoint.configured = true;
    try {
      const { probeContractsFolder } = await import("@/lib/sharepoint-client");
      await probeContractsFolder();
      status.sharepoint.connected = true;
    } catch (e: unknown) {
      status.sharepoint.error = e instanceof Error ? e.message : String(e);
    }
  }

  // Jira — probe /myself so "connected" reflects reality.
  if (process.env.JIRA_BASE_URL && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN) {
    status.jira.configured = true;
    try {
      const auth = "Basic " + Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString("base64");
      const r = await fetch(`${process.env.JIRA_BASE_URL.replace(/\/$/, "")}/rest/api/3/myself`, { headers: { Authorization: auth, Accept: "application/json" } });
      status.jira.connected = r.ok;
      if (!r.ok) status.jira.error = `HTTP ${r.status}`;
    } catch (e: unknown) { status.jira.error = e instanceof Error ? e.message : String(e); }
  }

  // Azure DevOps — probe /_apis/projects with the PAT.
  if (process.env.AZURE_DEVOPS_ORG && process.env.AZURE_DEVOPS_PAT) {
    status.azureDevops.configured = true;
    try {
      const auth = "Basic " + Buffer.from(`:${process.env.AZURE_DEVOPS_PAT}`).toString("base64");
      const r = await fetch(`https://dev.azure.com/${process.env.AZURE_DEVOPS_ORG}/_apis/projects?api-version=7.1`, { headers: { Authorization: auth, Accept: "application/json" } });
      status.azureDevops.connected = r.ok;
      if (!r.ok) status.azureDevops.error = `HTTP ${r.status}`;
    } catch (e: unknown) { status.azureDevops.error = e instanceof Error ? e.message : String(e); }
  }

  // Dell / Lenovo — configured if creds present, but NOT yet wired into the app, so
  // never reported "connected" (no live verification).
  if (process.env.DELL_CLIENT_ID && process.env.DELL_CLIENT_SECRET) {
    status.dell.configured = true;
    status.dell.error = "configured but not integrated yet";
  }
  if (process.env.LENOVO_CLIENT_ID) {
    status.lenovo.configured = true;
    status.lenovo.error = "configured but not integrated yet";
  }

  const cache = getCacheStats();
  const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE !== "false";

  return NextResponse.json({ demoMode, services: status, cache });
}
