import { ConfidentialClientApplication } from "@azure/msal-node";
import type { M365License, ManagedDevice, EntraUser } from "./types";
import { SKU_NAMES, DEFAULT_LICENSE_PRICES } from "./constants";
import { fetchWithRetry } from "./http";

let msalClient: ConfidentialClientApplication | null = null;

function getMsalClient(): ConfidentialClientApplication {
  if (!msalClient) {
    msalClient = new ConfidentialClientApplication({
      auth: {
        clientId: process.env.BC_CLIENT_ID || "",
        clientSecret: process.env.BC_CLIENT_SECRET || "",
        authority: `https://login.microsoftonline.com/${process.env.BC_TENANT_ID || ""}`,
      },
    });
  }
  return msalClient;
}

export async function getGraphToken(): Promise<string> {
  const client = getMsalClient();
  const result = await client.acquireTokenByClientCredential({
    scopes: ["https://graph.microsoft.com/.default"],
  });
  if (!result?.accessToken) throw new Error("Failed to acquire Graph token");
  return result.accessToken;
}

async function fetchGraph(endpoint: string): Promise<unknown> {
  const token = await getGraphToken();
  const response = await fetchWithRetry(`https://graph.microsoft.com/v1.0${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`Graph API error: ${response.status}`);
  return response.json();
}

async function fetchAllGraphPages<T>(url: string, token: string): Promise<T[]> {
  const results: T[] = [];
  let nextUrl: string | null = url;
  while (nextUrl) {
    const res: Response = await fetchWithRetry(nextUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Graph API ${res.status}: ${await res.text()}`);
    const data: { value?: T[]; "@odata.nextLink"?: string } = await res.json();
    results.push(...(data.value || []));
    nextUrl = data["@odata.nextLink"] || null;
  }
  return results;
}

export async function fetchSubscribedSkus(): Promise<Record<string, unknown>[]> {
  const data = await fetchGraph("/subscribedSkus") as { value: Record<string, unknown>[] };
  return data.value;
}

/**
 * Entra ID (Azure AD) users with account state + license count — for
 * license-reclaim / orphaned-account reconciliation. Uses the existing Graph
 * app registration (User.Read.All). Sign-in activity is NOT included (needs
 * AuditLog.Read.All, not granted).
 */
export async function fetchEntraUsers(): Promise<EntraUser[]> {
  const token = await getGraphToken();
  type GraphUser = {
    id: string; displayName?: string; userPrincipalName?: string; mail?: string | null;
    accountEnabled?: boolean; assignedLicenses?: { skuId: string }[];
  };
  const raw = await fetchAllGraphPages<GraphUser>(
    "https://graph.microsoft.com/v1.0/users?$top=999&$select=id,displayName,userPrincipalName,mail,accountEnabled,assignedLicenses",
    token
  );
  return raw.map((u) => ({
    id: u.id,
    displayName: u.displayName || "",
    userPrincipalName: u.userPrincipalName || "",
    mail: u.mail ?? null,
    accountEnabled: u.accountEnabled !== false,
    licenseCount: (u.assignedLicenses || []).length,
  }));
}

