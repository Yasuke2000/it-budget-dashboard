import { ConfidentialClientApplication } from "@azure/msal-node";
import type { M365License, ManagedDevice } from "./types";
import { SKU_NAMES, DEFAULT_LICENSE_PRICES } from "./constants";

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
  const response = await fetch(`https://graph.microsoft.com/v1.0${endpoint}`, {
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
    const res: Response = await fetch(nextUrl, {
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

export async function fetchManagedDevices(): Promise<Record<string, unknown>[]> {
  const token = await getGraphToken();
  return fetchAllGraphPages<Record<string, unknown>>(
    "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$select=deviceName,model,manufacturer,serialNumber,osVersion,enrolledDateTime,complianceState,managedDeviceOwnerType,chassisType,operatingSystem",
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
  const monthlyCost = consumedUnits * pricePerUser;

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

  const chassisRaw = (device.chassisType as string) || "unknown";
  const validChassis: ManagedDevice["chassisType"][] = [
    "desktop",
    "laptop",
    "tablet",
    "phone",
    "unknown",
  ];
  const chassisType: ManagedDevice["chassisType"] = validChassis.includes(
    chassisRaw as ManagedDevice["chassisType"]
  )
    ? (chassisRaw as ManagedDevice["chassisType"])
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
