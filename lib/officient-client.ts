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
  // Officient serves its SPA HTML shell (HTTP 200) for unrecognised API paths.
  // Guard so a wrong endpoint surfaces as an error instead of HTML-as-JSON.
  const text = await response.text();
  if (text.trimStart().startsWith("<")) throw new Error(`Officient API returned HTML (not JSON) on ${endpoint} — wrong path?`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Officient API returned non-JSON on ${endpoint}`);
  }
}

/** Paginate an Officient "/…/list" endpoint (30 rows/page, page index from 0). */
async function fetchAllPages(path: string): Promise<Record<string, unknown>[]> {
  const PAGE_SIZE = 30;
  const sep = path.includes("?") ? "&" : "?";
  const out: Record<string, unknown>[] = [];
  for (let page = 0; page < 200; page++) {
    const data = (await fetchOfficient(`${path}${sep}page=${page}`)) as { data?: Record<string, unknown>[] };
    const rows = data.data || [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

export interface OfficientEmployee {
  id: number;
  name: string;
  email: string;
  department: string;
  function_title: string;
  start_date: string;
  status: "active" | "inactive";
}

export interface OfficientAsset {
  id: number;
  person_id: number;
  name: string;
  price: number;
  vendor: string;
  serial_number: string;
}

export interface OfficientTeam {
  id: number;
  name: string;
}

/**
 * Officient person IDs of the internal IT team. Officient's own team tagging
 * (team id 36359 "GSS IT Team") is incomplete and eventually-consistent — a
 * bulk scan of all 254 people drops members intermittently — so we pin the
 * roster by stable person id instead of scanning:
 *   692279 David Delporte (IT Wizard) · 553102 Stijn Vandamme (Sr. ICT Software Developer)
 *   773276 Thibo Haneca (Jobstudent IT) · 788103 Merijn Van Belleghem
 * Edit this list when the team changes.
 */
export const IT_TEAM_PERSON_IDS = [692279, 553102, 773276, 788103];

interface OfficientPersonDetail {
  name?: string;
  email?: string;
  team?: { id?: number; name?: string } | null;
  current_role?: { name?: string } | null;
  employment?: { first_employment_date?: string } | null;
}

async function fetchPersonDetail(id: number): Promise<OfficientPersonDetail | null> {
  try {
    const data = (await fetchOfficient(`/people/${id}/detail`)) as { data?: OfficientPersonDetail };
    return data.data ?? null;
  } catch {
    return null;
  }
}

/**
 * Active roster (id/name/email/company). Cheap — list endpoint only, no
 * per-person detail calls. Used as the group headcount denominator.
 */
export async function fetchRoster(): Promise<{ id: number; name: string; email: string; company: string }[]> {
  const rows = await fetchAllPages("/people/list?include_archived=0");
  return rows.map((p) => ({
    id: p.id as number,
    name: (p.name as string) || "",
    email: (p.email as string) || "",
    company: (p.linked_integration_alias as string) || "",
  }));
}

/**
 * Internal IT team, enriched from /people/{id}/detail for the pinned IDs.
 * NOTE: Officient holds NO wage/salary data for this tenant (payroll runs in
 * EasyPay), so there is no per-person cost — IT salary cost comes from BC.
 */
export async function fetchITTeamMembers(): Promise<OfficientEmployee[]> {
  const details = await Promise.all(
    IT_TEAM_PERSON_IDS.map(async (id) => ({ id, detail: await fetchPersonDetail(id) }))
  );
  return details
    .filter((x) => x.detail)
    .map(({ id, detail }) => ({
      id,
      name: detail!.name || "",
      email: detail!.email || "",
      department: "IT",
      function_title: detail!.current_role?.name || "",
      start_date: detail!.employment?.first_employment_date || "",
      status: "active" as const,
    }));
}

export async function fetchTeams(): Promise<OfficientTeam[]> {
  const rows = await fetchAllPages("/teams/list");
  return rows.map((t) => ({ id: t.id as number, name: (t.name as string) || "" }));
}

export async function fetchAssets(): Promise<OfficientAsset[]> {
  const rows = await fetchAllPages("/assets/list");
  return rows.map((a) => ({
    id: a.id as number,
    person_id: (a.owner as { id?: number } | undefined)?.id ?? 0,
    name: (a.name as string) || "",
    price: parseFloat((a.price as string) || "0") || 0,
    vendor: (a.vendor as string) || "",
    serial_number: (a.serial_number as string) || "",
  }));
}
