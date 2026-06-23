import { ConfidentialClientApplication } from "@azure/msal-node";
import type { PurchaseInvoice, PurchaseInvoiceLine } from "./types";
import { fetchWithRetry } from "./http";
import { IT_GL_ACCOUNTS, IT_DEPRECIATION_ACCOUNTS } from "./constants";

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
  if (!process.env.BC_CLIENT_ID || !process.env.BC_CLIENT_SECRET || !process.env.BC_TENANT_ID) {
    throw new Error("Business Central credentials not configured");
  }
  const client = getMsalClient();
  const result = await client.acquireTokenByClientCredential({
    scopes: ["https://api.businesscentral.dynamics.com/.default"],
  });
  if (!result?.accessToken) throw new Error("Failed to acquire BC token");
  return result.accessToken;
}

const BC_BASE_URL = `https://api.businesscentral.dynamics.com/v2.0/${process.env.BC_TENANT_ID}/${process.env.BC_ENVIRONMENT || "production"}/api/v2.0`;

// --- OData pagination helper ---
// BC allows 6000 requests / 5 min. With 4 entities on a daily sync we make ~200
// calls, so instead of a request-blocking throttle we let fetchWithRetry honour
// the 429 Retry-After header on the rare occasion we're limited.
async function fetchAllPages<T>(url: string, token: string): Promise<T[]> {
  const results: T[] = [];
  let nextUrl: string | null = url;
  while (nextUrl) {
    const res = await fetchWithRetry(nextUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Data-Access-Intent": "ReadOnly",
        Accept: "application/json",
      },
    }, { timeoutMs: 90_000, maxAttempts: 2 });
    if (!res.ok) throw new Error(`BC API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    results.push(...(data.value || []));
    nextUrl = data["@odata.nextLink"] || null;
  }
  return results;
}

export async function fetchBC(endpoint: string, companyId: string): Promise<unknown> {
  const token = await getBCToken();
  const url = `${BC_BASE_URL}/companies(${companyId})/${endpoint}`;
  const response = await fetchWithRetry(url, {
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
  const response = await fetchWithRetry(`${BC_BASE_URL}/companies`, {
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
  const url = `${BC_BASE_URL}/companies(${companyId})/generalLedgerEntries?$filter=${encodeURIComponent(filter)}&$select=id,postingDate,accountNumber,description,debitAmount,creditAmount,documentType,documentNumber&$orderby=postingDate desc`;
  return fetchAllPages<Record<string, unknown>>(url, token);
}

// IT spend source. Purchase-invoice lines can't be filtered server-side by
// G/L account (the line endpoint requires a document id) and pulling every
// purchase invoice with $expand is ~46k rows per sync — far too slow. Instead
// we read posted generalLedgerEntries restricted to the handful of IT accounts.
// This returns only a few thousand rows across all companies and runs in ~2s.
export async function fetchBCLedgerByAccounts(
  companyId: string,
  dateFrom: string,
  dateTo: string,
  accounts: string[]
): Promise<Record<string, unknown>[]> {
  if (!accounts.length) return [];
  const token = await getBCToken();
  const acctFilter = "(" + accounts.map((a) => `accountNumber eq '${a}'`).join(" or ") + ")";
  const filter = `postingDate ge ${dateFrom} and postingDate le ${dateTo} and ${acctFilter}`;
  const url = `${BC_BASE_URL}/companies(${companyId})/generalLedgerEntries?$filter=${encodeURIComponent(
    filter
  )}&$select=id,postingDate,accountNumber,description,debitAmount,creditAmount,documentType,documentNumber&$orderby=postingDate desc`;
  return fetchAllPages<Record<string, unknown>>(url, token);
}

export async function fetchBCITLedgerEntries(
  companyId: string,
  dateFrom: string,
  dateTo: string
): Promise<Record<string, unknown>[]> {
  return fetchBCLedgerByAccounts(companyId, dateFrom, dateTo, IT_GL_ACCOUNTS);
}

// Depreciation of IT assets — reported separately from IT spend.
export async function fetchBCDepreciationEntries(
  companyId: string,
  dateFrom: string,
  dateTo: string
): Promise<Record<string, unknown>[]> {
  return fetchBCLedgerByAccounts(companyId, dateFrom, dateTo, IT_DEPRECIATION_ACCOUNTS);
}

// Posted purchase-invoice headers (no lines) for a date range. Used to map a
// G/L entry's documentNumber → the real vendor name, since G/L entries don't
// carry the vendor. Header-only fetch is cheap (~0.6s / ~700KB for the largest
// company) and is cached + warmed.
export async function fetchBCPurchaseInvoiceHeaders(
  companyId: string,
  dateFrom: string,
  dateTo: string
): Promise<Record<string, unknown>[]> {
  const token = await getBCToken();
  const filter = `postingDate ge ${dateFrom} and postingDate le ${dateTo}`;
  const url = `${BC_BASE_URL}/companies(${companyId})/purchaseInvoices?$filter=${encodeURIComponent(
    filter
  )}&$select=number,vendorName,vendorNumber,totalAmountExcludingTax,postingDate`;
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
