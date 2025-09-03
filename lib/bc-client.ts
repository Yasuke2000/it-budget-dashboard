import { ConfidentialClientApplication } from "@azure/msal-node";

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

export async function fetchBC(endpoint: string, companyId: string): Promise<any> {
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

export async function fetchBCCompanies(): Promise<any[]> {
  const token = await getBCToken();
  const response = await fetch(`${BC_BASE_URL}/companies`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`BC API error: ${response.status}`);
  const data = await response.json();
  return data.value;
}

export async function fetchBCInvoices(
  companyId: string,
  dateFrom: string,
  dateTo: string
): Promise<any[]> {
  const filter = `postingDate ge ${dateFrom} and postingDate le ${dateTo}`;
  const data = await fetchBC(
    `purchaseInvoices?$filter=${encodeURIComponent(filter)}&$expand=purchaseInvoiceLines&$orderby=postingDate desc`,
    companyId
  );
  return data.value;
}

export async function fetchBCGLEntries(
  companyId: string,
  dateFrom: string,
  dateTo: string
): Promise<any[]> {
  const filter = `postingDate ge ${dateFrom} and postingDate le ${dateTo}`;
  const data = await fetchBC(
    `generalLedgerEntries?$filter=${encodeURIComponent(filter)}&$select=postingDate,accountNumber,description,debitAmount,creditAmount,documentType&$orderby=postingDate desc`,
    companyId
  );
  return data.value;
}

export async function fetchBCAccounts(companyId: string): Promise<any[]> {
  const data = await fetchBC(
    `accounts?$filter=category eq 'Expense'&$select=number,displayName,category,subCategory,balance,netChange`,
    companyId
  );
  return data.value;
}