// Split one CSV line, honouring double-quoted fields (which may contain commas).
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === "," && !inQ) {
      out.push(cur); cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

// Active-to-provisioned usage (FinOps): of the licensed M365 users, how many were
// actually active in the last 30 days. Uses the Office 365 active-user DETAIL
// report, which Graph returns as CSV (it rejects $format=application/json with a
// 400). Requires the APPLICATION permission `Reports.Read.All` + admin consent;
// returns null gracefully if that's missing or the report is empty.
export async function fetchM365ActiveUsage(): Promise<{ active: number; licensed: number } | null> {
  try {
    const token = await getGraphToken();
    const res = await fetchWithRetry(
      "https://graph.microsoft.com/v1.0/reports/getOffice365ActiveUserDetail(period='D30')",
      { headers: { Authorization: `Bearer ${token}` } },
      { timeoutMs: 60_000, maxAttempts: 2 }
    );
    if (!res.ok) return null;
    const csv = (await res.text()).replace(/^﻿/, "");
    const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return null;
    const header = splitCsvLine(lines[0]);
    const assignedIdx = header.findIndex((h) => /assigned products/i.test(h));
    const deletedIdx = header.findIndex((h) => /^is deleted/i.test(h));
    const activityIdxs = header.map((h, i) => (/last activity date/i.test(h) ? i : -1)).filter((i) => i >= 0);
    if (assignedIdx < 0 || activityIdxs.length === 0) return null;
    let licensed = 0;
    let active = 0;
    for (let r = 1; r < lines.length; r++) {
      const cols = splitCsvLine(lines[r]);
      if (deletedIdx >= 0 && /true/i.test(cols[deletedIdx] || "")) continue;
      if (!(cols[assignedIdx] || "").trim()) continue; // only licensed users
      licensed += 1;
      if (activityIdxs.some((i) => (cols[i] || "").trim().length > 0)) active += 1;
    }
    return licensed > 0 ? { active, licensed } : null;
  } catch {
    return null;
  }
}

export async function fetchManagedDevices(): Promise<Record<string, unknown>[]> {
  const token = await getGraphToken();
  // chassisType is not a valid Graph v1.0 field — removed from $select
  return fetchAllGraphPages<Record<string, unknown>>(
    "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$select=id,deviceName,model,manufacturer,serialNumber,osVersion,enrolledDateTime,complianceState,managedDeviceOwnerType,operatingSystem,userDisplayName",
    token
  );
}

export async function fetchUsers(): Promise<Record<string, unknown>[]> {
  const token = await getGraphToken();
  return fetchAllGraphPages<Record<string, unknown>>(
    "https://graph.microsoft.com/v1.0/users?$select=displayName,assignedLicenses,accountEnabled&$top=999",
    token
  );
}

// ---- Mapping helpers ----

export function mapGraphLicenseToM365License(
  sku: Record<string, unknown>
): M365License {
  const skuPartNumber = (sku.skuPartNumber as string) || "";
  const skuId = (sku.skuId as string) || "";
  const prepaidUnitsObj = sku.prepaidUnits as
    | { enabled?: number }
    | undefined;
  const prepaidUnits = prepaidUnitsObj?.enabled ?? 0;
  const consumedUnits = (sku.consumedUnits as number) || 0;
  const displayName =
    SKU_NAMES[skuPartNumber] || skuPartNumber.replace(/_/g, " ");
  const pricePerUser = DEFAULT_LICENSE_PRICES[skuPartNumber] ?? 0;
  const utilizationRate =
    prepaidUnits > 0 ? (consumedUnits / prepaidUnits) * 100 : 0;
  const wastedUnits = Math.max(0, prepaidUnits - consumedUnits);
  const wastedCost = wastedUnits * pricePerUser;
  // Recurring bill = what's COMMITTED (purchased seats), not just what's in use —
  // you pay for the whole prepaid pool. monthlyCost = prepaidUnits × price; the
  // unused portion is captured separately as wastedCost.
  const monthlyCost = prepaidUnits * pricePerUser;

  return {
    skuId,
    skuPartNumber,
    displayName,
    prepaidUnits,
    consumedUnits,
    utilizationRate,
    pricePerUser,
    monthlyCost,
    wastedUnits,
    wastedCost,
  };
}

export function mapGraphDeviceToManagedDevice(
  device: Record<string, unknown>
): ManagedDevice {
  const enrolledDateTime = (device.enrolledDateTime as string) || "";
  const enrolledDate = enrolledDateTime ? new Date(enrolledDateTime) : new Date();
  const ageMs = Date.now() - enrolledDate.getTime();
  const ageYears =
    Math.round((ageMs / (365.25 * 24 * 60 * 60 * 1000)) * 10) / 10;

  const os = ((device.operatingSystem as string) || "").toLowerCase();
  const chassisType: ManagedDevice["chassisType"] =
    os.includes("ios") || os.includes("iphone") ? "phone"
    : os.includes("ipad") ? "tablet"
    : os.includes("android") ? "phone"
    : os.includes("mac") ? "laptop"
    : "unknown";

  const complianceRaw = (device.complianceState as string) || "unknown";
  const validCompliance: ManagedDevice["complianceState"][] = [
    "compliant",
    "noncompliant",
    "unknown",
  ];
  const complianceState: ManagedDevice["complianceState"] =
    validCompliance.includes(
      complianceRaw as ManagedDevice["complianceState"]
    )
      ? (complianceRaw as ManagedDevice["complianceState"])
      : "unknown";

  const ownerRaw = (device.managedDeviceOwnerType as string) || "company";
  const managedDeviceOwnerType: ManagedDevice["managedDeviceOwnerType"] =
    ownerRaw === "personal" ? "personal" : "company";

  return {
    id: (device.id as string) || "",
    deviceName: (device.deviceName as string) || "",
    model: (device.model as string) || "",
    manufacturer: (device.manufacturer as string) || "",
    serialNumber: (device.serialNumber as string) || "",
    osVersion: (device.osVersion as string) || "",
    operatingSystem: (device.operatingSystem as string) || "",
    enrolledDateTime,
    complianceState,
    managedDeviceOwnerType,
    chassisType,
    ageYears,
    assignedUser: (device.userDisplayName as string) || "",
  };
}
