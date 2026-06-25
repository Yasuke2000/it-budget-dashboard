import {
  demoCompanies,
  demoInvoices,
  demoGLEntries,
  demoLicenses,
  demoDevices,
  demoBudgetEntries,
  demoPeppolInvoices,
  demoContracts,
} from "./demo-data";
import type {
  Company,
  PurchaseInvoice,
  GeneralLedgerEntry,
  M365License,
  ManagedDevice,
  BudgetEntry,
  DashboardKPIs,
  MonthlySpend,
  ForecastPoint,
  SpendForecast,
  CategorySpend,
  EntitySpend,
  VendorSummary,
  Contract,
  CompanyFilter,
  Employee,
  JiraWorklog,
  JiraProjectCost,
  PersonnelKPIs,
  DepartmentSummary,
  LicenseHarvest,
} from "./types";
import type { PeppolInvoice } from "./peppol-parser";
import { CATEGORY_COLORS, CONCENTRATION_RISK_THRESHOLD, CONCENTRATION_WATCH_THRESHOLD, DEFAULT_GL_MAPPING, IT_VENDOR_RULES, UNCLASSIFIED_CATEGORY, ALLOWLIST_SCAN_ACCOUNTS, OPERATIONAL_SOFTWARE_VENDORS, OPERATIONAL_SOFTWARE_CATEGORY, isITCategory, isToolsSpendCategory, isIntercompanyVendor, isOperationalSoftwareVendor, normalizeVendor } from "./constants";
import { generateAllInsights } from "./cost-insights";
import type { CostInsight } from "./cost-insights";
import { getCache, setCache } from "./sync-cache";
import { fetchBCCompanies, fetchBCGLEntries, fetchBCLedgerByAccounts, fetchBCDepreciationEntries, fetchBCPurchaseInvoiceHeaders, fetchBCRevenue, fetchITDepartmentPayroll, getBCToken } from "./bc-client";
import { getAppSettings } from "./settings-store";
import {
  fetchSubscribedSkus,
  fetchManagedDevices,
  fetchM365ActiveUsage,
  mapGraphLicenseToM365License,
  mapGraphDeviceToManagedDevice,
} from "./graph-client";
import { fetchJiraWorklogs as fetchLiveJiraWorklogs } from "./jira-client";

export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE !== "false";
}

// Tracks whether the last fetch for a given domain returned LIVE data or fell
// back to demo/sample data (e.g. Graph 401/403, Officient creds missing). Pages
// read this after fetching to show an honest "sample data" banner instead of
// silently presenting demo numbers as real. Module singleton — good enough for
// a per-request banner hint.
export type SourceState = "live" | "empty" | "unknown";
export const sourceStatus: Record<string, SourceState> = {
  invoices: "unknown",
  licenses: "unknown",
  devices: "unknown",
  employees: "unknown",
};

// Business Central exposes several non-operating companies (setup/init copies
// and test entities). They hold no real spend and only slow the sync down, so
// we exclude them from the live company list.
function isOperatingCompany(name: string): boolean {
  return !/^_/.test(name) && !/test|copie|fleetmate/i.test(name);
}

// Single-flight dedup for the live invoice fetch. The dashboard API fans out to
// five getters that each call getInvoices() with the same args on a cold cache;
// without this they would trigger five concurrent BC syncs (the original cause
// of the >60s dashboard timeout). Concurrent callers now share one in-flight
// promise per cache key.
const inflightInvoices = new Map<string, Promise<PurchaseInvoice[]>>();

// Negative cache for Microsoft Graph. Licenses/devices currently 401/403
// (permissions not yet granted) and the Intune endpoint can be slow to reject.
// Without this, every dashboard load makes a fresh failing round-trip to Graph,
// which is the main cause of slow/stuck Overview loads. After a failure we serve
// the demo fallback for a while instead of re-hitting the broken endpoint.
const GRAPH_FAIL_TTL_MS = 30 * 60 * 1000; // 30 min
let graphLicensesFailedUntil = 0;
let graphDevicesFailedUntil = 0;

// Shift an ISO "YYYY-MM-DD" date by N months (UTC; the pod runs UTC). Used to pad
// the purchase-invoice-header window so boundary documents resolve their vendor.
function shiftMonths(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 10);
}

// Merge imported EasyPay payroll into the invoice list as an "IT Personnel" cost
// line, so personnel cost appears in Total Spend, Category breakdown and Vendors.
// Applied on every getInvoices() return path (incl. cache hits) so it's never
// lost to caching. Range/company filtering matches the invoice query.
async function applyPayroll(
  invoices: PurchaseInvoice[],
  companyFilter: CompanyFilter,
  dateFrom?: string,
  dateTo?: string
): Promise<PurchaseInvoice[]> {
  let entries;
  try {
    const { getPayrollEntries } = await import("./payroll-store");
    entries = await getPayrollEntries();
  } catch {
    return invoices;
  }
  if (!entries.length) return invoices;

  const fromMonth = dateFrom?.substring(0, 7);
  const toMonth = dateTo?.substring(0, 7);
  const synthetic: PurchaseInvoice[] = [];
  for (const e of entries) {
    if (companyFilter !== "all" && e.companyId !== "all" && e.companyId !== companyFilter) continue;
    if (fromMonth && e.month < fromMonth) continue;
    if (toMonth && e.month > toMonth) continue;
    const postingDate = `${e.month}-01`;
    const companyId = e.companyId === "all" ? (companyFilter !== "all" ? companyFilter : "all") : e.companyId;
    synthetic.push({
      id: `payroll-${e.source}-${e.companyId}-${e.month}`,
      number: `${e.source.toUpperCase()}-PAYROLL-${e.month}`,
      invoiceDate: postingDate,
      postingDate,
      dueDate: postingDate,
      vendorNumber: "EASYPAY",
      vendorName: `${e.source} (Payroll)`,
      totalAmountExcludingTax: e.amount,
      totalAmountIncludingTax: e.amount,
      totalTaxAmount: 0,
      status: "Paid",
      currencyCode: "EUR",
      companyId,
      companyName: companyId,
      costCategory: "IT Personnel",
      lines: [],
    });
  }
  // NOTE: internal IT-staff cost (Adhemar/David) is intentionally NOT synthesized
  // from a manual figure. BC class-62 wages are aggregated (no IT split), so IT
  // personnel cost will populate only from real EasyPay/Officient payroll data
  // (the entries handled above), never a hardcoded estimate.
  return synthetic.length ? [...invoices, ...synthetic] : invoices;
}

// ---- Companies ----
export async function getCompanies(): Promise<Company[]> {
  if (isDemoMode()) return demoCompanies;

  const cacheKey = "companies";
  const cached = getCache<Company[]>(cacheKey);
  if (cached) return cached;

  try {
    const bcCompanies = await fetchBCCompanies();
    const companies: Company[] = bcCompanies
      .map((c) => ({
        id: (c.id as string) || "",
        name: (c.name as string) || "",
        displayName: (c.displayName as string) || (c.name as string) || "",
      }))
      .filter((c) => isOperatingCompany(c.name));
    setCache(cacheKey, companies, 60 * 24); // 24h TTL
    return companies;
  } catch (err) {
    // Live mode shows real data or nothing — never demo. An empty company list
    // means BC is unreachable, which surfaces as empty dashboards (honest).
    console.warn("BC API error (companies):", err);
    return [];
  }
}

// Map a BC purchase-invoice-header status to our union. "Open" = posted but not
// yet paid (outstanding AP); "Paid" = settled. Unmatched (no header for the GL
// doc, e.g. a journal posting) → "Paid", so it never inflates the open figure.
function mapHeaderStatus(s: string | undefined): PurchaseInvoice["status"] {
  switch ((s || "").toLowerCase()) {
    case "open": return "Open";
    case "draft": return "Draft";
    case "canceled":
    case "cancelled": return "Canceled";
    default: return "Paid";
  }
}

