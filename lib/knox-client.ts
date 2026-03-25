// Samsung Knox API Client
// Docs: https://docs.samsungknox.com/
// Auth: JWT Bearer token from Knox Cloud API

interface KnoxDevice {
  deviceId: string;
  deviceName: string;
  model: string;
  serialNumber: string;
  imei: string;
  osVersion: string;
  knoxVersion: string;
  enrollmentDate: string;
  lastSeen: string;
  batteryHealth: number;
  storageUsed: number;
  storageTotal: number;
  complianceStatus: "compliant" | "non_compliant" | "pending";
  mdmStatus: "enrolled" | "unenrolled" | "pending";
  assignedUser: string;
}

interface KnoxLicense {
  licenseId: string;
  licenseName: string;
  totalSeats: number;
  usedSeats: number;
  expirationDate: string;
}

async function getKnoxToken(): Promise<string> {
  const clientId = process.env.KNOX_CLIENT_ID;
  const clientSecret = process.env.KNOX_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Knox credentials not configured");

  // Knox uses a signed JWT for auth
  // In production, you'd generate a JWT signed with your Knox API key
  // For now, use the client credentials approach
  const response = await fetch("https://eu-kcs-api.samsungknox.com/iam/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientIdentifier: clientId,
      clientSecret: clientSecret,
    }),
  });

  if (!response.ok) throw new Error(`Knox auth failed: ${response.status}`);
  const data = await response.json();
  return data.accessToken;
}

async function fetchKnox(endpoint: string): Promise<unknown> {
  const token = await getKnoxToken();
  const response = await fetch(`https://eu-kcs-api.samsungknox.com${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`Knox API error: ${response.status}`);
  return response.json();
}

export async function fetchKnoxDevices(): Promise<KnoxDevice[]> {
  const data = await fetchKnox("/emm/v1/devices") as { devices?: Record<string, unknown>[] };
  return (data.devices || []).map((d) => ({
    deviceId: (d.deviceId as string) || "",
    deviceName: (d.deviceName as string) || (d.model as string) || "",
    model: (d.model as string) || "",
    serialNumber: (d.serialNumber as string) || "",
    imei: (d.imei as string) || "",
    osVersion: (d.osVersion as string) || "",
    knoxVersion: (d.knoxVersion as string) || "",
    enrollmentDate: (d.enrollmentDate as string) || "",
    lastSeen: (d.lastSeen as string) || "",
    batteryHealth: (d.batteryHealth as number) || 0,
    storageUsed: (d.storageUsed as number) || 0,
    storageTotal: (d.storageTotal as number) || 0,
    complianceStatus: (d.complianceStatus as KnoxDevice["complianceStatus"]) || "pending",
    mdmStatus: (d.mdmStatus as KnoxDevice["mdmStatus"]) || "pending",
    assignedUser: (d.assignedUser as string) || "",
  }));
}

export async function fetchKnoxLicenses(): Promise<KnoxLicense[]> {
  const data = await fetchKnox("/kcs/v1/licenses") as { licenses?: Record<string, unknown>[] };
  return (data.licenses || []).map((l) => ({
    licenseId: (l.licenseId as string) || "",
    licenseName: (l.licenseName as string) || "",
    totalSeats: (l.totalSeats as number) || 0,
    usedSeats: (l.usedSeats as number) || 0,
    expirationDate: (l.expirationDate as string) || "",
  }));
}

export type { KnoxDevice, KnoxLicense };
