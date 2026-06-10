// Officient API client
// Docs: https://apidocs.officient.io
// Base URL: https://api.officient.io/1.0/
//
// Auth — TWO supported options (set whichever you have):
//   1. Personal API token (simplest, recommended for server-to-server):
//      generate at https://app.officient.io/developer and set OFFICIENT_API_TOKEN.
//      Sent directly as `Authorization: Bearer <token>`.
//   2. OAuth2 app: set OFFICIENT_CLIENT_ID + OFFICIENT_CLIENT_SECRET. We exchange
//      them for an access token at the token endpoint and cache it until expiry.
//      (Verify the grant your Officient app uses — adjust OFFICIENT_TOKEN_URL/grant
//      if your tenant differs.)

const OFFICIENT_BASE = "https://api.officient.io/1.0";
const OFFICIENT_TOKEN_URL = process.env.OFFICIENT_TOKEN_URL || "https://api.officient.io/1.0/token";

import { fetchWithRetry } from "./http";

// --- Token cache (avoids re-authenticating on every request) ---
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getOfficientToken(): Promise<string> {
  // Option 1: static personal token — no exchange needed.
  const staticToken = process.env.OFFICIENT_API_TOKEN;
  if (staticToken) return staticToken;

  // Option 2: OAuth2 client credentials, cached until shortly before expiry.
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  const clientId = process.env.OFFICIENT_CLIENT_ID;
  const clientSecret = process.env.OFFICIENT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Officient credentials not configured (set OFFICIENT_API_TOKEN, or OFFICIENT_CLIENT_ID + OFFICIENT_CLIENT_SECRET)"
    );
  }

  const response = await fetchWithRetry(OFFICIENT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) throw new Error(`Officient auth failed: ${response.status} ${await response.text()}`);
  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Officient auth returned no access_token");

  const ttlMs = (data.expires_in ?? 3600) * 1000;
  cachedToken = { value: data.access_token, expiresAt: Date.now() + ttlMs - 60_000 };
  return data.access_token;
}

async function fetchOfficient(endpoint: string): Promise<unknown> {
  const token = await getOfficientToken();
  const response = await fetchWithRetry(`${OFFICIENT_BASE}${endpoint}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Officient API error: ${response.status} on ${endpoint}`);
  return response.json();
}

export interface OfficientEmployee {
  id: number;
  name: string;
  email: string;
  department: string;
  function_title: string;
  start_date: string;
  status: "active" | "inactive";
  monthlyCost?: number;
}

export interface OfficientAsset {
  id: number;
  person_id: number;
  name: string;
  description: string;
  category: string;
}

export interface OfficientTeam {
  id: number;
  name: string;
  manager_id: number | null;
  member_count: number;
}

/**
 * List people. Officient paginates /people/list at 30 items per page (page index
 * starts at 0). We loop until a short page signals the end.
 */
export async function fetchEmployees(): Promise<OfficientEmployee[]> {
  const PAGE_SIZE = 30;
  const out: OfficientEmployee[] = [];
  for (let page = 0; page < 200; page++) {
    const data = (await fetchOfficient(
      `/people/list?page=${page}&include_archived=0`
    )) as { data?: Record<string, unknown>[] };
    const rows = data.data || [];
    for (const p of rows) {
      out.push({
        id: p.id as number,
        name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
        email: (p.email as string) || "",
        department: (p.department as { name?: string } | undefined)?.name || "Unknown",
        function_title: (p.function_description as string) || (p.function_title as string) || "",
        start_date: (p.start_date as string) || "",
        status: p.status === "active" ? "active" : "inactive",
      });
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

export async function fetchTeams(): Promise<OfficientTeam[]> {
  const data = (await fetchOfficient("/teams")) as { data?: Record<string, unknown>[] };
  return (data.data || []).map((t: Record<string, unknown>) => ({
    id: t.id as number,
    name: t.name as string,
    manager_id: (t.manager_id as number | null) ?? null,
    member_count: (t.people_count as number) || 0,
  }));
}

export async function fetchAssets(): Promise<OfficientAsset[]> {
  const data = (await fetchOfficient("/assets")) as { data?: Record<string, unknown>[] };
  return (data.data || []).map((a: Record<string, unknown>) => ({
    id: a.id as number,
    person_id: a.person_id as number,
    name: a.name as string,
    description: (a.description as string) || "",
    category: (a.category as string) || "Other",
  }));
}

export async function fetchWageData(
  personId: number
): Promise<{ grossMonthly: number; totalCost: number } | null> {
  try {
    const data = (await fetchOfficient(`/people/${personId}/current_wage`)) as {
      data?: { gross_monthly?: number; total_cost?: number };
    };
    return {
      grossMonthly: data.data?.gross_monthly || 0,
      totalCost: data.data?.total_cost || 0,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch employer-cost (total_cost) for many people with bounded concurrency,
 * so the personnel KPIs reflect real salary cost instead of zero.
 */
export async function fetchWagesForPeople(
  personIds: number[]
): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  const CONCURRENCY = 5;
  for (let i = 0; i < personIds.length; i += CONCURRENCY) {
    const slice = personIds.slice(i, i + CONCURRENCY);
    const wages = await Promise.all(slice.map((id) => fetchWageData(id)));
    slice.forEach((id, idx) => {
      const wage = wages[idx];
      if (wage) result.set(id, wage.totalCost || wage.grossMonthly || 0);
    });
  }
  return result;
}