// ---- Invoices ----
export async function getInvoices(
  companyFilter: CompanyFilter = "all",
  dateFrom?: string,
  dateTo?: string
): Promise<PurchaseInvoice[]> {
  if (isDemoMode()) {
    let invoices = demoInvoices;
    if (companyFilter !== "all") {
      invoices = invoices.filter((inv) => inv.companyId === companyFilter);
    }
    if (dateFrom) {
      invoices = invoices.filter((inv) => inv.postingDate >= dateFrom);
    }
    if (dateTo) {
      invoices = invoices.filter((inv) => inv.postingDate <= dateTo);
    }
    return applyPayroll(invoices, companyFilter, dateFrom, dateTo);
  }

  const yr = new Date().getFullYear();
  const from = dateFrom ?? `${yr}-01-01`;
  const to = dateTo ?? `${yr}-12-31`;
  const cacheKey = `invoices-${companyFilter}-${from}-${to}`;
  const cached = getCache<PurchaseInvoice[]>(cacheKey);
  if (cached) return applyPayroll(cached, companyFilter, from, to);

  // Single-flight: share one in-flight fetch per cache key across concurrent callers.
  let flight = inflightInvoices.get(cacheKey);
  if (!flight) {
    flight = (async () => {
      // Surface BC auth/connectivity failure up-front so the caller's catch can
      // fall back to demo data instead of returning an empty live result.
      await getBCToken();
      const companies = await getCompanies();
      const targetCompanies =
        companyFilter === "all"
          ? companies
          : companies.filter((c) => c.id === companyFilter);

      // The IT account→category map is now EDITABLE in Settings (persisted in
      // settings-store, merged over the compiled defaults). We query exactly the
      // mapped accounts and classify by the same map, so adding/removing an
      // account in the UI immediately changes both what's pulled and how it's
      // categorised. Each G/L entry becomes a synthetic "invoice" so all
      // downstream consumers (KPIs, category, monthly, vendors, budget) keep
      // working. Posted-invoice headers give the real vendor name per document.
      // Fall back to compiled defaults if the settings store is unavailable —
      // never empty the dashboard over a settings read.
      let glMapping: Record<string, string>;
      let vendorRules: Record<string, string>;
      let opVendors: string[];
      let includeOp: boolean;
      try {
        const settings = await getAppSettings();
        glMapping = settings.glMappings;
        vendorRules = settings.itVendorRules;
        opVendors = settings.operationalSoftwareVendors;
        includeOp = settings.includeOperationalSoftware;
      } catch {
        glMapping = DEFAULT_GL_MAPPING;
        vendorRules = IT_VENDOR_RULES;
        opVendors = OPERATIONAL_SOFTWARE_VENDORS;
        includeOp = true;
      }
      const itAccounts = Object.keys(glMapping);
      const vendorPatterns = Object.keys(vendorRules);
      // Also pull the "leak" accounts where allowlisted IT vendors (ALLPHI, Canon,
      // iDocta, GMI) land. We count their ACTUAL G/L posting (debit − credit), not
      // the invoice-header total — that's the accurate measure and nets credit
      // notes. Exclude any scan account that's also a mapped IT account.
      const scanAccounts = ALLOWLIST_SCAN_ACCOUNTS.filter((a) => !glMapping[a]);
      const scanSet = new Set(scanAccounts);
      const pullAccounts = [...itAccounts, ...scanAccounts];

      // Vendor names are resolved by matching a G/L entry's documentNumber to a
      // posted purchase-invoice header. A header's postingDate can sit just across
      // a period boundary from the G/L posting (invoice dated 31 Mar, booked 1
      // Apr), so we fetch headers over a PADDED ±2-month window. Without this,
      // boundary documents fail to resolve and their allowlist/intercompany
      // classification flips — making period sums not reconcile (year ≠ Σ quarters).
      const headerFrom = shiftMonths(from, -2);
      const headerTo = shiftMonths(to, 2);

      // Track per-company fetch failures. A single company's GL/header fetch
      // failing (e.g. a transient BC 429/timeout) must NOT be silently treated as
      // "this company spent €0" and then cached as a complete result — that would
      // undercount the total and poison the 2h cache. We still return the partial
      // figure for this request, but refuse to cache it so the next call retries.
      let degraded = false;
      const perCompany = await Promise.all(
        targetCompanies.map(async (company) => {
          const [glEntries, headers] = await Promise.all([
            fetchBCLedgerByAccounts(company.id, from, to, pullAccounts).catch(() => { degraded = true; return [] as Record<string, unknown>[]; }),
            fetchBCPurchaseInvoiceHeaders(company.id, headerFrom, headerTo).catch(() => { degraded = true; return [] as Record<string, unknown>[]; }),
          ]);
          const vendorByDoc = new Map<string, { name: string; number: string; status: string; dueDate: string }>();
          for (const h of headers) {
            const num = (h.number as string) || "";
            // Skip Draft headers (IF-prefix): BC keeps both an unposted Draft and
            // the posted (AF-prefix) copy of the same invoice. The posted GL doc
            // matches the posted header, so the Draft is just a duplicate; ignoring
            // it keeps the paid/open status pointing at the real posted invoice.
            if (num) vendorByDoc.set(num, {
              name: (h.vendorName as string) || "",
              number: (h.vendorNumber as string) || "",
              status: (h.status as string) || "",
              dueDate: (h.dueDate as string) || "",
            });
          }
          return { company, glEntries, vendorByDoc };
        })
      );

      const allInvoices: PurchaseInvoice[] = [];
      for (const { company, glEntries, vendorByDoc } of perCompany) {
        for (const g of glEntries) {
          const accountNumber = (g.accountNumber as string) || "";
          // Spend = debit − credit. This nets out correction/reversal pairs to
          // zero (which we skip) and correctly handles credit notes.
          const amount = ((g.debitAmount as number) || 0) - ((g.creditAmount as number) || 0);
          if (!amount) continue;
          const postingDate = (g.postingDate as string) || "";
          const documentNumber = (g.documentNumber as string) || "";
          const description = (g.description as string) || "";
          const vendor = vendorByDoc.get(documentNumber);
          const vendorName = vendor?.name || description || accountNumber;

          // Skip intercompany recharges (vendor is a Gheeraert-group entity).
          if (isIntercompanyVendor(vendorName)) continue;

          // Classify. Mapped accounts → their IT category. Scan ("leak") accounts
          // → only counted when the vendor is on the allowlist (else it's the
          // non-IT bulk of that account — intercompany, management fees, etc.).
          let costCategory: string;
          if (glMapping[accountNumber]) {
            costCategory = glMapping[accountNumber];
          } else if (scanSet.has(accountNumber)) {
            // Normalised match (punctuation/space-insensitive) so vendor names
            // like "JUST -FIX IT-" still match the rule "just-fix-it".
            const vnorm = normalizeVendor(vendorName);
            const matched = vendorPatterns.find((p) => p && vnorm.includes(normalizeVendor(p)));
            if (!matched) continue; // non-IT spend on a leak account — ignore
            costCategory = vendorRules[matched] || "External IT Services";
          } else {
            continue;
          }

          // Operational/business-system software (TMS/telematics) gets its own
          // category, and is dropped from the IT total entirely when the toggle
          // is off (reclassified to Unclassified, which IT totals exclude).
          if (isOperationalSoftwareVendor(vendorName, opVendors)) {
            costCategory = includeOp ? OPERATIONAL_SOFTWARE_CATEGORY : UNCLASSIFIED_CATEGORY;
          }

          allInvoices.push({
            id: `gl-${company.id}-${(g.id as string) || `${documentNumber}-${accountNumber}-${postingDate}`}`,
            number: documentNumber,
            invoiceDate: postingDate,
            postingDate,
            // Real due date + payment status from the posted-invoice header (BC
            // "Open" = posted but unpaid, "Paid" = settled). Falls back to posting
            // date / Paid when the GL doc has no matching invoice header (e.g. a
            // journal posting), so unmatched lines never inflate the open figure.
            dueDate: vendor?.dueDate || postingDate,
            // Real vendor from the posted-invoice header; fall back to the
            // booking description only if the document can't be matched.
            vendorNumber: vendor?.number || accountNumber,
            vendorName,
            totalAmountExcludingTax: amount,
            totalAmountIncludingTax: amount,
            totalTaxAmount: 0,
            status: mapHeaderStatus(vendor?.status),
            currencyCode: "EUR",
            companyId: company.id,
            companyName: company.displayName,
            costCategory,
            lines: [
              {
                lineType: "Account",
                description,
                unitCost: amount,
                quantity: 1,
                netAmount: amount,
                accountId: "",
                accountNumber,
              },
            ],
          });
        }
      }

      // Only cache COMPLETE results. A partial (degraded) fetch is returned to
      // this caller but not cached, so the next request re-fetches rather than
      // serving an undercounted total for the next 2 hours.
      if (!degraded) {
        setCache(cacheKey, allInvoices, 120); // 2h TTL
      } else {
        console.warn(`BC invoices partial fetch (${cacheKey}) — not caching to avoid undercount`);
      }
      sourceStatus.invoices = degraded ? "empty" : "live";
      return allInvoices;
    })();
    inflightInvoices.set(cacheKey, flight);
    void flight.catch(() => {}).finally(() => {
      if (inflightInvoices.get(cacheKey) === flight) inflightInvoices.delete(cacheKey);
    });
  }

  try {
    const allInvoices = await flight;
    return applyPayroll(allInvoices, companyFilter, from, to);
  } catch (err) {
    // Live mode: real data or empty — never demo invoices.
    console.warn("BC API error (invoices):", err);
    sourceStatus.invoices = "empty";
    return applyPayroll([], companyFilter, from, to);
  }
}

