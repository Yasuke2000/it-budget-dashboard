import { ConfidentialClientApplication } from "@azure/msal-node";

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

export async function fetchSubscribedSkus(): Promise<Record<string, unknown>[]> {
  const data = await fetchGraph("/subscribedSkus") as { value: Record<string, unknown>[] };
  return data.value;
}

export async function fetchManagedDevices(): Promise<Record<string, unknown>[]> {
  const data = await fetchGraph(
    "/deviceManagement/managedDevices?$select=deviceName,model,manufacturer,serialNumber,osVersion,enrolledDateTime,complianceState,managedDeviceOwnerType,chassisType,operatingSystem"
  ) as { value: Record<string, unknown>[] };
  return data.value;
}

export async function fetchUsers(): Promise<Record<string, unknown>[]> {
  const data = await fetchGraph(
    "/users?$select=displayName,assignedLicenses,accountEnabled&$top=999"
  ) as { value: Record<string, unknown>[] };
  return data.value;
}
