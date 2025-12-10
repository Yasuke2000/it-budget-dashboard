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

async function fetchOfficient(endpoint: string): Promise<any> {
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
  const data = await fetchOfficient("/people?include_inactive=false");
  return (data.data || []).map((p: any) => ({
    id: p.id,
    name: `${p.first_name} ${p.last_name}`,
    email: p.email || "",
    department: p.department?.name || "Unknown",
    function_title: p.function_description || p.function_title || "",
    start_date: p.start_date || "",
    status: p.status === "active" ? "active" : "inactive",
  }));
}

export async function fetchTeams(): Promise<OfficientTeam[]> {
  const data = await fetchOfficient("/teams");
  return (data.data || []).map((t: any) => ({
    id: t.id,
    name: t.name,
    manager_id: t.manager_id,
    member_count: t.people_count || 0,
  }));
}

export async function fetchAssets(): Promise<OfficientAsset[]> {
  const data = await fetchOfficient("/assets");
  return (data.data || []).map((a: any) => ({
    id: a.id,
    person_id: a.person_id,
    name: a.name,
    description: a.description || "",
    category: a.category || "Other",
  }));
}

export async function fetchWageData(
  personId: number
): Promise<{ grossMonthly: number; totalCost: number } | null> {
  try {
    const data = await fetchOfficient(`/people/${personId}/current_wage`);
    return {
      grossMonthly: data.data?.gross_monthly || 0,
      totalCost: data.data?.total_cost || 0,
    };
  } catch {
    return null;
  }
}
