// Dell TechDirect + Lenovo eSupport warranty API clients
// Dell: OAuth2 at techdirect.dell.com
// Lenovo: ClientID header at supportapi.lenovo.com

import type { WarrantyInfo } from "./types";

// ====== Dell ======

async function getDellToken(): Promise<string> {
  const clientId = process.env.DELL_CLIENT_ID;
  const clientSecret = process.env.DELL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Dell credentials not configured");

  const response = await fetch("https://apigtwb2c.us.dell.com/auth/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) throw new Error(`Dell auth failed: ${response.status}`);
  const data = await response.json();
  return data.access_token;
}

export async function fetchDellWarranty(serviceTags: string[]): Promise<WarrantyInfo[]> {
  const token = await getDellToken();
  // Dell allows up to 100 service tags per request
  const batches: string[][] = [];
  for (let i = 0; i < serviceTags.length; i += 100) {
    batches.push(serviceTags.slice(i, i + 100));
  }

  const results: WarrantyInfo[] = [];
  for (const batch of batches) {
    const tags = batch.join(",");
    const response = await fetch(
      `https://apigtwb2c.us.dell.com/PROD/sbil/eapi/v5/asset-entitlements?servicetags=${tags}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
    );
    if (!response.ok) continue;
    const data = await response.json();

    for (const asset of data || []) {
      const entitlements = asset.entitlements || [];
      const activeWarranty = entitlements.find((e: unknown) => {
        const entry = e as { endDate?: string };
        return entry.endDate && new Date(entry.endDate) > new Date();
      }) || entitlements[0];

      if (activeWarranty) {
        const endDate = new Date(activeWarranty.endDate);
        const daysRemaining = Math.ceil((endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        results.push({
          serialNumber: asset.serviceTag,
          manufacturer: "Dell",
          model: asset.productLineDescription || asset.productId || "",
          warrantyType: activeWarranty.serviceLevelDescription || activeWarranty.entitlementType || "",
          startDate: activeWarranty.startDate || "",
          endDate: activeWarranty.endDate || "",
          daysRemaining: Math.max(0, daysRemaining),
          status: daysRemaining <= 0 ? "expired" : daysRemaining <= 90 ? "expiring_soon" : "active",
        });
      }
    }
  }
  return results;
}

// ====== Lenovo ======

export async function fetchLenovoWarranty(serialNumbers: string[]): Promise<WarrantyInfo[]> {
  const clientId = process.env.LENOVO_CLIENT_ID;
  if (!clientId) throw new Error("Lenovo credentials not configured");

  const results: WarrantyInfo[] = [];
  for (const serial of serialNumbers) {
    try {
      const response = await fetch(
        `https://supportapi.lenovo.com/v2.5/warranty?serial=${serial}`,
        { headers: { ClientID: clientId, Accept: "application/json" } }
      );
      if (!response.ok) continue;
      const data = await response.json();

      const warranty = data.Warranty?.[0];
      if (warranty) {
        const endDate = new Date(warranty.End);
        const daysRemaining = Math.ceil((endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        results.push({
          serialNumber: serial,
          manufacturer: "Lenovo",
          model: data.Product || "",
          warrantyType: warranty.Name || warranty.Type || "",
          startDate: warranty.Start || "",
          endDate: warranty.End || "",
          daysRemaining: Math.max(0, daysRemaining),
          status: daysRemaining <= 0 ? "expired" : daysRemaining <= 90 ? "expiring_soon" : "active",
        });
      }
    } catch {
      // Skip individual failures
    }
  }
  return results;
}

// ====== Combined ======

export async function fetchAllWarranties(
  devices: Array<{ serialNumber: string; manufacturer: string }>
): Promise<WarrantyInfo[]> {
  const dellSerials = devices
    .filter((d) => d.manufacturer.toLowerCase().includes("dell"))
    .map((d) => d.serialNumber);
  const lenovoSerials = devices
    .filter((d) => d.manufacturer.toLowerCase().includes("lenovo"))
    .map((d) => d.serialNumber);

  const results: WarrantyInfo[] = [];

  if (dellSerials.length > 0 && process.env.DELL_CLIENT_ID) {
    try {
      const dellResults = await fetchDellWarranty(dellSerials);
      results.push(...dellResults);
    } catch (err) {
      console.error("Dell warranty fetch failed:", err);
    }
  }

  if (lenovoSerials.length > 0 && process.env.LENOVO_CLIENT_ID) {
    try {
      const lenovoResults = await fetchLenovoWarranty(lenovoSerials);
      results.push(...lenovoResults);
    } catch (err) {
      console.error("Lenovo warranty fetch failed:", err);
    }
  }

  return results;
}
