// ============================================================
// IT Budget Dashboard — Core Type Definitions
// ============================================================

export interface Company {
  id: string;
  name: string;
  displayName: string;
}

export interface PurchaseInvoice {
  id: string;
  number: string;
  invoiceDate: string;
  postingDate: string;
  dueDate: string;
  vendorNumber: string;
  vendorName: string;
  totalAmountExcludingTax: number;
  totalAmountIncludingTax: number;
  totalTaxAmount: number;
  status: "Draft" | "Open" | "Paid" | "Canceled";
  currencyCode: string;
  companyId: string;
  companyName: string;
  costCategory: string;
  lines: PurchaseInvoiceLine[];
}

export interface PurchaseInvoiceLine {
  lineType: string;
  description: string;
  unitCost: number;
  quantity: number;
  netAmount: number;
  accountId: string;
  accountNumber: string;
}

export interface GeneralLedgerEntry {
  id: number;
  postingDate: string;
  accountNumber: string;
  accountName: string;
  description: string;
  debitAmount: number;
  creditAmount: number;
  documentType: string;
  documentNumber: string;
  companyId: string;
  companyName: string;
  costCategory: string;
}

export interface GLAccount {
  number: string;
  displayName: string;
  category: "Assets" | "Liabilities" | "Equity" | "Income" | "Expense";
  subCategory: string;
  balance: number;
  netChange: number;
}

export interface M365License {
  skuId: string;
  skuPartNumber: string;
  displayName: string;
  prepaidUnits: number;
  consumedUnits: number;
  utilizationRate: number;
  pricePerUser: number;
  monthlyCost: number;
  wastedUnits: number;
  wastedCost: number;
}

export interface ManagedDevice {
  id: string;
  deviceName: string;
  model: string;
  manufacturer: string;
  serialNumber: string;
  osVersion: string;
  operatingSystem: string;
  enrolledDateTime: string;
  complianceState: "compliant" | "noncompliant" | "unknown";
  managedDeviceOwnerType: "company" | "personal";
  chassisType: "desktop" | "laptop" | "tablet" | "phone" | "unknown";
  ageYears: number;
  assignedUser: string;
}

export interface BudgetEntry {
  id: string;
  category: string;
  month: string; // "2025-01", "2025-02", etc.
  budgetAmount: number;
  actualAmount: number;
  variance: number;
  variancePercent: number;
  companyId: string;
}

export interface VendorSummary {
  vendorName: string;
  vendorNumber: string;
  totalSpend: number;
  invoiceCount: number;
  percentOfTotal: number;
  categories: string[];
  lastInvoiceDate: string;
  contractRenewalDate?: string;
  isConcentrationRisk: boolean;
}

export interface DashboardKPIs {
  totalSpendYTD: number;
  budgetVariancePercent: number;
  licenseUtilizationPercent: number;
  deviceCount: number;
  totalBudgetYTD: number;
  totalActualYTD: number;
  spendTrend: "up" | "down" | "flat";
  spendChangePercent: number;
}

export interface MonthlySpend {
  month: string;
  actual: number;
  budget: number;
  forecast?: number;
}

export interface CategorySpend {
  category: string;
  amount: number;
  budget: number;
  variance: number;
  variancePercent: number;
  color: string;
}

export interface EntitySpend {
  companyId: string;
  companyName: string;
  totalSpend: number;
  perUserSpend: number;
  userCount: number;
}

export interface GLMapping {
  accountNumber: string;
  category: string;
}

export interface LicensePrice {
  skuPartNumber: string;
  displayName: string;
  pricePerUser: number;
}

export interface SyncStatus {
  lastSyncAt: string | null;
  status: "idle" | "syncing" | "success" | "error";
  message: string;
  entitiesSynced: number;
}

export type ITCategory =
  | "Software & Licenses"
  | "Hardware (Depreciation)"
  | "Hardware (Purchases)"
  | "Cloud & Hosting"
  | "External IT Services"
  | "Telecom"
  | "Security"
  | "IT Personnel"
  | "Other IT";

export type CompanyFilter = "all" | string;

export interface DateRange {
  from: string;
  to: string;
}
