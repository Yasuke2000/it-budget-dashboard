import { ConfidentialClientApplication } from "@azure/msal-node";
import type { PurchaseInvoice, PurchaseInvoiceLine } from "./types";

const msalConfig = {
  auth: {
    clientId: process.env.BC_CLIENT_ID || "",
    clientSecret: process.env.BC_CLIENT_SECRET || "",
    authority: `https://login.microsoftonline.com/${process.env.BC_TENANT_ID || ""}`,
  },
};

let msalClient: ConfidentialClientApplication | null = null;

function getMsalClient(): ConfidentialClientApplication {
  if (!msalClient) {
    msalClient = new ConfidentialClientApplication(msalConfig);
  }
  return msalClient;
}

export async function getBCToken(): Promise<string> {
  const client = getMsalClient();
  const result = await client.acquireTokenByClientCredential({
    scopes: ["https://api.businesscentral.dynamics.com/.default"],
  });
  if (!result?.accessToken) throw new Error("Failed to acquire BC token");
  return result.accessToken;
}

const BC_BASE_URL = `https://api.businesscentral.dynamics.com/v2.0/${process.env.BC_TENANT_ID}/${process.env.BC_ENVIRONMENT || "production"}/api/v2.0`;

// --- Rate limiter (BC allows 6000 req/5min, we stay under at 5500) ---
let requestCount = 0;
let windowStart = Date.now();
async function rateLimitedFetch(url: string, headers: Record<string, string>): Promise<Response> {
  if (Date.now() - windowStart > 300000) { requestCount = 0; windowStart = Date.now(); }
  if (requestCount >= 5500) { await new Promise(r => setTimeout(r, 60000)); requestCount = 0; windowStart = Date.now(); }
  requestCount++;
  return fetch(url, { headers });
}

// --- OData pagination helper ---
async function fetchAllPages<T>(url: string, token: string): Promise<T[]> {
  const results: T[] = [];
  let nextUrl: string | null = url;
  while (nextUrl) {
    const res = await rateLimitedFetch(nextUrl, {
      Authorization: `Bearer ${token}`,
      'Data-Access-Intent': 'ReadOnly',
      Accept: 'application/json',
    });
    if (!res.ok) throw new Error(`BC API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    results.push(...(data.value || []));
    nextUrl = data['@odata.nextLink'] || null;
  }
  return results;
}

export async function fetchBC(endpoint: string, companyId: string): Promise<unknown> {
  const token = await getBCToken();
  const url = `${BC_BASE_URL}/companies(${companyId})/${endpoint}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Data-Access-Intent": "ReadOnly",
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`BC API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export async function fetchBCCompanies(): Promise<Record<string, unknown>[]> {
  const token = await getBCToken();
  const response = await fetch(`${BC_BASE_URL}/companies`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`BC API error: ${response.status}`);
  const data = await response.json() as { value: Record<string, unknown>[] };
  return data.value;
}

export async function fetchBCInvoices(
  companyId: string,
  dateFrom: string,
  dateTo: string
): Promise<Record<string, unknown>[]> {
  const token = await getBCToken();
  const filter = `postingDate ge ${dateFrom} and postingDate le ${dateTo}`;
  const url = `${BC_BASE_URL}/companies(${companyId})/purchaseInvoices?$filter=${encodeURIComponent(filter)}&$expand=purchaseInvoiceLines&$orderby=postingDate desc`;
  return fetchAllPages<Record<string, unknown>>(url, token);
}

export async function fetchBCGLEntries(
  companyId: string,
  dateFrom: string,
  dateTo: string
): Promise<Record<string, unknown>[]> {
  const token = await getBCToken();
  const filter = `postingDate ge ${dateFrom} and postingDate le ${dateTo}`;
  const url = `${BC_BASE_URL}/companies(${companyId})/generalLedgerEntries?$filter=${encodeURIComponent(filter)}&$select=postingDate,accountNumber,description,debitAmount,creditAmount,documentType&$orderby=postingDate desc`;
  return fetchAllPages<Record<string, unknown>>(url, token);
}

export async function fetchBCAccounts(companyId: string): Promise<Record<string, unknown>[]> {
  const data = await fetchBC(
    `accounts?$filter=category eq 'Expense'&$select=number,displayName,category,subCategory,balance,netChange`,
    companyId
  ) as { value: Record<string, unknown>[] };
  return data.value;
}

// --- BC API response → typed PurchaseInvoice mapper ---
export function mapBCInvoiceToPurchaseInvoice(
  raw: Record<string, unknown>,
  companyId: string,
  companyName: string
): PurchaseInvoice {
  const rawLines = (raw.purchaseInvoiceLines as Record<string, unknown>[] | undefined) || [];
  const lines: PurchaseInvoiceLine[] = rawLines.map((l) => ({
    lineType: (l.lineType as string) || "",
    description: (l.description as string) || "",
    unitCost: (l.unitCost as number) || 0,
    quantity: (l.quantity as number) || 0,
    netAmount: (l.netAmount as number) || 0,
    accountId: (l.accountId as string) || "",
    accountNumber: (l.accountNumber as string) || "",
  }));

  return {
    id: (raw.id as string) || "",
    number: (raw.number as string) || "",
    invoiceDate: (raw.invoiceDate as string) || "",
    postingDate: (raw.postingDate as string) || "",
    dueDate: (raw.dueDate as string) || "",
    vendorNumber: (raw.vendorNumber as string) || "",
    vendorName: (raw.vendorName as string) || "",
    totalAmountExcludingTax: (raw.totalAmountExcludingTax as number) || 0,
    totalAmountIncludingTax: (raw.totalAmountIncludingTax as number) || 0,
    totalTaxAmount: (raw.totalTaxAmount as number) || 0,
    status: mapInvoiceStatus(raw.status as string),
    currencyCode: (raw.currencyCode as string) || "",
    companyId,
    companyName,
    costCategory: "", // to be enriched by GL mapping logic
    lines,
  };
}

function mapInvoiceStatus(status: string | undefined): PurchaseInvoice["status"] {
  switch (status?.toLowerCase()) {
    case "draft": return "Draft";
    case "open": return "Open";
    case "paid": return "Paid";
    case "canceled":
    case "cancelled": return "Canceled";
    default: return "Open";
  }
}