// ---- GL Entries ----
export async function getGLEntries(
  companyFilter: CompanyFilter = "all",
  dateFrom?: string,
  dateTo?: string
): Promise<GeneralLedgerEntry[]> {
  if (isDemoMode()) {
    let entries = demoGLEntries;
    if (companyFilter !== "all") {
      entries = entries.filter((e) => e.companyId === companyFilter);
    }
    if (dateFrom) {
      entries = entries.filter((e) => e.postingDate >= dateFrom);
    }
    if (dateTo) {
      entries = entries.filter((e) => e.postingDate <= dateTo);
    }
    return entries;
  }

  const yr = new Date().getFullYear();
  const from = dateFrom ?? `${yr}-01-01`;
  const to = dateTo ?? `${yr}-12-31`;
  const cacheKey = `gl-entries-${companyFilter}-${from}-${to}`;
  const cached = getCache<GeneralLedgerEntry[]>(cacheKey);
  if (cached) return cached;

  try {
    const companies = await getCompanies();
    const targetCompanies =
      companyFilter === "all"
        ? companies
        : companies.filter((c) => c.id === companyFilter);

    const perCompanyGL = await Promise.all(
      targetCompanies.map(async (company) => {
        try {
          return { company, bcEntries: await fetchBCGLEntries(company.id, from, to) };
        } catch {
          return { company, bcEntries: [] as Record<string, unknown>[] };
        }
      })
    );

    const allEntries: GeneralLedgerEntry[] = [];
    for (const { company, bcEntries } of perCompanyGL) {
      for (const entry of bcEntries) {
        const accountNumber = (entry.accountNumber as string) || "";
        const costCategory =
          DEFAULT_GL_MAPPING[accountNumber] || UNCLASSIFIED_CATEGORY;

        allEntries.push({
          id: (entry.id as number) || 0,
          postingDate: (entry.postingDate as string) || "",
          accountNumber,
          accountName: (entry.accountName as string) || (entry.description as string) || "",
          description: (entry.description as string) || "",
          debitAmount: (entry.debitAmount as number) || 0,
          creditAmount: (entry.creditAmount as number) || 0,
          documentType: (entry.documentType as string) || "",
          documentNumber: (entry.documentNumber as string) || "",
          companyId: company.id,
          companyName: company.displayName,
          costCategory,
        });
      }
    }

    setCache(cacheKey, allEntries, 120); // 2h TTL
    return allEntries;
  } catch (err) {
    console.warn("BC API error (GL entries):", err);
    return [];
  }
}

// ---- Licenses ----
export async function getLicenses(): Promise<M365License[]> {
  if (isDemoMode()) return demoLicenses;

  const cacheKey = "licenses";
  const cached = getCache<M365License[]>(cacheKey);
  if (cached) { sourceStatus.licenses = "live"; return cached; }
  if (Date.now() < graphLicensesFailedUntil) { sourceStatus.licenses = "empty"; return []; }

  try {
    const skus = await fetchSubscribedSkus();
    // Apply per-seat prices entered in Settings (Graph doesn't expose contracted
    // prices) + the optimization buffer, so cost/waste reflect reality.
    let prices: Record<string, number> = {};
    let bufferSeats = 0;
    try {
      const s = await getAppSettings();
      prices = s.licensePrices;
      bufferSeats = s.licenseBufferSeats || 0;
    } catch { /* keep mapper defaults */ }
    const licenses: M365License[] = skus.map((sku) => {
      const lic = mapGraphLicenseToM365License(sku);
      const p = prices[lic.skuPartNumber];
      if (p != null && p !== lic.pricePerUser) {
        lic.pricePerUser = p;
        // Bill the committed (prepaid) pool, not just consumed seats — matches
        // the Microsoft invoice; the unused portion shows up in wastedCost.
        lic.monthlyCost = lic.prepaidUnits * p;
      }
      // Optimization buffer: keep up to `bufferSeats` spare seats per SKU out of
      // the reclaimable-waste figure (you hold a few for new hires). Utilization
      // and purchased/assigned counts are untouched.
      if (bufferSeats > 0) {
        lic.wastedUnits = Math.max(0, lic.wastedUnits - bufferSeats);
      }
      lic.wastedCost = lic.wastedUnits * lic.pricePerUser;
      return lic;
    });
    setCache(cacheKey, licenses, 240); // 4h TTL
    sourceStatus.licenses = "live";
    return licenses;
  } catch (err) {
    // Live mode: real data or empty — never demo. Graph licenses need an
    // *Application* (not Delegated) permission grant; until then this is empty.
    console.warn("Graph API error (licenses):", err);
    sourceStatus.licenses = "empty";
    graphLicensesFailedUntil = Date.now() + GRAPH_FAIL_TTL_MS;
    return [];
  }
}

// ---- Devices ----
export async function getDevices(): Promise<ManagedDevice[]> {
  if (isDemoMode()) return demoDevices;

  const cacheKey = "devices";
  const cached = getCache<ManagedDevice[]>(cacheKey);
  if (cached) { sourceStatus.devices = "live"; return cached; }
  if (Date.now() < graphDevicesFailedUntil) { sourceStatus.devices = "empty"; return []; }

  try {
    const rawDevices = await fetchManagedDevices();
    const devices: ManagedDevice[] = rawDevices.map(mapGraphDeviceToManagedDevice);
    setCache(cacheKey, devices, 240); // 4h TTL
    sourceStatus.devices = "live";
    return devices;
  } catch (err) {
    // Live mode: real data or empty — never demo. Intune needs an *Application*
    // (not Delegated) Graph permission grant; until then this is empty.
    console.warn("Graph API error (devices):", err);
    sourceStatus.devices = "empty";
    graphDevicesFailedUntil = Date.now() + GRAPH_FAIL_TTL_MS;
    return [];
  }
}

