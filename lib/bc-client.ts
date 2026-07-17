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
    // Loop, never push(...page): a 20k-row page as spread arguments can blow the
    // call stack ("Maximum call stack size exceeded").
    for (const v of data.value || []) results.push(v);
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
  )}&$select=number,vendorName,vendorNumber,totalAmountExcludingTax,totalAmountIncludingTax,postingDate,dueDate,status`;
  return fetchAllPages<Record<string, unknown>>(url, token);
}

// Group turnover for the IT-spend-as-%-of-revenue benchmark. Belgian PCMN class
// 70 = "Omzet / Turnover" (credit-normal). Returns the period revenue
// (credits − debits) for one company. NOTE: gross — includes intercompany.
export async function fetchBCRevenue(
  companyId: string,
  dateFrom: string,
  dateTo: string
): Promise<number> {
  const token = await getBCToken();
  const filter = `postingDate ge ${dateFrom} and postingDate le ${dateTo} and startswith(accountNumber,'70')`;
  const url = `${BC_BASE_URL}/companies(${companyId})/generalLedgerEntries?$filter=${encodeURIComponent(
    filter
  )}&$select=debitAmount,creditAmount`;
  const rows = await fetchAllPages<Record<string, unknown>>(url, token);
  return rows.reduce(
    (s, r) => s + (((r.creditAmount as number) || 0) - ((r.debitAmount as number) || 0)),
    0
  );
}

// Internal IT-staff cost: class-62 (personnel) GL entries tagged with the
// AFDELING (department) dimension value "IT". Belgian payroll is booked
// aggregated per account/month, BUT split by the AFDELING dimension — so the IT
// department's fully-loaded cost (gross + employer RSZ + extras) is isolable
// without any HR-system integration. Returns the period cost (debit − credit) for
// one company. The dimension comes via $expand=dimensionSetLines.
export async function fetchITDepartmentPayroll(
  companyId: string,
  dateFrom: string,
  dateTo: string
): Promise<number> {
  const token = await getBCToken();
  const filter = `startswith(accountNumber,'62') and postingDate ge ${dateFrom} and postingDate le ${dateTo}`;
  const url = `${BC_BASE_URL}/companies(${companyId})/generalLedgerEntries?$filter=${encodeURIComponent(
    filter
  )}&$select=debitAmount,creditAmount&$expand=dimensionSetLines($select=code,valueCode)`;
  const rows = await fetchAllPages<Record<string, unknown>>(url, token);
  let total = 0;
  for (const r of rows) {
    const dims = (r.dimensionSetLines as { code?: string; valueCode?: string }[] | undefined) || [];
    // Dimension code varies per company: GSS uses AFDELING, WHS uses AFD.
    // Accept both so IT-tagged payroll outside GSS isn't silently missed.
    if (dims.some((d) => (d.code === "AFDELING" || d.code === "AFD") && d.valueCode === "IT")) {
      total += ((r.debitAmount as number) || 0) - ((r.creditAmount as number) || 0);
    }
  }
  return total;
}

export async function fetchBCAccounts(companyId: string): Promise<Record<string, unknown>[]> {
  const data = await fetchBC(
    `accounts?$filter=category eq 'Expense'&$select=number,displayName,category,subCategory,balance,netChange`,
    companyId
  ) as { value: Record<string, unknown>[] };
  return data.value;
}

// ============================================================
// CFO cockpit data — group financials from the general ledger
// ============================================================
// NOTE: the `accounts` entity's balance/netChange fields are unreliable via the
// API (balance returns 0, netChange is lifetime-cumulative), so the P&L is built
// from posted generalLedgerEntries aggregated per account with a period filter.
// PCMN class 7 = income (credit-normal), class 6 = expenses (debit-normal).

const BC_ODATA_ROOT = `https://api.businesscentral.dynamics.com/v2.0/${process.env.BC_TENANT_ID}/${process.env.BC_ENVIRONMENT || "production"}`;

export interface BCPnlRow {
  accountNumber: string;
  postingDate: string; // "YYYY-MM-DD"
  debit: number;
  credit: number;
}

// Posted P&L movements (classes 6 & 7) for one company over a period. Minimal
// projection; aggregation (by account / month / class) happens in lib/cfo.
export async function fetchBCPnlRows(
  companyId: string,
  dateFrom: string,
  dateTo: string
): Promise<BCPnlRow[]> {
  const token = await getBCToken();
  const out: BCPnlRow[] = [];
  for (const cls of ["6", "7"]) {
    const filter = `postingDate ge ${dateFrom} and postingDate le ${dateTo} and startswith(accountNumber,'${cls}')`;
    const url = `${BC_BASE_URL}/companies(${companyId})/generalLedgerEntries?$filter=${encodeURIComponent(
      filter
    )}&$select=accountNumber,postingDate,debitAmount,creditAmount`;
    const rows = await fetchAllPages<Record<string, unknown>>(url, token);
    for (const r of rows) {
      out.push({
        accountNumber: String(r.accountNumber || ""),
        postingDate: String(r.postingDate || "").slice(0, 10),
        debit: (r.debitAmount as number) || 0,
        credit: (r.creditAmount as number) || 0,
      });
    }
  }
  return out;
}

// number → displayName map, so drill-down can name the source accounts.
export async function fetchBCAccountNames(companyId: string): Promise<Record<string, string>> {
  const data = (await fetchBC(`accounts?$select=number,displayName`, companyId)) as {
    value: { number?: string; displayName?: string }[];
  };
  const m: Record<string, string> = {};
  for (const a of data.value || []) if (a.number) m[a.number] = a.displayName || a.number;
  return m;
}

