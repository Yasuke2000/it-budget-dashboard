import {
  demoCompanies,
  demoInvoices,
  demoGLEntries,
  demoLicenses,
  demoDevices,
  demoBudgetEntries,
  demoPeppolInvoices,
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
  CompanyFilter,
  Employee,
  JiraWorklog,
  JiraProjectCost,
  PersonnelKPIs,
  DepartmentSummary,
} from "./types";
import type { PeppolInvoice } from "./peppol-parser";
import { CATEGORY_COLORS, CONCENTRATION_RISK_THRESHOLD } from "./constants";

function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE !== "false";
}

// ---- Companies ----
export async function getCompanies(): Promise<Company[]> {
  if (isDemoMode()) return demoCompanies;
  // TODO: Live mode — fetch from BC API
  return demoCompanies;
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
  return demoInvoices;
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
  return demoGLEntries;
}

// ---- Licenses ----
export async function getLicenses(): Promise<M365License[]> {
  if (isDemoMode()) return demoLicenses;
  return demoLicenses;
}

// ---- Devices ----
export async function getDevices(): Promise<ManagedDevice[]> {
  if (isDemoMode()) return demoDevices;
  return demoDevices;
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
  return demoBudgetEntries;
}

// ---- Dashboard KPIs ----
export async function getDashboardKPIs(
  companyFilter: CompanyFilter = "all"
): Promise<DashboardKPIs> {
  const invoices = await getInvoices(companyFilter, "2025-01-01", "2025-12-31");
  const budget = await getBudgetEntries(companyFilter);
  const licenses = await getLicenses();
  const devices = await getDevices();

  const totalSpendYTD = invoices.reduce((sum, inv) => sum + inv.totalAmountExcludingTax, 0);
  const totalBudgetYTD = budget.reduce((sum, b) => sum + b.budgetAmount, 0);
  const totalActualYTD = budget.reduce((sum, b) => sum + b.actualAmount, 0);
  const budgetVariancePercent =
    totalBudgetYTD > 0
      ? ((totalActualYTD - totalBudgetYTD) / totalBudgetYTD) * 100
      : 0;

  const paidLicenses = licenses.filter((l) => l.pricePerUser > 0);
  const totalPrepaid = paidLicenses.reduce((sum, l) => sum + l.prepaidUnits, 0);
  const totalConsumed = paidLicenses.reduce((sum, l) => sum + l.consumedUnits, 0);
  const licenseUtilizationPercent =
    totalPrepaid > 0 ? (totalConsumed / totalPrepaid) * 100 : 0;

  // Compare last 3 months to prior 3 months for trend
  const recent = invoices
    .filter((i) => i.postingDate >= "2025-07-01" && i.postingDate <= "2025-09-30")
    .reduce((s, i) => s + i.totalAmountExcludingTax, 0);
  const prior = invoices
    .filter((i) => i.postingDate >= "2025-04-01" && i.postingDate <= "2025-06-30")
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
  companyFilter: CompanyFilter = "all"
): Promise<MonthlySpend[]> {
  const invoices = await getInvoices(companyFilter, "2025-01-01", "2025-12-31");
  const budget = await getBudgetEntries(companyFilter);

  const months = Array.from({ length: 12 }, (_, i) => {
    const m = (i + 1).toString().padStart(2, "0");
    return `2025-${m}`;
  });

  return months.map((month) => {
    const monthBudget = budget.filter((b) => b.month === month);
    return {
      month,
      actual: monthBudget.reduce((s, b) => s + b.actualAmount, 0),
      budget: monthBudget.reduce((s, b) => s + b.budgetAmount, 0),
    };
  });
}

// ---- Category Spend ----
export async function getCategorySpend(
  companyFilter: CompanyFilter = "all"
): Promise<CategorySpend[]> {
  const invoices = await getInvoices(companyFilter, "2025-01-01", "2025-12-31");
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
export async function getEntitySpend(): Promise<EntitySpend[]> {
  const companies = await getCompanies();
  const invoices = await getInvoices("all", "2025-01-01", "2025-12-31");

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
  // Live mode: placeholder — integrate Jira REST API here
  const mockData = await import("../data/mock/jira-worklogs.json");
  return mockData.default as JiraWorklog[];
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
  const totalPersonnelCost = itTeam.reduce((sum, e) => sum + (e.monthlyCost || 0), 0);
  const avgITCostPerEmployee = itTeam.length > 0 ? totalPersonnelCost / itTeam.length : 0;

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
      itCostPerUser: data.headcount > 0 ? totalPersonnelCost / active.length : 0,
      totalITCost: (totalPersonnelCost / active.length) * data.headcount,
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
  };
}

// ---- Peppol Invoices ----
export async function getPeppolInvoices(): Promise<PeppolInvoice[]> {
  if (isDemoMode()) {
    return demoPeppolInvoices;
  }
  return demoPeppolInvoices; // TODO: live Peppol Access Point integration
}

// ---- Vendor Summary ----
export async function getVendorSummary(
  companyFilter: CompanyFilter = "all"
): Promise<VendorSummary[]> {
  const invoices = await getInvoices(companyFilter, "2025-01-01", "2025-12-31");
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