// ---- Software Licenses (non-Microsoft / manually tracked) ----
export async function getSoftwareLicenses(): Promise<import("./types").SoftwareLicense[]> {
  try {
    const { getSoftwareLicensesStored } = await import("./software-license-store");
    return await getSoftwareLicensesStored();
  } catch {
    return [];
  }
}

// ---- Contracts ----
// Derive status from the end date so it never drifts: ≤0 days = expired,
// ≤90 days = expiring soon, otherwise active. No end date → active (open-ended).
function contractStatus(endDate: string): Contract["status"] {
  if (!endDate) return "active";
  const days = (new Date(endDate).getTime() - Date.now()) / 86_400_000;
  if (Number.isNaN(days)) return "active";
  if (days < 0) return "expired";
  if (days <= 90) return "expiring_soon";
  return "active";
}

export async function getContracts(): Promise<Contract[]> {
  if (isDemoMode()) return demoContracts;

  // Live: manually-managed contracts/renewals from the contract store (DB or
  // file-backed). Status is computed here from the end date.
  try {
    const { getContractsStored } = await import("./contract-store");
    const stored = await getContractsStored();
    return stored.map((c) => ({ ...c, status: contractStatus(c.endDate) }));
  } catch (err) {
    console.warn("Contract store error:", err);
    return [];
  }
}

