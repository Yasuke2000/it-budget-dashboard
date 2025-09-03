import {
  demoCompanies,
  demoInvoices,
  demoGLEntries,
  demoLicenses,
  demoDevices,
  demoBudgetEntries,
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
} from "./types";
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
    const monthInvoices = invoices.filter((inv) =>
      inv.postingDate.startsWith(month)
    );
    const monthBudget = budget.filter((b) => b.month === month);
    return {
      month,
      actual: monthInvoices.reduce((s, i) => s + i.totalAmountExcludingTax, 0),
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
