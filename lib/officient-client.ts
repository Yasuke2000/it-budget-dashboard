// Officient API client
// Docs: https://apidocs.officient.io
// Base URL: https://api.officient.io/1.0/
// Auth: OAuth 2.0

const OFFICIENT_BASE = "https://api.officient.io/1.0";

async function getOfficientToken(): Promise<string> {
  const clientId = process.env.OFFICIENT_CLIENT_ID;
  const clientSecret = process.env.OFFICIENT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Officient credentials not configured");
  }

  const response = await fetch("https://login.officient.io/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) throw new Error(`Officient auth failed: ${response.status}`);
  const data = await response.json();
  return data.access_token;
}

async function fetchOfficient(endpoint: string): Promise<unknown> {
  const token = await getOfficientToken();
  const response = await fetch(`${OFFICIENT_BASE}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`Officient API error: ${response.status}`);
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

export async function fetchEmployees(): Promise<OfficientEmployee[]> {
  const data = await fetchOfficient("/people?include_inactive=false") as { data?: Record<string, unknown>[] };
  return (data.data || []).map((p: Record<string, unknown>) => ({
    id: p.id as number,
    name: `${p.first_name} ${p.last_name}`,
    email: (p.email as string) || "",
    department: (p.department as { name?: string } | undefined)?.name || "Unknown",
    function_title: (p.function_description as string) || (p.function_title as string) || "",
    start_date: (p.start_date as string) || "",
    status: p.status === "active" ? "active" : "inactive",
  }));
}

export async function fetchTeams(): Promise<OfficientTeam[]> {
  const data = await fetchOfficient("/teams") as { data?: Record<string, unknown>[] };
  return (data.data || []).map((t: Record<string, unknown>) => ({
    id: t.id as number,
    name: t.name as string,
    manager_id: (t.manager_id as number | null) ?? null,
    member_count: (t.people_count as number) || 0,
  }));
}

export async function fetchAssets(): Promise<OfficientAsset[]> {
  const data = await fetchOfficient("/assets") as { data?: Record<string, unknown>[] };
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
    const data = await fetchOfficient(`/people/${personId}/current_wage`) as { data?: { gross_monthly?: number; total_cost?: number } };
    return {
      grossMonthly: data.data?.gross_monthly || 0,
      totalCost: data.data?.total_cost || 0,
    };
  } catch {
    return null;
  }
}
