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

// Monthly IT-personnel cost imported from EasyPay (social secretariat) payroll
// exports. EasyPay has no API, so this arrives as a CSV/TXT file via manual
// upload or automated drop and is merged into spend as an "IT Personnel" line.
export interface PayrollCostEntry {
  month: string;       // "YYYY-MM"
  companyId: string;   // "all" or "comp-*"
  amount: number;      // employer cost in EUR
  headcount?: number;
  source: string;      // e.g. "EasyPay"
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
  // 'safe' (<25%), 'watch' (25–30%), 'risk' (>30%). EASI at ~29.7% is "watch".
  concentrationLevel: "safe" | "watch" | "risk";
  // Which Gheeraert entities the vendor's spend comes from (so you can see where
  // the spend originates), highest first.
  entities: { name: string; spend: number }[];
}

export interface DashboardKPIs {
  totalSpendYTD: number;
  budgetVariancePercent: number;
  // 'favorable' = under budget, 'unfavorable' = over, 'na' = no budget set.
  budgetFavorability: "favorable" | "unfavorable" | "na";
  licenseUtilizationPercent: number;
  // Active-to-provisioned (FinOps): % of paid seats whose user was active
  // recently. null until the Graph Reports permission is granted.
  licenseActiveUsagePercent: number | null;
  deviceCount: number;
  totalBudgetYTD: number;
  totalActualYTD: number;
  itDepreciationYTD: number;
  // Run-rate projection (avg of complete months × 12) + how many months it used.
  projectedAnnualSpend: number;
  projectionMonths: number;
  // Trailing-twelve-months: sum of the last 12 complete months. 0 until 12 exist.
  annualisedSpendTTM: number;
  // Opex vs capitalised IT purchases (for the ~25/75 capex benchmark).
  opexYTD: number;
  capexYTD: number;
  // IT spend as % of group revenue + the benchmark to compare against.
  groupRevenue: number;
  revenueIsConsolidated: boolean;
  itSpendPercentOfRevenue: number;
  revenueBenchmarkPercent: number;
  spendTrend: "up" | "down" | "flat";
  spendChangePercent: number;
  // Whether the trend is trustworthy enough to show. False while we lack a
  // seasonality-proof comparison: IT spend is lumpy (annual licences cluster in
  // Q1), so quarter-over-quarter is misleading, and a year-over-year baseline
  // isn't usable yet (pre-2025 BC data has migration reversals). Consumers hide
  // the trend when this is false rather than show a seasonal artefact.
  spendTrendReliable: boolean;
  // Accounts payable on IT spend: how much of the IT spend in this period sits on
  // invoices BC still marks "Open" (posted, not yet paid), and how much of that is
  // past its due date. Accrual spend total is unaffected — this is a cash view.
  openInvoiceAmount: number;
  openInvoiceCount: number;
  overdueAmount: number;
  overdueCount: number;
  // Internal IT-staff cost (from BC, AFDELING=IT department dimension on class-62)
  // and the fully-loaded Total Cost of IT = external spend + internal labour.
  itPersonnelCost: number;
  totalCostOfIT: number;
}

export interface MonthlySpend {
  month: string;
  actual: number;
  budget: number;
  forecast?: number;
}