// Current cash position = net balance of PCMN class 55 (bank) from GL entries.
// (bankAccounts.balance is a FlowField that the API returns as 0.)
export async function fetchBCCashBalance(companyId: string): Promise<number> {
  const token = await getBCToken();
  const url = `${BC_BASE_URL}/companies(${companyId})/generalLedgerEntries?$filter=startswith(accountNumber,'55')&$select=debitAmount,creditAmount`;
  const rows = await fetchAllPages<Record<string, unknown>>(url, token);
  return rows.reduce(
    (s, r) => s + (((r.debitAmount as number) || 0) - ((r.creditAmount as number) || 0)),
    0
  );
}

// Sum of open customer balances (money-in) via the customers master flowfield.
// Best-effort: full AR aging needs the CustomerLedgerEntries web service, which
// is not published in this tenant.
export async function fetchBCCustomerOpen(companyId: string): Promise<number> {
  try {
    const data = (await fetchBC(`customers?$select=balanceDue`, companyId)) as {
      value: { balanceDue?: number }[];
    };
    return (data.value || []).reduce((s, c) => s + (c.balanceDue || 0), 0);
  } catch {
    return 0;
  }
}

export interface BCOpenAPRow {
  oweEUR: number; // positive = we owe
  due: string;    // "YYYY-MM-DD" or ""
  vendor: string;
}

// Open vendor ledger entries (money-out) via the ODataV4 published web service.
// vendorLedgerEntries is NOT in api/v2.0 — only as a published OData V4 service.
// Payable = −Remaining_Amt_LCY (invoice negative, credit/payment positive).
export async function fetchBCOpenAP(companyCode: string): Promise<BCOpenAPRow[]> {
  const token = await getBCToken();
  const out: BCOpenAPRow[] = [];
  let url: string | null =
    `${BC_ODATA_ROOT}/ODataV4/Company('${encodeURIComponent(
      companyCode
    )}')/VendorLedgerEntries?$filter=Open eq true&$select=Remaining_Amt_LCY,Due_Date,Vendor_Name`;
  let page = 0;
  while (url && page < 40) {
    const res: Response = await fetchWithRetry(url, {
      headers: { Authorization: `Bearer ${token}`, "Data-Access-Intent": "ReadOnly", Accept: "application/json" },
    }, { timeoutMs: 90_000, maxAttempts: 2 });
    if (!res.ok) break;
    const data: { value?: Record<string, unknown>[]; "@odata.nextLink"?: string } = await res.json();
    for (const e of data.value || []) {
      const rem = (e.Remaining_Amt_LCY as number) || 0;
      const dueRaw = String(e.Due_Date || "");
      out.push({ oweEUR: -rem, due: dueRaw && !dueRaw.startsWith("0001") ? dueRaw.slice(0, 10) : "", vendor: String(e.Vendor_Name || "") });
    }
    url = data["@odata.nextLink"] || null;
    page++;
  }
  return out;
}

export interface BCOpenARRow {
  amount: number;  // remaining receivable (positive = they owe us)
  due: string;     // "YYYY-MM-DD" or ""
  customer: string;
}

// Open receivables (money-in) from posted sales invoices. salesInvoices carries
// remainingAmount + dueDate + customerName, so full AR aging works WITHOUT the
// (unpublished) CustomerLedgerEntries service. Credit memos are not netted here.
export async function fetchBCOpenAR(companyId: string): Promise<BCOpenARRow[]> {
  const token = await getBCToken();
  const url = `${BC_BASE_URL}/companies(${companyId})/salesInvoices?$filter=${encodeURIComponent(
    "status eq 'Open'"
  )}&$select=remainingAmount,dueDate,customerName`;
  const rows = await fetchAllPages<Record<string, unknown>>(url, token);
  return rows.map((r) => {
    const d = String(r.dueDate || "");
    return {
      amount: (r.remainingAmount as number) || 0,
      due: d && !d.startsWith("0001") ? d.slice(0, 10) : "",
      customer: String(r.customerName || ""),
    };
  });
}

// Full-history net balance (debit − credit) per GL account for one company — the
// heavy pull that backs the materialized snapshot (POST /api/cfo/refresh-snapshot).
// Pages the ENTIRE ledger (no $top), so run it as a background/nightly job.
export async function fetchBCGlNetByAccount(companyId: string): Promise<Record<string, number>> {
  const token = await getBCToken();
  const url = `${BC_BASE_URL}/companies(${companyId})/generalLedgerEntries?$select=accountNumber,debitAmount,creditAmount`;
  const rows = await fetchAllPages<Record<string, unknown>>(url, token);
  const m: Record<string, number> = {};
  for (const r of rows) {
    const a = String(r.accountNumber || "");
    if (!a) continue;
    m[a] = (m[a] || 0) + (((r.debitAmount as number) || 0) - ((r.creditAmount as number) || 0));
  }
  return m;
}

// Cumulative net balance (debit − credit) of all GL accounts under a class prefix.
// Used for the condensed balance sheet: '1' equity/provisions, '2' fixed assets,
// '3' inventory. NOTE: broad prefixes like '4'/'5' can exceed the row cap and are
// better served from the materialized snapshot — keep prefixes narrow.
export async function fetchBCClassNetBalance(companyId: string, prefix: string): Promise<number> {
  const token = await getBCToken();
  const url = `${BC_BASE_URL}/companies(${companyId})/generalLedgerEntries?$filter=${encodeURIComponent(
    `startswith(accountNumber,'${prefix}')`
  )}&$select=debitAmount,creditAmount`;
  const rows = await fetchAllPages<Record<string, unknown>>(url, token);
  return rows.reduce((s, r) => s + (((r.debitAmount as number) || 0) - ((r.creditAmount as number) || 0)), 0);
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
