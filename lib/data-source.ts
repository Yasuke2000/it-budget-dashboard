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
  PurchaseInvoiceLine,
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
import { CATEGORY_COLORS, CONCENTRATION_RISK_THRESHOLD, DEFAULT_GL_MAPPING } from "./constants";
import { generateAllInsights } from "./cost-insights";
import type { CostInsight } from "./cost-insights";
import { getCache, setCache } from "./sync-cache";
import { fetchBCCompanies, fetchBCInvoices, fetchBCGLEntries } from "./bc-client";
import {
  fetchSubscribedSkus,
  fetchManagedDevices,
  mapGraphLicenseToM365License,
  mapGraphDeviceToManagedDevice,
} from "./graph-client";
import { fetchJiraWorklogs as fetchLiveJiraWorklogs } from "./jira-client";

function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE !== "false";
}

// ---- Companies ----
export async function getCompanies(): Promise<Company[]> {
  if (isDemoMode()) return demoCompanies;

  const cacheKey = "companies";
  const cached = getCache<Company[]>(cacheKey);
  if (cached) return cached;

  try {
    const bcCompanies = await fetchBCCompanies();
    const companies: Company[] = bcCompanies.map((c) => ({
      id: (c.id as string) || "",
      name: (c.name as string) || "",
      displayName: (c.displayName as string) || (c.name as string) || "",
    }));
    setCache(cacheKey, companies, 60 * 24); // 24h TTL
    return companies;
  } catch (err) {
    console.warn("BC API error (companies), falling back to demo data:", err);
    return demoCompanies;
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
    return invoices;
  }

  const from = dateFrom ?? "2025-01-01";
  const to = dateTo ?? "2025-12-31";
  const cacheKey = `invoices-${companyFilter}-${from}-${to}`;
  const cached = getCache<PurchaseInvoice[]>(cacheKey);
  if (cached) return cached;

  try {
    const companies = await getCompanies();
    const targetCompanies =
      companyFilter === "all"
        ? companies
        : companies.filter((c) => c.id === companyFilter);

    const allInvoices: PurchaseInvoice[] = [];
    for (const company of targetCompanies) {
      const bcInvoices = await fetchBCInvoices(company.id, from, to);
      for (const inv of bcInvoices) {
        const lines = (
          (inv.purchaseInvoiceLines as Array<Record<string, unknown>>) || []
        ).map(
          (line): PurchaseInvoiceLine => ({
            lineType: (line.lineType as string) || "",
            description: (line.description as string) || "",
            unitCost: (line.unitCost as number) || 0,
            quantity: (line.quantity as number) || 0,
            netAmount: (line.netAmount as number) || 0,
            accountId: (line.accountId as string) || "",
            accountNumber: (line.accountNumber as string) || "",
          })
        );

        // Derive cost category from GL account of first line
        const firstAccount = lines[0]?.accountNumber || "";
        const costCategory =
          DEFAULT_GL_MAPPING[firstAccount] || "Other IT";

        allInvoices.push({
          id: (inv.id as string) || "",
          number: (inv.number as string) || "",
          invoiceDate: (inv.invoiceDate as string) || "",
          postingDate: (inv.postingDate as string) || "",
          dueDate: (inv.dueDate as string) || "",
          vendorNumber: (inv.buyFromVendorNumber as string) || (inv.vendorNumber as string) || "",
          vendorName: (inv.buyFromVendorName as string) || (inv.vendorName as string) || "",
          totalAmountExcludingTax: (inv.totalAmountExcludingTax as number) || 0,
          totalAmountIncludingTax: (inv.totalAmountIncludingTax as number) || 0,
          totalTaxAmount: (inv.totalTaxAmount as number) || 0,
          status: ((inv.status as string) as PurchaseInvoice["status"]) || "Open",
          currencyCode: (inv.currencyCode as string) || "EUR",
          companyId: company.id,
          companyName: company.displayName,
          costCategory,
          lines,
        });
      }
    }

    setCache(cacheKey, allInvoices, 120); // 2h TTL
    return allInvoices;
  } catch (err) {
    console.warn("BC API error (invoices), falling back to demo data:", err);
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
    return invoices;
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

  const from = dateFrom ?? "2025-01-01";
  const to = dateTo ?? "2025-12-31";
  const cacheKey = `gl-entries-${companyFilter}-${from}-${to}`;
  const cached = getCache<GeneralLedgerEntry[]>(cacheKey);
  if (cached) return cached;

  try {
    const companies = await getCompanies();
    const targetCompanies =
      companyFilter === "all"
        ? companies
        : companies.filter((c) => c.id === companyFilter);

    const allEntries: GeneralLedgerEntry[] = [];
    for (const company of targetCompanies) {
      const bcEntries = await fetchBCGLEntries(company.id, from, to);
      for (const entry of bcEntries) {
        const accountNumber = (entry.accountNumber as string) || "";
        const costCategory =
          DEFAULT_GL_MAPPING[accountNumber] || "Other IT";

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
    console.warn("BC API error (GL entries), falling back to demo data:", err);
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
}

// ---- Licenses ----
export async function getLicenses(): Promise<M365License[]> {
  if (isDemoMode()) return demoLicenses;

  const cacheKey = "licenses";
  const cached = getCache<M365License[]>(cacheKey);
  if (cached) return cached;

  try {
    const skus = await fetchSubscribedSkus();
    const licenses: M365License[] = skus.map(mapGraphLicenseToM365License);
    setCache(cacheKey, licenses, 240); // 4h TTL
    return licenses;
  } catch (err) {
    console.warn("Graph API error (licenses), falling back to demo data:", err);
    return demoLicenses;
  }
}

// ---- Devices ----
export async function getDevices(): Promise<ManagedDevice[]> {
  if (isDemoMode()) return demoDevices;

  const cacheKey = "devices";
  const cached = getCache<ManagedDevice[]>(cacheKey);
  if (cached) return cached;

  try {
    const rawDevices = await fetchManagedDevices();
    const devices: ManagedDevice[] = rawDevices.map(mapGraphDeviceToManagedDevice);
    setCache(cacheKey, devices, 240); // 4h TTL
    return devices;
  } catch (err) {
    console.warn("Graph API error (devices), falling back to demo data:", err);
    return demoDevices;
  }
}

// ---- Contracts ----
export async function getContracts(): Promise<Contract[]> {
  if (isDemoMode()) return demoContracts;

  // No live API source for contracts yet — return demo data
  console.warn("getContracts: no live API source configured, returning demo data");
  return demoContracts;
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

  // No live API source for budget entries yet — return demo data
  console.warn("getBudgetEntries: no live API source configured, returning demo data");
  if (companyFilter !== "all") {
    return demoBudgetEntries.filter((b) => b.companyId === companyFilter || b.companyId === "all");
  }
  return demoBudgetEntries;
}

// ---- Dashboard KPIs ----
export async function getDashboardKPIs(
  companyFilter: CompanyFilter = "all",
  dateFrom?: string,
  dateTo?: string
): Promise<DashboardKPIs> {
  const from = dateFrom ?? "2025-01-01";
  const to = dateTo ?? "2025-12-31";
  const invoices = await getInvoices(companyFilter, from, to);
  const budget = await getBudgetEntries(companyFilter);
  const licenses = await getLicenses();
  const devices = await getDevices();

  const totalSpendYTD = invoices.reduce((sum, inv) => sum + inv.totalAmountExcludingTax, 0);

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
    spendTrend: spendChangePercent > 2 ? "up" : spendChangePercent < -2 ? "down" : "flat",
    spendChangePercent,
  };
}

// ---- Monthly Spend Trend ----
export async function getMonthlySpend(
  companyFilter: CompanyFilter = "all",
  dateFrom?: string,
  dateTo?: string
): Promise<MonthlySpend[]> {
  const from = dateFrom ?? "2025-01-01";
  const to = dateTo ?? "2025-12-31";
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

  return months
    .map((month) => {
      const monthBudget = budget.filter((b) => b.month === month);
      return {
        month,
        actual: monthBudget.reduce((s, b) => s + b.actualAmount, 0),
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
  const from = dateFrom ?? "2025-01-01";
  const to = dateTo ?? "2025-12-31";
  const invoices = await getInvoices(companyFilter, from, to);
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
  const from = dateFrom ?? "2025-01-01";
  const to = dateTo ?? "2025-12-31";
  const companies = await getCompanies();
  const invoices = await getInvoices("all", from, to);

  // Approximate user counts per entity
  const userCounts: Record<string, number> = {
    "comp-gdi": 55,
    "comp-whs": 30,
    "comp-gre": 10,
    "comp-tdr": 35,
  };

  return companies.map((company) => {
    const companyInvoices = invoices.filter(
      (inv) => inv.companyId === company.id
    );
    const totalSpend = companyInvoices.reduce(
      (s, i) => s + i.totalAmountExcludingTax,
      0
    );
    const users = userCounts[company.id] || 20;
    return {
      companyId: company.id,
      companyName: company.displayName,
      totalSpend,
      perUserSpend: totalSpend / users,
      userCount: users,
    };
  });
}

// ---- Employees ----
export async function getEmployees(): Promise<Employee[]> {
  if (isDemoMode()) {
    const mockData = await import("../data/mock/employees.json");
    return (mockData.default as Employee[]);
  }
  // Live mode: fetch from Officient
  const { fetchEmployees, fetchAssets } = await import("./officient-client");
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

  return officientEmployees.map((e) => ({
    id: e.id,
    name: e.name,
    email: e.email,
    department: e.department,
    functionTitle: e.function_title,
    startDate: e.start_date,
    status: e.status,
    assets: assetsByPerson.get(e.id) || [],
  }));
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
    console.warn("Jira API error (worklogs), falling back to demo data:", err);
    const mockData = await import("../data/mock/jira-worklogs.json");
    return mockData.default as JiraWorklog[];
  }
}

// ---- Jira Project Costs (derived) ----
export async function getJiraProjectCosts(): Promise<JiraProjectCost[]> {
  const worklogs = await getJiraWorklogs();

  const PROJECT_NAMES: Record<string, string> = {
    ITSUP: "IT Support",
    INFRA: "Infrastructure",
    SEC: "Security",
    PROJ: "Projects",
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

  // Estimate external IT services and tools/licenses from invoice data (monthly avg YTD)
  // Using fixed estimates based on demo data — in live mode these would come from invoices
  const externalServicesCost = 8_250; // e.g. consultants, MSP, external IT projects
  const toolsLicensesCost = 4_180;   // e.g. M365, SaaS tools, antivirus

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

  // No live API source for Peppol invoices yet — return demo data
  console.warn("getPeppolInvoices: no live API source configured, returning demo data");
  return demoPeppolInvoices;
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

// ---- Vendor Summary ----
export async function getVendorSummary(
  companyFilter: CompanyFilter = "all",
  dateFrom?: string,
  dateTo?: string
): Promise<VendorSummary[]> {
  const from = dateFrom ?? "2025-01-01";
  const to = dateTo ?? "2025-12-31";
  const invoices = await getInvoices(companyFilter, from, to);
  const totalSpend = invoices.reduce(
    (s, i) => s + i.totalAmountExcludingTax,
    0
  );

  const vendorMap = new Map<
    string,
    {
      vendorNumber: string;
      totalSpend: number;
      invoiceCount: number;
      categories: Set<string>;
      lastDate: string;
    }
  >();

  invoices.forEach((inv) => {
    const existing = vendorMap.get(inv.vendorName) || {
      vendorNumber: inv.vendorNumber,
      totalSpend: 0,
      invoiceCount: 0,
      categories: new Set<string>(),
      lastDate: "",
    };
    existing.totalSpend += inv.totalAmountExcludingTax;
    existing.invoiceCount += 1;
    existing.categories.add(inv.costCategory);
    if (inv.postingDate > existing.lastDate) {
      existing.lastDate = inv.postingDate;
    }
    vendorMap.set(inv.vendorName, existing);
  });

  return Array.from(vendorMap.entries())
    .map(([vendorName, data]) => {
      const percentOfTotal =
        totalSpend > 0 ? (data.totalSpend / totalSpend) * 100 : 0;
      return {
        vendorName,
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