// Spend forecast for budget planning. Each point is one month: history months have
// `actual` (incl. flat personnel), future months have `forecast`.
export interface ForecastPoint {
  month: string;
  actual: number | null;
  forecast: number | null;
}
export interface SpendForecast {
  points: ForecastPoint[];      // ~12 history + 12 forecast months
  annualForecast: number;       // sum of the next 12 forecast months (incl. personnel + scenario)
  monthlyPersonnel: number;     // flat recurring internal IT-staff cost / month
  includesPersonnel: boolean;
  annualBudget: number;         // sum of configured budgets over the forecast window (0 = none set)
  growthPct: number;            // scenario: % growth applied to the variable (tools) part
  extraMonthly: number;         // scenario: flat extra €/month (new tool / hire)
  method: string;
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

// === HR / Personnel ===

export interface Employee {
  id: number;
  name: string;
  email: string;
  department: string;
  functionTitle: string;
  startDate: string;
  status: "active" | "inactive";
  monthlyCost?: number;
  /** Jobstudent — variable hours; excluded from the IT salary cost total. */
  isStudent?: boolean;
  /** External contractor (e.g. ALLPHI); cost from BC vendor spend, counted under External Services. */
  isExternal?: boolean;
  assets?: EmployeeAsset[];
}

export interface EmployeeAsset {
  id: number;
  name: string;
  description: string;
  category: string;
}

export interface DepartmentSummary {
  name: string;
  headcount: number;
  itCostPerUser: number;
  totalITCost: number;
  assets: number;
}

export interface PersonnelKPIs {
  totalHeadcount: number;
  itHeadcount: number;
  avgITCostPerEmployee: number;
  totalPersonnelCost: number;
  assetCount: number;
  departments: DepartmentSummary[];
  /** Monthly cost of internal IT salaries */
  itSalaryCost: number;
  /** Estimated monthly external IT services cost (from invoices) */
  externalServicesCost: number;
  /** Estimated monthly tools/licenses cost */
  toolsLicensesCost: number;
  /** IT headcount as % of total headcount */
  itStaffRatio: number;
}

// === Jira / Time Tracking ===

export interface JiraWorklog {
  issueKey: string;
  issueSummary: string;
  author: string;
  timeSpentSeconds: number;
  timeSpentHours: number;
  started: string;
  project: string;
  hourlyCost?: number;
  totalCost?: number;
}

export interface JiraProjectCost {
  projectKey: string;
  projectName: string;
  totalHours: number;
  totalCost: number;
  contributors: number;
}

// === Software Licenses (non-Microsoft / manually tracked) ===
// M365 licenses come live from Graph (M365License). This covers everything else
// — Adobe, antivirus, SaaS subscriptions, perpetual/maintenance licenses — tracked
// manually or via CSV/automated import.
export interface SoftwareLicense {
  id: string;
  vendor: string;
  product: string;
  licenseType: "subscription" | "perpetual" | "open-source" | "maintenance";
  seats: number;          // total / purchased
  assignedSeats: number;  // in use
  unitCost: number;       // cost per seat per billing cycle
  billingCycle: "monthly" | "quarterly" | "annual" | "one-time";
  monthlyCost: number;    // normalized
  annualCost: number;     // normalized
  renewalDate?: string;   // "YYYY-MM-DD"
  autoRenew?: boolean;
  category: string;       // IT cost category, e.g. "Software & Licenses", "Security"
  source: string;         // "manual" | "csv"
  notes?: string;
}

// === Contracts ===

export interface Contract {
  id: string;
  vendor: string;
  description: string;
  category: 'license' | 'domain' | 'ssl' | 'support' | 'saas' | 'infrastructure';
  startDate: string;
  endDate: string;
  renewalType: 'auto' | 'manual';
  autoRenew: boolean;
  noticePeriodDays: number;
  monthlyCost: number;
  annualCost: number;
  billingCycle: 'monthly' | 'quarterly' | 'annual' | 'multi-year';
  status: 'active' | 'expiring_soon' | 'expired' | 'cancelled';
  owner: string;
  notes: string;
  tags: string[];
  // Optional uploaded contract document (PDF/etc.) stored on the data volume.
  fileId?: string;
  fileName?: string;
}

// === Savings Pipeline ===
export interface SavingsOpportunity {
  id: string;
  sku: string;
  displayName: string;
  unusedCount: number;
  pricePerUser: number;
  monthlyWaste: number;
  annualSavings: number;
  status: 'identified' | 'in_review' | 'approved' | 'reclaimed';
  utilization: number; // percentage
  totalLicenses: number;
  assignedLicenses: number;
}

// License-harvesting summary. Two distinct reclaimable pools:
//  • unassigned seats — paid but not assigned to anyone (exact, per-SKU price)
//  • inactive-assigned users — hold a licence but no M365 activity in 30 days
//    (count is exact from the Graph active-user report; the € is an ESTIMATE
//    using the blended average price of an assigned seat, since the report is
//    per-user not per-SKU).
export interface LicenseHarvest {
  hasUsageData: boolean;        // false when the Graph Reports permission/report is unavailable
  licensedUsers: number;
  activeUsers: number;
  inactiveUsers: number;        // licensed but inactive 30d
  activePercent: number | null;
  unassignedSeats: number;
  unassignedMonthly: number;    // exact
  blendedSeatMonthly: number;   // avg €/assigned seat (basis for the inactive estimate)
  inactiveMonthlyEstimate: number;
  totalReclaimableAnnual: number; // (unassignedMonthly + inactiveMonthlyEstimate) × 12
}

// === Jira developer KPIs ===
export interface JiraDevStat {
  opened: number;   // tickets created (reporter) in the window
  closed: number;   // tickets resolved/Done (assignee) in the window
  openNow: number;  // currently open tickets (assignee, not Done)
  updated: number;  // tickets updated (assignee) in the window
  hours: number;    // hours logged (worklogs) in the window
  responseHours: number | null; // avg hours from ticket creation to first comment/worklog (null if none)
}
export interface JiraMetrics {
  configured: boolean;
  partial: boolean;            // true when the worklog-hours scan hit the issue cap
  countsReliable: boolean;     // false if any ticket-count query failed (shown as a warning, not a silent 0)
  team: JiraDevStat;           // whole project(s) GP+IT
  perDev: Record<string, JiraDevStat>; // keyed by developer email
}

// === Developer productivity (Azure DevOps) ===
export interface DeveloperStat {
  name: string;
  email: string;
  commits: number;
  filesAdded: number;
  filesEdited: number;
  filesDeleted: number;
  filesChanged: number;
  avgFilesPerCommit: number;
  contributionPercent: number; // share of total commits in the window
  issues: number;              // distinct Jira issue keys referenced in this dev's commit messages
}

// Cost-vs-output ROI row per developer (cost resolved from BC: external vendor or
// internal IT-dept payroll). costPerCommit/costPerIssue are null when cost is
// unknown (internal per-person) or excluded (management).
export interface DeveloperROIRow {
  name: string;
  email: string;
  commits: number;
  issues: number;
  filesChanged: number;
  costLabel: string;
  periodCost: number | null;
  costPerCommit: number | null;
  costPerIssue: number | null;
  note?: string;
}
export interface BranchStat {
  name: string;
  commits: number;
  lastActivity: string | null;
}
export interface DevCommit {
  id: string;
  author: string;
  email: string;
  branch?: string;
  message: string;
  date: string;
  filesChanged: number;
}
export interface FileChurn {
  path: string;
  changes: number;
  contributors: string[];
}
export interface DeveloperDashboard {
  configured: boolean;
  org?: string;
  project?: string;
  repo?: string;
  rangeFrom: string;
  rangeTo: string;
  totalCommits: number;
  developerCount: number;
  totalFilesChanged: number;
  totalIssues: number;
  commitsTruncated: boolean;  // true if the 5000-commit pagination cap was hit (undercount)
  churnSampled: boolean;      // true if churn was computed from a capped sample of commits
  filesAdded: number;
  filesEdited: number;
  filesDeleted: number;
  developers: DeveloperStat[];
  branches: BranchStat[];
  recentCommits: DevCommit[];
  churn: FileChurn[];
  avgFilesPerCommit: number;
  smallCommits: number;
  largeCommits: number;
  notes: string[];
  roi?: DeveloperROIRow[];        // cost-vs-output, assembled in the API route
  itDeptPayrollPeriod?: number;   // internal IT-dept payroll for the window (context for internal devs)
  jira?: JiraMetrics;             // Jira ticket + hours KPIs, assembled in the API route
}

// === Warranty ===

export interface WarrantyInfo {
  serialNumber: string;
  manufacturer: string;
  model: string;
  warrantyType: string;
  startDate: string;
  endDate: string;
  daysRemaining: number;
  status: "active" | "expired" | "expiring_soon";
}
