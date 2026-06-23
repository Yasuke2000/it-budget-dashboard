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
} from "./types";
import type { PeppolInvoice } from "./peppol-parser";
import { CATEGORY_COLORS, CONCENTRATION_RISK_THRESHOLD, DEFAULT_GL_MAPPING, IT_VENDOR_RULES, UNCLASSIFIED_CATEGORY, isITCategory, isIntercompanyVendor } from "./constants";
import { generateAllInsights } from "./cost-insights";
import type { CostInsight } from "./cost-insights";
import { getCache, setCache } from "./sync-cache";
import { fetchBCCompanies, fetchBCGLEntries, fetchBCLedgerByAccounts, fetchBCDepreciationEntries, fetchBCPurchaseInvoiceHeaders, getBCToken } from "./bc-client";
import { getAppSettings } from "./settings-store";
import {
  fetchSubscribedSkus,
  fetchManagedDevices,
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
      try {
        const settings = await getAppSettings();
        glMapping = settings.glMappings;
        vendorRules = settings.itVendorRules;
      } catch {
        glMapping = DEFAULT_GL_MAPPING;
        vendorRules = IT_VENDOR_RULES;
      }
      const itAccounts = Object.keys(glMapping);
      const vendorPatterns = Object.keys(vendorRules);
      const perCompany = await Promise.all(
        targetCompanies.map(async (company) => {
          const [glEntries, headers] = await Promise.all([
            fetchBCLedgerByAccounts(company.id, from, to, itAccounts).catch(() => [] as Record<string, unknown>[]),
            fetchBCPurchaseInvoiceHeaders(company.id, from, to).catch(() => [] as Record<string, unknown>[]),
          ]);
          const vendorByDoc = new Map<string, { name: string; number: string }>();
          for (const h of headers) {
            const num = (h.number as string) || "";
            if (num) vendorByDoc.set(num, { name: (h.vendorName as string) || "", number: (h.vendorNumber as string) || "" });
          }
          return { company, glEntries, vendorByDoc, headers };
        })
      );

      const allInvoices: PurchaseInvoice[] = [];
      for (const { company, glEntries, vendorByDoc, headers } of perCompany) {
        const countedDocs = new Set<string>();
        for (const g of glEntries) {
          const accountNumber = (g.accountNumber as string) || "";
          // Spend = debit − credit. This nets out correction/reversal pairs to
          // zero, which we then skip.
          const amount = ((g.debitAmount as number) || 0) - ((g.creditAmount as number) || 0);
          if (!amount) continue;
          const postingDate = (g.postingDate as string) || "";
          const documentNumber = (g.documentNumber as string) || "";
          const description = (g.description as string) || "";
          const costCategory = glMapping[accountNumber] || UNCLASSIFIED_CATEGORY;
          const vendor = vendorByDoc.get(documentNumber);
          if (documentNumber) countedDocs.add(documentNumber);

          // Skip intercompany recharges (vendor is a Gheeraert-group entity) —
          // internal cross-charges aren't third-party IT spend.
          if (isIntercompanyVendor(vendor?.name || "")) continue;

          allInvoices.push({
            id: `gl-${company.id}-${(g.id as string) || `${documentNumber}-${accountNumber}-${postingDate}`}`,
            number: documentNumber,
            invoiceDate: postingDate,
            postingDate,
            dueDate: postingDate,
            // Real vendor from the posted-invoice header; fall back to the
            // booking description only if the document can't be matched.
            vendorNumber: vendor?.number || accountNumber,
            vendorName: vendor?.name || description || accountNumber,
            totalAmountExcludingTax: amount,
            totalAmountIncludingTax: amount,
            totalTaxAmount: 0,
            status: "Paid",
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

        // Vendor allowlist: count allowlisted IT vendors (e.g. iDocta, Canon
        // printers) even when their invoice landed on a non-IT account — but
        // only invoices NOT already counted above, so nothing double-counts.
        if (vendorPatterns.length) {
          for (const h of headers) {
            const vname = (h.vendorName as string) || "";
            const vlow = vname.toLowerCase();
            const matched = vendorPatterns.find((p) => p && vlow.includes(p.toLowerCase()));
            if (!matched) continue;
            if (isIntercompanyVendor(vname)) continue;
            const num = (h.number as string) || "";
            if (num && countedDocs.has(num)) continue;
            const amt = (h.totalAmountExcludingTax as number) || 0;
            if (!amt) continue;
            const postingDate = (h.postingDate as string) || from;
            allInvoices.push({
              id: `vw-${company.id}-${num || vname}`,
              number: num,
              invoiceDate: postingDate,
              postingDate,
              dueDate: postingDate,
              vendorNumber: (h.vendorNumber as string) || "",
              vendorName: vname,
              totalAmountExcludingTax: amt,
              totalAmountIncludingTax: amt,
              totalTaxAmount: 0,
              status: "Paid",
              currencyCode: "EUR",
              companyId: company.id,
              companyName: company.displayName,
              costCategory: vendorRules[matched] || "External IT Services",
              lines: [],
            });
          }
        }
      }

      setCache(cacheKey, allInvoices, 120); // 2h TTL
      sourceStatus.invoices = "live";
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
    // prices), overriding the compiled defaults so cost/waste reflect reality.
    let prices: Record<string, number> = {};
    try { prices = (await getAppSettings()).licensePrices; } catch { /* keep mapper defaults */ }
    const licenses: M365License[] = skus.map((sku) => {
      const lic = mapGraphLicenseToM365License(sku);
      const p = prices[lic.skuPartNumber];
      if (p != null && p !== lic.pricePerUser) {
        lic.pricePerUser = p;
        lic.monthlyCost = lic.consumedUnits * p;
        lic.wastedCost = lic.wastedUnits * p;
      }
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

// ---- Budget ----
export async function getBudgetEntries(
  companyFilter: CompanyFilter = "all"
): Promise<BudgetEntry[]> {
  if (isDemoMode()) {
    if (companyFilter !== "all") {
      return demoBudgetEntries.filter((b) => b.companyId === companyFilter || b.companyId === "all");
    }
    return demoBudgetEntries;
  }

  // Live: per-category monthly budgets configured in Settings → Budget, expanded
  // to one entry per category × month of the current year. Empty until set.
  let budgets: Record<string, number> = {};
  try {
    budgets = (await getAppSettings()).budgets;
  } catch {
    return [];
  }
  const cats = Object.keys(budgets).filter((c) => (budgets[c] || 0) > 0);
  if (!cats.length) return [];
  const yr = new Date().getFullYear();
  const entries: BudgetEntry[] = [];
  for (const cat of cats) {
    const monthly = budgets[cat];
    for (let mo = 1; mo <= 12; mo++) {
      const month = `${yr}-${String(mo).padStart(2, "0")}`;
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
  // Budget only exists in demo mode — no live budget source is configured, so we
  // don't surface fake budget/variance numbers on the live dashboard.
  const budget = await getBudgetEntries(companyFilter);
  const licenses = await getLicenses();
  const devices = await getDevices();
  // Depreciation of IT assets — reported separately, never added to IT spend.
  const itDepreciationYTD = await getITDepreciation(companyFilter, from, to);

  // Headline IT spend excludes "Unclassified" (non-IT GL accounts the BC feed
  // may include) so the KPI is trustworthy IT-only spend.
  const totalSpendYTD = invoices
    .filter((inv) => isITCategory(inv.costCategory))
    .reduce((sum, inv) => sum + inv.totalAmountExcludingTax, 0);

  // Year-end projection: annualised run-rate from COMPLETE months only (excludes
  // the current partial month and any future-dated accruals), so a half-finished
  // month doesn't drag the projection down.
  const nowMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const itByMonth = new Map<string, number>();
  for (const inv of invoices) {
    if (!isITCategory(inv.costCategory)) continue;
    const m = inv.postingDate.substring(0, 7);
    itByMonth.set(m, (itByMonth.get(m) ?? 0) + inv.totalAmountExcludingTax);
  }
  const completeMonths = [...itByMonth.entries()].filter(([m]) => m < nowMonth);
  const avgMonthly = completeMonths.length
    ? completeMonths.reduce((s, [, v]) => s + v, 0) / completeMonths.length
    : 0;
  const projectedAnnualSpend = Math.round(avgMonthly * 12);

  // Filter budget entries to match the requested date range
  const fromMonth = from.substring(0, 7); // "2025-01"
  const toMonth = to.substring(0, 7);     // "2026-12"
  const budgetInRange = budget.filter((b) => b.month >= fromMonth && b.month <= toMonth);
  const totalBudgetYTD = budgetInRange.reduce((sum, b) => sum + b.budgetAmount, 0);
  const totalActualYTD = budgetInRange.reduce((sum, b) => sum + b.actualAmount, 0);
  const budgetVariancePercent =
    totalBudgetYTD > 0
      ? ((totalSpendYTD - totalBudgetYTD) / totalBudgetYTD) * 100
      : 0;

  const paidLicenses = licenses.filter((l) => l.pricePerUser > 0);
  const totalPrepaid = paidLicenses.reduce((sum, l) => sum + l.prepaidUnits, 0);
  const totalConsumed = paidLicenses.reduce((sum, l) => sum + l.consumedUnits, 0);
  const licenseUtilizationPercent =
    totalPrepaid > 0 ? (totalConsumed / totalPrepaid) * 100 : 0;

  // Spend trend: compare last 3 months vs prior 3 months (rolling)
  const sortedInvoices = [...invoices].sort((a, b) => a.postingDate.localeCompare(b.postingDate));
  const allMonths = [...new Set(sortedInvoices.map(i => i.postingDate.substring(0, 7)))].sort();
  const recentMonths = allMonths.slice(-3);
  const priorMonths = allMonths.slice(-6, -3);

  const recent = invoices
    .filter((i) => recentMonths.includes(i.postingDate.substring(0, 7)))
    .reduce((s, i) => s + i.totalAmountExcludingTax, 0);
  const prior = invoices
    .filter((i) => priorMonths.includes(i.postingDate.substring(0, 7)))
    .reduce((s, i) => s + i.totalAmountExcludingTax, 0);
  const spendChangePercent = prior > 0 ? ((recent - prior) / prior) * 100 : 0;

  return {
    totalSpendYTD,
    budgetVariancePercent,
    licenseUtilizationPercent,
    deviceCount: devices.length,
    totalBudgetYTD,
    totalActualYTD,
    itDepreciationYTD,
    projectedAnnualSpend,
    spendTrend: spendChangePercent > 2 ? "up" : spendChangePercent < -2 ? "down" : "flat",
    spendChangePercent,
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
    const per = await Promise.all(
      targets.map((c) => fetchBCDepreciationEntries(c.id, from, to).catch(() => [] as Record<string, unknown>[]))
    );
    let total = 0;
    for (const entries of per) {
      for (const g of entries) {
        total += ((g.debitAmount as number) || 0) - ((g.creditAmount as number) || 0);
      }
    }
    setCache(cacheKey, total, 120);
    return total;
  } catch {
    return 0;
  }
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
    if (!isITCategory(inv.costCategory)) continue;
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
      const companyInvoices = invoices.filter((inv) => inv.companyId === company.id);
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
  const invoices = await getInvoices(companyFilter, from, to);
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
      lastDate: "",
    };
    // Prefer the longest variant as the display name (usually most complete).
    if (inv.vendorName && inv.vendorName.length > existing.display.length) {
      existing.display = inv.vendorName;
    }
    existing.totalSpend += inv.totalAmountExcludingTax;
    existing.invoiceCount += 1;
    existing.categories.add(inv.costCategory);
    if (inv.postingDate > existing.lastDate) {
      existing.lastDate = inv.postingDate;
    }
    vendorMap.set(key, existing);
  });

  return Array.from(vendorMap.values())
    .map((data) => {
      const percentOfTotal =
        totalSpend > 0 ? (data.totalSpend / totalSpend) * 100 : 0;
      return {
        vendorName: data.display,
        vendorNumber: data.vendorNumber,
        totalSpend: data.totalSpend,
        invoiceCount: data.invoiceCount,
        percentOfTotal,
        categories: Array.from(data.categories),
        lastInvoiceDate: data.lastDate,
        isConcentrationRisk: percentOfTotal > CONCENTRATION_RISK_THRESHOLD,
      };
    })
    .sort((a, b) => b.totalSpend - a.totalSpend);
}