// Enumerate "YYYY-MM" month keys from `from` to `to` inclusive.
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.substring(0, 4));
  let m = Number(from.substring(5, 7));
  const endY = Number(to.substring(0, 4));
  const endM = Number(to.substring(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

// ---- Budget ----
export async function getBudgetEntries(
  companyFilter: CompanyFilter = "all",
  dateFrom?: string,
  dateTo?: string
): Promise<BudgetEntry[]> {
  if (isDemoMode()) {
    if (companyFilter !== "all") {
      return demoBudgetEntries.filter((b) => b.companyId === companyFilter || b.companyId === "all");
    }
    return demoBudgetEntries;
  }

  // Live: per-category monthly budgets configured in Settings → Budget, expanded
  // to one entry per category × month of the requested window (defaults to the
  // current calendar year). Empty until set. The window MUST match the date range
  // the KPIs use, or budget vs actual would compare different spans.
  let budgets: Record<string, number> = {};
  try {
    budgets = (await getAppSettings()).budgets;
  } catch {
    return [];
  }
  const cats = Object.keys(budgets).filter((c) => (budgets[c] || 0) > 0);
  if (!cats.length) return [];
  const yr = new Date().getFullYear();
  const from = dateFrom ?? `${yr}-01-01`;
  const to = dateTo ?? `${yr}-12-31`;
  const months = monthsBetween(from, to);
  const entries: BudgetEntry[] = [];
  for (const cat of cats) {
    const monthly = budgets[cat];
    for (const month of months) {
      entries.push({
        id: `bud-${cat}-${month}`,
        category: cat,
        month,
        budgetAmount: monthly,
        actualAmount: 0, // actual is computed from invoices by the consumers
        variance: 0,
        variancePercent: 0,
        companyId: "all",
      });
    }
  }
  return entries;
}

// True when an ISO date "YYYY-MM-DD" is the last calendar day of its month.
function isMonthEnd(d: string): boolean {
  if (!d || d.length < 10) return false;
  const dt = new Date(`${d}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return false;
  const next = new Date(dt);
  next.setUTCDate(dt.getUTCDate() + 1);
  return next.getUTCMonth() !== dt.getUTCMonth();
}

// ---- Dashboard KPIs ----
export async function getDashboardKPIs(
  companyFilter: CompanyFilter = "all",
  dateFrom?: string,
  dateTo?: string
): Promise<DashboardKPIs> {
  const yr = new Date().getFullYear();
  const from = dateFrom ?? `${yr}-01-01`;
  const to = dateTo ?? `${yr}-12-31`;
  const invoices = await getInvoices(companyFilter, from, to);
  // Per-category budgets over the SAME window as the spend (so budget vs actual
  // compare like-for-like). Empty until configured in Settings → Budget.
  const budget = await getBudgetEntries(companyFilter, from, to);
  const licenses = await getLicenses();
  const devices = await getDevices();
  // Depreciation of IT assets — reported separately, never added to IT spend.
  const itDepreciationYTD = await getITDepreciation(companyFilter, from, to);
  // Revenue (for the IT-spend-%-of-revenue benchmark) + active license usage.
  const [grossRevenue, activeUsagePct, settings, itPersonnelCost] = await Promise.all([
    getGroupRevenue(companyFilter, from, to),
    getLicenseActiveUsagePercent(),
    getAppSettings().catch(() => null),
    getITPersonnelCost(companyFilter, from, to).catch(() => 0),
  ]);

  // Headline IT spend = tools & services only: excludes "Unclassified" (non-IT GL
  // accounts) AND "IT Personnel" (internal labour, added separately from BC as
  // itPersonnelCost — counting it here too would double-count it in totalCostOfIT).
  const itInvoices = invoices.filter((inv) => isToolsSpendCategory(inv.costCategory));
  const totalSpendYTD = itInvoices.reduce((sum, inv) => sum + inv.totalAmountExcludingTax, 0);

  // Opex vs capitalised IT purchases (PCMN class 2 = fixed-asset/capex accounts;
  // class 6 = operating expense). For the ~25/75 capex/opex benchmark.
  let capexYTD = 0;
  let opexYTD = 0;
  for (const inv of itInvoices) {
    const acct = inv.lines[0]?.accountNumber || inv.vendorNumber || "";
    if (acct.startsWith("2")) capexYTD += inv.totalAmountExcludingTax;
    else opexYTD += inv.totalAmountExcludingTax;
  }

  // Year-end projection: annualised run-rate from COMPLETE months only. A month
  // is complete when it is (a) not the in-progress current month, and (b) not a
  // partial boundary month — i.e. not the start month when the window begins
  // mid-month, nor the end month when the window ends before month-end. Otherwise
  // an 8-day boundary bucket would be averaged as if it were a whole month and
  // drag the run-rate off (it understated the projection by ~€35k / 4.3%).
  const nowMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const fromMonthKey = from.substring(0, 7);
  const toMonthKey = to.substring(0, 7);
  const startsMidMonth = from.substring(8, 10) !== "01";
  const endsBeforeMonthEnd = !isMonthEnd(to);
  const isCompleteMonth = (m: string): boolean =>
    m < nowMonth &&
    !(startsMidMonth && m === fromMonthKey) &&
    !(endsBeforeMonthEnd && m === toMonthKey);

  const itByMonth = new Map<string, number>();
  for (const inv of invoices) {
    if (!isToolsSpendCategory(inv.costCategory)) continue;
    const m = inv.postingDate.substring(0, 7);
    itByMonth.set(m, (itByMonth.get(m) ?? 0) + inv.totalAmountExcludingTax);
  }
  const completeMonths = [...itByMonth.entries()].filter(([m]) => isCompleteMonth(m));
  // Annualise the ACTUAL spend in the selected window by elapsed days. This is the
  // robust choice for lumpy IT spend: annual licences (PTV, Eurotracs, Trimble, …)
  // cluster in Q1, so annualising a recent-months run-rate would multiply those
  // once-a-year invoices by 12 and badly overstate. Day-weighting counts each
  // renewal once across the year and includes partial boundary / in-progress months
  // proportionally — so for a ~12-month range it ≈ the actual total (never reads
  // oddly below it), and for a short range it scales up to a full-year estimate.
  const windowDays = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000));
  const projectedAnnualSpend = Math.round((totalSpendYTD * 365) / windowDays);
  const projectionMonths = Math.max(1, Math.round(windowDays / 30.44));
  // Trailing-twelve-months: the seasonality-proof actual annual figure — sum of
  // the last 12 COMPLETE months. 0 until a full 12 exist (then it's the headline
  // annual number; run-rate is the forward-looking secondary).
  const completeSortedAll = completeMonths.sort((a, b) => a[0].localeCompare(b[0]));
  const annualisedSpendTTM =
    completeSortedAll.length >= 12
      ? Math.round(completeSortedAll.slice(-12).reduce((s, [, v]) => s + v, 0))
      : 0;

  // Budget vs actual must be SCOPE-MATCHED: compare budget only against spend in
  // the budgeted categories (not the whole IT total), over the same window.
  const fromMonth = from.substring(0, 7);
  const toMonth = to.substring(0, 7);
  const budgetInRange = budget.filter((b) => b.month >= fromMonth && b.month <= toMonth);
  const totalBudgetYTD = budgetInRange.reduce((sum, b) => sum + b.budgetAmount, 0);
  const budgetedCategories = new Set(budgetInRange.map((b) => b.category));
  // Actual = IT spend in the budgeted categories only (matches the denominator).
  const totalActualYTD = budgetedCategories.size
    ? invoices
        .filter((inv) => isITCategory(inv.costCategory) && budgetedCategories.has(inv.costCategory))
        .reduce((sum, inv) => sum + inv.totalAmountExcludingTax, 0)
    : 0;
  const budgetVariancePercent =
    totalBudgetYTD > 0
      ? ((totalActualYTD - totalBudgetYTD) / totalBudgetYTD) * 100
      : 0;
  // For a COST line, over budget = unfavorable, under = favorable. "na" when no
  // budget is set (don't render a misleading 0%).
  const budgetFavorability: DashboardKPIs["budgetFavorability"] =
    totalBudgetYTD <= 0 ? "na" : totalActualYTD > totalBudgetYTD ? "unfavorable" : "favorable";

  const paidLicenses = licenses.filter((l) => l.pricePerUser > 0);
  const totalPrepaid = paidLicenses.reduce((sum, l) => sum + l.prepaidUnits, 0);
  const totalConsumed = paidLicenses.reduce((sum, l) => sum + l.consumedUnits, 0);
  const licenseUtilizationPercent =
    totalPrepaid > 0 ? (totalConsumed / totalPrepaid) * 100 : 0;

  // Spend trend: last 3 COMPLETE months vs the prior 3 complete months (rolling),
  // IT-only. Excluding partial boundary months is essential — including the
  // in-progress month made the trend read "down 21%" when complete-month spend is
  // actually up ~21%. Reuses the itByMonth (IT-only) series + isCompleteMonth.
  const completeMonthsSorted = [...itByMonth.entries()]
    .filter(([m]) => isCompleteMonth(m))
    .sort((a, b) => a[0].localeCompare(b[0]));
  const recentMonths = completeMonthsSorted.slice(-3);
  const priorMonths = completeMonthsSorted.slice(-6, -3);
  const recent = recentMonths.reduce((s, [, v]) => s + v, 0);
  const prior = priorMonths.reduce((s, [, v]) => s + v, 0);
  const spendChangePercent = prior > 0 ? ((recent - prior) / prior) * 100 : 0;
  // Don't surface this quarter-over-quarter number yet: IT spend is lumpy (annual
  // licences — PTV, Eurotracs, Trimble, iDocta — cluster in Q1), so a rolling-quarter
  // comparison reflects renewal timing, not a real trend. The seasonality-proof fix
  // is year-over-year, but the prior year isn't usable (BC migration left reversals
  // in 2024, e.g. −€468k in Dec-2024). Flip to true once a YoY baseline exists.
  const spendTrendReliable = false;

  // IT spend as % of revenue. Prefer the audited consolidated figure (Settings)
  // over gross class-70 turnover, which is inflated by intercompany.
  const consolidated = settings?.consolidatedRevenue ?? 0;
  const groupRevenue = consolidated > 0 ? consolidated : grossRevenue;
  const revenueIsConsolidated = consolidated > 0;
  const itSpendPercentOfRevenue = groupRevenue > 0 ? (totalSpendYTD / groupRevenue) * 100 : 0;
  const revenueBenchmarkPercent = settings?.revenueBenchmarkPercent ?? 3.3;

  // Accounts payable on IT spend: of the IT spend in this window, how much sits on
  // invoices BC still marks "Open" (posted, unpaid), and how much is past due. This
  // is a cash/AP view — the accrual spend total above is unaffected by it.
  const todayIso = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`;
  let openInvoiceAmount = 0, openInvoiceCount = 0, overdueAmount = 0, overdueCount = 0;
  for (const inv of itInvoices) {
    if (inv.status !== "Open") continue;
    openInvoiceAmount += inv.totalAmountExcludingTax;
    openInvoiceCount++;
    if (inv.dueDate && inv.dueDate < todayIso) {
      overdueAmount += inv.totalAmountExcludingTax;
      overdueCount++;
    }
  }

  return {
    totalSpendYTD,
    budgetVariancePercent,
    budgetFavorability,
    licenseUtilizationPercent,
    licenseActiveUsagePercent: activeUsagePct,
    deviceCount: devices.length,
    totalBudgetYTD,
    totalActualYTD,
    itDepreciationYTD,
    projectedAnnualSpend,
    projectionMonths,
    annualisedSpendTTM,
    opexYTD: Math.round(opexYTD),
    capexYTD: Math.round(capexYTD),
    groupRevenue: Math.round(groupRevenue),
    revenueIsConsolidated,
    itSpendPercentOfRevenue,
    revenueBenchmarkPercent,
    spendTrend: spendChangePercent > 2 ? "up" : spendChangePercent < -2 ? "down" : "flat",
    spendChangePercent,
    spendTrendReliable,
    openInvoiceAmount: Math.round(openInvoiceAmount),
    openInvoiceCount,
    overdueAmount: Math.round(overdueAmount),
    overdueCount,
    // Internal IT-staff cost (BC, AFDELING=IT) + the fully-loaded Total Cost of IT
    // (external spend + internal labour). 0 when payroll dimension is unavailable.
    itPersonnelCost,
    totalCostOfIT: Math.round(totalSpendYTD + itPersonnelCost),
  };
}

// ---- IT asset depreciation (separate from spend) ----
export async function getITDepreciation(
  companyFilter: CompanyFilter = "all",
  dateFrom?: string,
  dateTo?: string
): Promise<number> {
  if (isDemoMode()) return 0;
  const yr = new Date().getFullYear();
  const from = dateFrom ?? `${yr}-01-01`;
  const to = dateTo ?? `${yr}-12-31`;
  const cacheKey = `it-depreciation-${companyFilter}-${from}-${to}`;
  const cached = getCache<number>(cacheKey);
  if (cached != null) return cached;
  try {
    await getBCToken();
    const companies = await getCompanies();
    const targets = companyFilter === "all" ? companies : companies.filter((c) => c.id === companyFilter);
    let degraded = false;
    const per = await Promise.all(
      targets.map((c) => fetchBCDepreciationEntries(c.id, from, to).catch(() => { degraded = true; return [] as Record<string, unknown>[]; }))
    );
    let total = 0;
    for (const entries of per) {
      for (const g of entries) {
        total += ((g.debitAmount as number) || 0) - ((g.creditAmount as number) || 0);
      }
    }
    if (!degraded) setCache(cacheKey, total, 120); // don't cache a partial sum
    return total;
  } catch {
    return 0;
  }
}

// ---- Internal IT personnel cost (from BC, via the AFDELING=IT dimension) ----
// Fully-loaded cost of the internal IT department (salaries + employer RSZ +
// extras), read from class-62 GL entries tagged AFDELING=IT. This is the internal-
// labour component of the Total Cost of IT — sourced from Business Central, so no
// HR-system integration is required. Heavy to compute (scans payroll entries), so
// cached 12h and warmed at boot.
export async function getITPersonnelCost(
  companyFilter: CompanyFilter = "all",
  dateFrom?: string,
  dateTo?: string
): Promise<number> {
  if (isDemoMode()) return 0;
  const yr = new Date().getFullYear();
  const from = dateFrom ?? `${yr}-01-01`;
  const to = dateTo ?? `${yr}-12-31`;
  const cacheKey = `it-personnel-${companyFilter}-${from}-${to}`;
  const cached = getCache<number>(cacheKey);
  if (cached != null) return cached;
  try {
    await getBCToken();
    const companies = await getCompanies();
    const targets = companyFilter === "all" ? companies : companies.filter((c) => c.id === companyFilter);
    let degraded = false;
    const per = await Promise.all(
      targets.map((c) => fetchITDepartmentPayroll(c.id, from, to).catch(() => { degraded = true; return 0; }))
    );
    const total = Math.round(per.reduce((s, v) => s + v, 0));
    if (!degraded) setCache(cacheKey, total, 720); // 12h — payroll changes monthly
    return total;
  } catch {
    return 0;
  }
}

// ---- Group revenue (for IT-spend-%-of-revenue benchmark) ----
// Gross class-70 turnover across the group (includes intercompany). The
// dashboard prefers an audited consolidated figure from Settings when set.
export async function getGroupRevenue(
  companyFilter: CompanyFilter = "all",
  dateFrom?: string,
  dateTo?: string
): Promise<number> {
  if (isDemoMode()) return 0;
  const yr = new Date().getFullYear();
  const from = dateFrom ?? `${yr}-01-01`;
  const to = dateTo ?? `${yr}-12-31`;
  const cacheKey = `revenue-${companyFilter}-${from}-${to}`;
  const cached = getCache<number>(cacheKey);
  if (cached != null) return cached;
  try {
    await getBCToken();
    const companies = await getCompanies();
    const targets = companyFilter === "all" ? companies : companies.filter((c) => c.id === companyFilter);
    let degraded = false;
    const per = await Promise.all(
      targets.map((c) => fetchBCRevenue(c.id, from, to).catch(() => { degraded = true; return 0; }))
    );
    const total = per.reduce((s, v) => s + v, 0);
    if (!degraded) setCache(cacheKey, total, 120); // don't cache a partial sum
    return total;
  } catch {
    return 0;
  }
}

// ---- License active-to-provisioned usage (FinOps) ----
// % of licensed M365 users active in the last 30 days. null until the Graph
// Reports.Read.All permission is granted (then the tile lights up automatically).
// Raw {active, licensed} counts from the M365 active-user report, cached 4h so
// the percent KPI and the license-harvest view share one Graph call. null when
// the Reports permission/report isn't available.
export async function getLicenseActiveUsageRaw(): Promise<{ active: number; licensed: number } | null> {
  if (isDemoMode()) return null;
  const cacheKey = "license-active-usage-raw";
  const cached = getCache<{ active: number; licensed: number } | number>(cacheKey);
  if (cached != null) return cached === -1 ? null : (cached as { active: number; licensed: number });
  const usage = await fetchM365ActiveUsage();
  setCache(cacheKey, usage ?? -1, 240); // 4h TTL; -1 = checked, unavailable
  return usage;
}

export async function getLicenseActiveUsagePercent(): Promise<number | null> {
  const usage = await getLicenseActiveUsageRaw();
  return usage && usage.licensed > 0 ? (usage.active / usage.licensed) * 100 : null;
}

// License harvesting: how many paid seats are reclaimable, split into the two
// pools an admin can actually act on — unassigned (exact) and assigned-but-inactive
// (count exact, € estimated via the blended assigned-seat price). See LicenseHarvest.
export async function getLicenseHarvest(): Promise<LicenseHarvest> {
  const [licenses, usage] = await Promise.all([getLicenses(), getLicenseActiveUsageRaw()]);
  const paid = licenses.filter((l) => l.pricePerUser > 0);
  const unassignedSeats = paid.reduce((s, l) => s + l.wastedUnits, 0);
  const unassignedMonthly = paid.reduce((s, l) => s + l.wastedCost, 0);
  const assignedSeats = paid.reduce((s, l) => s + l.consumedUnits, 0);
  const assignedSpend = paid.reduce((s, l) => s + l.consumedUnits * l.pricePerUser, 0);
  const blendedSeatMonthly = assignedSeats > 0 ? assignedSpend / assignedSeats : 0;
  const inactiveUsers = usage ? Math.max(0, usage.licensed - usage.active) : 0;
  const inactiveMonthlyEstimate = Math.round(inactiveUsers * blendedSeatMonthly);
  return {
    hasUsageData: !!usage,
    licensedUsers: usage?.licensed ?? 0,
    activeUsers: usage?.active ?? 0,
    inactiveUsers,
    activePercent: usage && usage.licensed > 0 ? (usage.active / usage.licensed) * 100 : null,
    unassignedSeats,
    unassignedMonthly: Math.round(unassignedMonthly),
    blendedSeatMonthly: Math.round(blendedSeatMonthly * 100) / 100,
    inactiveMonthlyEstimate,
    totalReclaimableAnnual: Math.round((unassignedMonthly + inactiveMonthlyEstimate) * 12),
  };
}

// ---- Monthly Spend Trend ----
export async function getMonthlySpend(
  companyFilter: CompanyFilter = "all",
  dateFrom?: string,
  dateTo?: string
): Promise<MonthlySpend[]> {
  const yr = new Date().getFullYear();
  const from = dateFrom ?? `${yr}-01-01`;
  const to = dateTo ?? `${yr}-12-31`;
  // Actual spend comes from real invoices (IT categories only). Budget only
  // exists in demo mode — in live mode there is no configured budget source, so
  // the budget line is omitted rather than showing fake numbers.
  const invoices = await getInvoices(companyFilter, from, to);
  const budget = await getBudgetEntries(companyFilter);

  // Enumerate all year-months within the requested range
  const fromDate = new Date(from);
  const toDate = new Date(to);
  const months: string[] = [];
  const cursor = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);
  while (cursor <= toDate) {
    const y = cursor.getFullYear();
    const m = (cursor.getMonth() + 1).toString().padStart(2, "0");
    months.push(`${y}-${m}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const actualByMonth = new Map<string, number>();
  for (const inv of invoices) {
    if (!isToolsSpendCategory(inv.costCategory)) continue;
    const m = inv.postingDate.substring(0, 7);
    actualByMonth.set(m, (actualByMonth.get(m) ?? 0) + inv.totalAmountExcludingTax);
  }

  return months
    .map((month) => {
      const monthBudget = budget.filter((b) => b.month === month);
      return {
        month,
        actual: actualByMonth.get(month) ?? 0,
        budget: monthBudget.reduce((s, b) => s + b.budgetAmount, 0),
      };
    })
    .filter((m) => m.budget > 0 || m.actual > 0);
}

// ---- Spend forecast (budget planning) ----
// Seasonal-naive forecast: each of the next 12 months is projected from the SAME
// calendar month's actual over the trailing 12 months, plus the recurring internal
// IT-staff cost (flat monthly). This deliberately preserves the lumpy pattern —
// annual licences that cluster in Q1 are forecast back into Q1 — instead of a flat
// run-rate that would smear them. An optional growth factor scales the variable part.
export async function getSpendForecast(companyFilter: CompanyFilter = "all"): Promise<SpendForecast> {
  const pad = (n: number) => String(n).padStart(2, "0");
  const now = new Date();
  // Trailing 12 FULL months: first day of (this month − 12) … last day of last month.
  const start = new Date(now.getFullYear(), now.getMonth() - 12, 1);
  const endPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
  const fromStr = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-01`;
  const toStr = `${endPrevMonth.getFullYear()}-${pad(endPrevMonth.getMonth() + 1)}-${pad(endPrevMonth.getDate())}`;

  const [monthly, personnelAnnual] = await Promise.all([
    getMonthlySpend(companyFilter, fromStr, toStr),
    getITPersonnelCost(companyFilter, fromStr, toStr).catch(() => 0),
  ]);
  const monthlyPersonnel = Math.round(personnelAnnual / 12);

  // Seasonal baseline: latest actual seen for each calendar month (MM) + the average
  // as a fallback for any missing month.
  const byCal = new Map<string, number>();
  for (const m of monthly) byCal.set(m.month.slice(5, 7), m.actual);
  const avgTools = monthly.length ? monthly.reduce((s, m) => s + m.actual, 0) / monthly.length : 0;

  const growth = 1; // flat (no growth) by default — the apparent rise is Q1 seasonality, not trend.

  // History points (trailing actuals, incl. flat personnel) then 12 forecast months.
  const points: ForecastPoint[] = monthly.map((m) => ({
    month: m.month,
    actual: Math.round(m.actual + monthlyPersonnel),
    forecast: null,
  }));
  // Connect the dashed forecast line to the last actual point.
  if (points.length) points[points.length - 1].forecast = points[points.length - 1].actual;

  let annualForecast = 0;
  for (let i = 1; i <= 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const cal = pad(d.getMonth() + 1);
    const baseTools = (byCal.get(cal) ?? avgTools) * growth;
    const f = Math.round(baseTools + monthlyPersonnel);
    annualForecast += f;
    points.push({ month: `${d.getFullYear()}-${cal}`, actual: null, forecast: f });
  }

  return {
    points,
    annualForecast: Math.round(annualForecast),
    monthlyPersonnel,
    includesPersonnel: monthlyPersonnel > 0,
    method: "Seasonal baseline (same calendar month, trailing year) + recurring internal IT staff",
  };
}

// ---- Category Spend ----
export async function getCategorySpend(
  companyFilter: CompanyFilter = "all",
  dateFrom?: string,
  dateTo?: string
): Promise<CategorySpend[]> {
  const yr = new Date().getFullYear();
  const from = dateFrom ?? `${yr}-01-01`;
  const to = dateTo ?? `${yr}-12-31`;
  const invoices = await getInvoices(companyFilter, from, to);
  // Budget exists only in demo mode; don't blend demo budget into live figures.
  const budget = await getBudgetEntries(companyFilter);

  const categoryMap = new Map<string, { actual: number; budget: number }>();

  invoices.forEach((inv) => {
    // Tools & services categories only — internal "IT Personnel" labour is a
    // separate line (BC-sourced), not a spend category, and "Unclassified" is non-IT.
    if (!isToolsSpendCategory(inv.costCategory)) return;
    const cat = inv.costCategory || "Other IT";
    const existing = categoryMap.get(cat) || { actual: 0, budget: 0 };
    existing.actual += inv.totalAmountExcludingTax;
    categoryMap.set(cat, existing);
  });

  budget.forEach((b) => {
    const existing = categoryMap.get(b.category) || { actual: 0, budget: 0 };
    existing.budget += b.budgetAmount;
    categoryMap.set(b.category, existing);
  });

  return Array.from(categoryMap.entries())
    .map(([category, data]) => ({
      category,
      amount: data.actual,
      budget: data.budget,
      variance: data.actual - data.budget,
      variancePercent:
        data.budget > 0
          ? ((data.actual - data.budget) / data.budget) * 100
          : 0,
      color: (CATEGORY_COLORS as Record<string, string>)[category] || "#6b7280",
    }))
    .sort((a, b) => b.amount - a.amount);
}

// ---- Entity Spend ----
export async function getEntitySpend(
  dateFrom?: string,
  dateTo?: string
): Promise<EntitySpend[]> {
  const yr = new Date().getFullYear();
  const from = dateFrom ?? `${yr}-01-01`;
  const to = dateTo ?? `${yr}-12-31`;
  const companies = await getCompanies();
  const invoices = await getInvoices("all", from, to);

  // Per-entity headcount isn't available from BC (and Officient HR isn't
  // connected), so we do NOT fabricate user counts / per-user spend. Total spend
  // per entity is real; per-user is reported as 0 (unknown) until HR is connected.
  return companies
    .map((company) => {
      // IT-only, so per-entity spend always ties to the headline KPI (even when
      // the operational-software toggle reclassifies that spend to Unclassified).
      const companyInvoices = invoices.filter(
        (inv) => inv.companyId === company.id && isITCategory(inv.costCategory)
      );
      const totalSpend = companyInvoices.reduce((s, i) => s + i.totalAmountExcludingTax, 0);
      return {
        companyId: company.id,
        companyName: company.displayName,
        totalSpend,
        perUserSpend: 0,
        userCount: 0,
      };
    })
    .filter((e) => e.totalSpend > 0)
    .sort((a, b) => b.totalSpend - a.totalSpend);
}

// ---- Employees ----
async function getDemoEmployees(): Promise<Employee[]> {
  const mockData = await import("../data/mock/employees.json");
  return mockData.default as Employee[];
}

export async function getEmployees(): Promise<Employee[]> {
  if (isDemoMode()) return getDemoEmployees();

  // Live mode: fetch from Officient. If credentials are missing or the API
  // errors, fall back to demo data instead of throwing — an unhandled throw
  // here previously crashed the entire Personnel page (HTTP 500 / white screen).
  try {
    const { fetchEmployees, fetchAssets, fetchWagesForPeople } = await import("./officient-client");
    const [officientEmployees, officientAssets] = await Promise.all([
      fetchEmployees(),
      fetchAssets(),
    ]);

    const assetsByPerson = new Map<number, { id: number; name: string; description: string; category: string }[]>();
    officientAssets.forEach((a) => {
      const list = assetsByPerson.get(a.person_id) || [];
      list.push({ id: a.id, name: a.name, description: a.description, category: a.category });
      assetsByPerson.set(a.person_id, list);
    });

    // Pull employer cost per person so personnel KPIs reflect real salary cost.
    // Without this, monthlyCost stays undefined and itSalaryCost computes to 0.
    const activeIds = officientEmployees.filter((e) => e.status === "active").map((e) => e.id);
    const wagesByPerson = await fetchWagesForPeople(activeIds);

    sourceStatus.employees = "live";
    return officientEmployees.map((e) => ({
      id: e.id,
      name: e.name,
      email: e.email,
      department: e.department,
      functionTitle: e.function_title,
      startDate: e.start_date,
      status: e.status,
      monthlyCost: wagesByPerson.get(e.id) ?? 0,
      assets: assetsByPerson.get(e.id) || [],
    }));
  } catch (err) {
    // Live mode: real data or empty — never demo employees. Officient isn't
    // connected yet (no credentials), so personnel shows empty with a notice.
    console.warn("Officient API error (employees):", err);
    sourceStatus.employees = "empty";
    return [];
  }
}

// ---- Jira Worklogs ----
export async function getJiraWorklogs(): Promise<JiraWorklog[]> {
  if (isDemoMode()) {
    const mockData = await import("../data/mock/jira-worklogs.json");
    return mockData.default as JiraWorklog[];
  }

  const cacheKey = "jira-worklogs";
  const cached = getCache<JiraWorklog[]>(cacheKey);
  if (cached) return cached;

  try {
    const worklogs = await fetchLiveJiraWorklogs();
    setCache(cacheKey, worklogs, 360); // 6h TTL
    return worklogs;
  } catch (err) {
    console.warn("Jira API error (worklogs):", err);
    return [];
  }
}

// ---- Jira Project Costs (derived) ----
export async function getJiraProjectCosts(): Promise<JiraProjectCost[]> {
  const worklogs = await getJiraWorklogs();

  const PROJECT_NAMES: Record<string, string> = {
    IT: "IT Support",
    GP: "Development & Projects",
  };

  const projectMap = new Map<
    string,
    { totalHours: number; totalCost: number; contributors: Set<string> }
  >();

  worklogs.forEach((wl) => {
    const existing = projectMap.get(wl.project) || {
      totalHours: 0,
      totalCost: 0,
      contributors: new Set<string>(),
    };
    existing.totalHours += wl.timeSpentHours;
    existing.totalCost += wl.totalCost || 0;
    existing.contributors.add(wl.author);
    projectMap.set(wl.project, existing);
  });

  return Array.from(projectMap.entries())
    .map(([projectKey, data]) => ({
      projectKey,
      projectName: PROJECT_NAMES[projectKey] || projectKey,
      totalHours: data.totalHours,
      totalCost: data.totalCost,
      contributors: data.contributors.size,
    }))
    .sort((a, b) => b.totalCost - a.totalCost);
}

// ---- Personnel KPIs ----
export async function getPersonnelKPIs(): Promise<PersonnelKPIs> {
  const employees = await getEmployees();
  const active = employees.filter((e) => e.status === "active");
  const itTeam = active.filter((e) => e.department === "IT");

  // IT salary cost: sum of monthly costs for IT employees only
  const itSalaryCost = itTeam.reduce((sum, e) => sum + (e.monthlyCost || 0), 0);
  const totalPersonnelCost = itSalaryCost;
  const avgITCostPerEmployee = itTeam.length > 0 ? itSalaryCost / itTeam.length : 0;

  // External IT services and tools/licenses cost.
  // Demo mode: fixed illustrative estimates. Live mode: real monthly-average
  // spend derived from the IT invoice feed (no fabricated numbers).
  let externalServicesCost = 8_250; // e.g. consultants, MSP, external IT projects
  let toolsLicensesCost = 4_180;    // e.g. M365, SaaS tools, antivirus
  if (!isDemoMode()) {
    const yr = new Date().getFullYear();
    const invoices = await getInvoices("all", `${yr}-01-01`, `${yr}-12-31`);
    const monthsElapsed = new Date().getMonth() + 1;
    const sumCat = (cat: string) =>
      invoices.filter((i) => i.costCategory === cat).reduce((s, i) => s + i.totalAmountExcludingTax, 0);
    externalServicesCost = Math.round(sumCat("External IT Services") / monthsElapsed);
    toolsLicensesCost = Math.round(sumCat("Software & Licenses") / monthsElapsed);
  }

  const itStaffRatio = active.length > 0
    ? Math.round((itTeam.length / active.length) * 100)
    : 0;

  const deptMap = new Map<string, { headcount: number; assets: number }>();
  active.forEach((e) => {
    const existing = deptMap.get(e.department) || { headcount: 0, assets: 0 };
    existing.headcount += 1;
    existing.assets += (e.assets || []).length;
    deptMap.set(e.department, existing);
  });

  const departments: DepartmentSummary[] = Array.from(deptMap.entries()).map(
    ([name, data]) => ({
      name,
      headcount: data.headcount,
      itCostPerUser: data.headcount > 0 ? itSalaryCost / active.length : 0,
      totalITCost: (itSalaryCost / active.length) * data.headcount,
      assets: data.assets,
    })
  );

  const totalAssets = active.reduce((sum, e) => sum + (e.assets || []).length, 0);

  return {
    totalHeadcount: active.length,
    itHeadcount: itTeam.length,
    avgITCostPerEmployee,
    totalPersonnelCost,
    assetCount: totalAssets,
    departments,
    itSalaryCost,
    externalServicesCost,
    toolsLicensesCost,
    itStaffRatio,
  };
}

// ---- Peppol Invoices ----
export async function getPeppolInvoices(): Promise<PeppolInvoice[]> {
  if (isDemoMode()) {
    return demoPeppolInvoices;
  }

  // Live mode: only real uploaded/received Peppol invoices (none yet) — no demo.
  return [];
}

// ---- Cost Insights ----
export async function getCostInsights(
  dateFrom?: string,
  dateTo?: string
): Promise<CostInsight[]> {
  const [licenses, vendors, devices, budget, employees] = await Promise.all([
    getLicenses(),
    getVendorSummary("all", dateFrom, dateTo),
    getDevices(),
    getBudgetEntries(),
    getEmployees(),
  ]);
  return generateAllInsights({ licenses, vendors, devices, budget, employees });
}

// Conservative vendor-name normalisation for de-duplication: same vendor written
// with/without legal form ("GMI GROUP" vs "GMI GROUP NV") collapses to one key.
// Deliberately does NOT strip distinguishing words, to avoid merging different
// entities.
function normalizeVendorKey(name: string): string {
  return (name || "")
    .toUpperCase()
    .replace(/\./g, "")
    .replace(/[,&]/g, " ")
    .replace(/\b(BVBA|BV|NV\/SA|NV|SA|SRL|SPRL|COMM ?V|VOF|GMBH|LTD|LLC|INC)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---- Vendor Summary ----
export async function getVendorSummary(
  companyFilter: CompanyFilter = "all",
  dateFrom?: string,
  dateTo?: string
): Promise<VendorSummary[]> {
  const yr = new Date().getFullYear();
  const from = dateFrom ?? `${yr}-01-01`;
  const to = dateTo ?? `${yr}-12-31`;
  // IT-only, so vendor totals and percent-of-total share the same denominator as
  // the headline KPI (and Unclassified spend never appears as a "vendor").
  const invoices = (await getInvoices(companyFilter, from, to)).filter((i) =>
    isITCategory(i.costCategory)
  );
  const totalSpend = invoices.reduce(
    (s, i) => s + i.totalAmountExcludingTax,
    0
  );

  const vendorMap = new Map<
    string,
    {
      display: string;
      vendorNumber: string;
      totalSpend: number;
      invoiceCount: number;
      categories: Set<string>;
      entities: Map<string, number>;
      lastDate: string;
    }
  >();

  invoices.forEach((inv) => {
    const key = normalizeVendorKey(inv.vendorName) || inv.vendorName;
    const existing = vendorMap.get(key) || {
      display: inv.vendorName,
      vendorNumber: inv.vendorNumber,
      totalSpend: 0,
      invoiceCount: 0,
      categories: new Set<string>(),
      entities: new Map<string, number>(),
      lastDate: "",
    };
    // Prefer the longest variant as the display name (usually most complete).
    if (inv.vendorName && inv.vendorName.length > existing.display.length) {
      existing.display = inv.vendorName;
    }
    existing.totalSpend += inv.totalAmountExcludingTax;
    existing.invoiceCount += 1;
    existing.categories.add(inv.costCategory);
    if (inv.companyName) {
      existing.entities.set(inv.companyName, (existing.entities.get(inv.companyName) ?? 0) + inv.totalAmountExcludingTax);
    }
    if (inv.postingDate > existing.lastDate) {
      existing.lastDate = inv.postingDate;
    }
    vendorMap.set(key, existing);
  });

  return Array.from(vendorMap.values())
    .map((data) => {
      const percentOfTotal =
        totalSpend > 0 ? (data.totalSpend / totalSpend) * 100 : 0;
      // 'risk' above the 30% flag; 'watch' in the 25–30% band (one rounding from
      // the flag — e.g. EASI ~29.7%); else 'safe'.
      const concentrationLevel: VendorSummary["concentrationLevel"] =
        percentOfTotal > CONCENTRATION_RISK_THRESHOLD
          ? "risk"
          : percentOfTotal >= CONCENTRATION_WATCH_THRESHOLD
          ? "watch"
          : "safe";
      return {
        vendorName: data.display,
        vendorNumber: data.vendorNumber,
        totalSpend: data.totalSpend,
        invoiceCount: data.invoiceCount,
        percentOfTotal,
        categories: Array.from(data.categories),
        lastInvoiceDate: data.lastDate,
        isConcentrationRisk: percentOfTotal > CONCENTRATION_RISK_THRESHOLD,
        concentrationLevel,
        entities: Array.from(data.entities.entries())
          .map(([name, spend]) => ({ name, spend: Math.round(spend) }))
          .sort((a, b) => b.spend - a.spend),
      };
    })
    .sort((a, b) => b.totalSpend - a.totalSpend);
}
