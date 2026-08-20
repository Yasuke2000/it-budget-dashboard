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
  // True when this is a provisional baseline derived from trailing-year actuals
  // (no approved budget configured in Settings). UI labels it as such.
  provisional?: boolean;
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
  // Personnel-INCLUSIVE ratio (Total Cost of IT ÷ revenue). This is the
  // benchmark-comparable figure; itSpendPercentOfRevenue above is tools-only.
  totalCostPercentOfRevenue: number;
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
  // Overdue amount split by how far past due — so "1 day late" isn't shown the
  // same as "6 months late". Only the aged buckets (>90d) are a real concern.
  overdueAging: { d0_30: number; d31_90: number; d91_180: number; d180plus: number };
  // True when budget vs actual is running against a provisional baseline
  // (trailing-year actuals) rather than an approved budget from Settings.
  budgetIsProvisional: boolean;
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
  annualBudget: number;         // sum of budgets over the forecast window (0 = none)
  budgetProvisional: boolean;   // true = baseline from trailing-year actuals, not an approved budget
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

// Entra ID (Azure AD) user — for license-reclaim / orphaned-account reconciliation.
export interface EntraUser {
  id: string;
  displayName: string;
  userPrincipalName: string;
  mail: string | null;
  accountEnabled: boolean;
  licenseCount: number;
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

// === CFO Cockpit (group financials — P&L, cash, working capital) ===
// A drill-downable financial statement view sourced from BC general-ledger
// entries (PCMN classes 6/7 for the P&L, class 55 for cash) + open vendor
// ledger for AP aging. Each P&L line carries the underlying accounts so the UI
// can drill from a headline number down to its source GL accounts.

export interface CfoAccountRow {
  accountNumber: string;
  accountName: string;
  amount: number; // positive magnitude in EUR
}

// One block of the P&L waterfall. `kind` drives colour/sign in the chart.
export interface CfoPnlLine {
  key: string;
  label: string;
  amount: number;                 // signed: income +, expense −, subtotal = running result
  kind: "income" | "expense" | "subtotal";
  pnlClass: string;               // PCMN class prefix ("70", "61", …) or "" for subtotals
  accounts: CfoAccountRow[];      // underlying GL accounts (the drill-down "source")
}

export interface CfoEntityRow {
  code: string;                   // BC company code (GTR, GDI, …)
  companyName: string;
  revenue: number;
  costs: number;
  result: number;
  marginPct: number;
}

export interface CfoMonthPoint {
  month: string;                  // "YYYY-MM"
  revenue: number;
  costs: number;
  result: number;
  // Per 2-digit expense class (60–64), for the month × class heatmap.
  byClass?: Record<string, number>;
}

// One open item inside an aging bucket — drillable to its BC document.
export interface CfoAgingItem {
  name: string;                   // vendor/customer name
  company: string;                // short company code (GTR, GDI, …)
  docNo: string;
  due: string;                    // "YYYY-MM-DD" or ""
  amount: number;
  ic: boolean;                    // intercompany (name-matched)
  bcUrl: string;                  // deep-link naar de boeking in Business Central
}

export interface CfoAgingBucket {
  label: string;                  // "Niet vervallen", "< 30d", …
  amount: number;
  extern?: number;                // external-only portion (intercompany removed)
  items?: CfoAgingItem[];         // largest open items in this bucket (capped)
  itemCount?: number;             // true item count before the cap
}

// Liquidity & working-capital ratios (working-capital view; not a full balance sheet).
export interface CfoRatios {
  currentRatio: number;           // current assets / current liabilities
  quickRatio: number;             // (cash + AR) / current liabilities
  solvencyPct: number;            // equity / total assets ×100 (approx)
  dso: number;                    // days sales outstanding (AR ÷ revenue × days)
  dpo: number;                    // days payable outstanding (AP ÷ costs × days)
  dio: number;                    // days inventory outstanding
  ccc: number;                    // cash conversion cycle = DSO + DIO − DPO
  approx: boolean;                // true when current liabilities ≈ AP (no full BS)
}

export interface CfoBalanceLine {
  label: string;
  amount: number;
  group: "asset" | "liability" | "equity";
}
export interface CfoBalanceSheet {
  assets: CfoBalanceLine[];
  claims: CfoBalanceLine[];       // liabilities + equity
  totalAssets: number;
  totalClaims: number;
  complete: boolean;              // false = condensed (reliable pieces only)
  asOf: string;
}

export interface CfoCashWeek {
  weekStart: string;              // "YYYY-MM-DD" (Monday)
  label: string;                  // "wk 01", …
  inflow: number;
  outflow: number;
  net: number;
  closing: number;                // projected cash balance at end of week
}
export interface CfoCashForecast {
  openingCash: number;
  weeks: CfoCashWeek[];           // 13 rolling weeks
  lowestClosing: number;
  lowestWeekLabel: string;
  assumptions: string[];
}

export interface CfoBudget {
  configured: boolean;
  revenueTarget: number;          // annual
  costTarget: number;             // annual
  monthlyRevenueTarget: number;
  monthlyCostTarget: number;
  revenueVariancePct: number;     // YTD actual vs pro-rata target
  resultVariancePct: number;
  // Per-expense-class targets (annual) vs YTD actual, pro-rated.
  classVariance?: {
    cls: string;                  // "60" … "64"
    label: string;
    target: number;               // annual target
    actual: number;               // YTD actual
    proRata: number;              // pro-rata target for the elapsed period
    variancePct: number;          // (actual − proRata) / proRata × 100
  }[];
}

export interface CfoKpis {
  revenue: number;
  costs: number;
  operatingResult: number;        // EBIT
  operatingMarginPct: number;
  ebitda: number;
  netResult: number;              // after financial result, non-recurring items and taxes
  cash: number;
  apOpen: number;                 // open payables (money out)
  arOpen: number;                 // open receivables (money in); 0/null when not available
  apOpenExtern: number;           // AP excluding intercompany
  arOpenExtern: number;           // AR excluding intercompany
}

// Same-period-last-year totals, so every headline KPI carries a ΔPY comparison.
export interface CfoPrevYear {
  revenue: number;
  ebitda: number;
  ebit: number;
  netResult: number;
}

export interface CfoSource {
  label: string;
  detail: string;
}

export interface CfoFinancials {
  period: { from: string; to: string; label: string };
  company: string;                // "all" or a company code
  isLive: boolean;                // false = demo/sample data
  generatedAt: string;
  kpis: CfoKpis;
  pnl: CfoPnlLine[];              // ordered waterfall (revenue → … → operating result)
  costStructure: CfoAccountRow[]; // expense classes for the donut (accountName = class label)
  monthly: CfoMonthPoint[];
  apAging: CfoAgingBucket[];
  entities: CfoEntityRow[];
  sources: CfoSource[];           // provenance shown in the drill/source panel
  notes: string[];
  // --- extended sections (working capital, cash forecast, balance, budget) ---
  arAging?: CfoAgingBucket[];
  ratios?: CfoRatios;
  balanceSheet?: CfoBalanceSheet;
  cashForecast?: CfoCashForecast;
  budget?: CfoBudget;
  prevYear?: CfoPrevYear;
  // Consolidation scope: every operating entity + which are excluded from this view.
  scope?: { all: { code: string; name: string }[]; excluded: string[] };
  // Set when this is a stored point-in-time snapshot being viewed (ISO timestamp
  // of when it was taken) — the UI shows a banner instead of the live stamp.
  snapshotOf?: string;
  // Honest failure/refresh surfacing — never silently present sample data as live.
  loadError?: string;   // live fetch failed → demo shown WITH this reason banner
  refreshing?: boolean; // background rebuild running; page shows cached data meanwhile
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

// === CFO — Klanten & cash (DSO/factoring/betaalgedrag/BTW) ===
// Payload van /api/cfo/receivables en /api/cfo/vat — de "deep-dive" die de CFO
// vroeg: DSO per categorie, echt betaalgedrag, factoring-dynamiek en BTW-positie.

export type RcvCategory = "extFactoring" | "extOther" | "ic";

export interface RcvDsoSeries {
  months: string[];                          // "YYYY-MM", oplopend
  // DSO per categorie (balansmethode: AR-eindsaldo ÷ verkopen van de maand × dagen).
  dsoTotal: (number | null)[];               // extern totaal (factoring + niet-factoring)
  dsoExtFactoring: (number | null)[];
  dsoExtOther: (number | null)[];
  dsoCountback: (number | null)[];           // countback-methode (extern totaal) — robuust bij seizoensomzet
  dpoTotal: (number | null)[];               // leverancierszijde (extern), ter vergelijking
  arEndByCat: Record<RcvCategory, number[]>; // AR-eindsaldo per maandeinde, incl. btw
  salesByCat: Record<RcvCategory, number[]>; // gefactureerd per maand (CLE-facturen), incl. btw
}

export interface RcvSpeedBucket { label: string; amount: number; count: number }

export interface RcvInvoiceItem {
  company: string; customer: string; docNo: string; invDate: string; dueDate: string;
  amount: number; open: boolean; daysToPay: number | null; daysVsDue: number | null;
  via: string;                               // dagboek-code van de betaling ("KBCF", "BELF", …) of ""
  bcUrl: string;
}

export interface RcvCustomerRow {
  name: string;                               // genormaliseerde naam
  companies: string[];                        // firma's waar deze klant voorkomt
  invoiced12m: number;                        // gefactureerd laatste 12m, incl. btw
  openNow: number;                            // open saldo nu
  overdueNow: number;                         // waarvan vervallen
  paidCount: number;                          // volledig betaalde facturen in de meetperiode
  avgDaysToPay: number | null;                // bedrag-gewogen: factuurdatum → laatste betaling
  avgDaysVsDue: number | null;                // idem t.o.v. vervaldatum (positief = te laat)
  factoredSharePct: number;                   // aandeel betaald volume via factor-dagboek
  ic: boolean;
  creditLimit?: number | null;                // som kredietlimieten van de klantkaarten (customersGT)
  creditUsedPct?: number | null;              // openNow ÷ kredietlimiet
}

export interface RcvBuRow {
  code: string;                               // AFDELING-dimensiewaarde ("(geen)" = niet toegewezen)
  invoiced12m: number;
  openNow: number;
  avgDaysToPay: number | null;
  invoiceCount12m: number;
}

export interface RcvWeekFlow {
  weekStart: string;                          // maandag (ISO)
  factored: number;                           // gefactureerd aan factoring-klanten, incl. btw
  other: number;                              // gefactureerd aan overige externe klanten
  count: number;
}

export interface RcvFactorRow {
  key: string;                                // dagboek-prefix ("KBCF", …)
  label: string;                              // leesbare naam ("KBC Commercial Finance", …)
  companies: string[];
  settled12m: number;                         // afgewikkeld volume laatste 12m
  medianDaysToSettle: number | null;          // factuurdatum → afwikkeling (mediaan)
  avgDaysToSettle: number | null;
  openFactored: number;                       // open AR bij factoring-klanten van deze factor
  openFactoredOver90: number;                 // waarvan >90d vervallen (recourse-risico)
}

export interface RcvCashWeekExpectation {
  weekStart: string; label: string;
  expected: number;                           // verwachte inning o.b.v. betaalgedrag per klant
  onDueDate: number;                           // baseline: inning exact op vervaldatum
  // Cashforecast-reeksen (meeting 17/08/2026): CN's gesaldeerd, en de variant mét
  // factoring waarbij factoring-klanten alleen het 15%-saldo als kasontvangst geven.
  expectedNet?: number;
  expectedFactor?: number;
  // Het deel van expectedNet/expectedFactor dat uit OUDE achterstal komt:
  // verwacht betaalmoment MEER DAN 60 DAGEN verstreken (cutoff David 20/08 —
  // recente achterstal ≤60d hoort bij het day-to-day-ritme). 1/6 gespreid
  // over wk 1–6, net als alle achterstal.
  spreadNet?: number;
  spreadFactor?: number;
  // Alle achterstal (elke verstreken verwachte betaaldatum, ook ≤60d) — voor de
  // driestand-weergave "alle achterstal apart" (vraag David 20/08 avond).
  spreadAlleNet?: number;
  spreadAlleFactor?: number;
}

export interface CfoReceivables {
  asOf: string;                               // ISO-timestamp van de datapull
  periodNote: string;                         // meetperiode betaalgedrag (bv. "betalingen sinds 01/01/2025")
  isLive: boolean;
  dso: RcvDsoSeries;
  dsoNow: { total: number | null; extFactoring: number | null; extOther: number | null; countback: number | null; dpo: number | null; asOfMonth: string };
  dsoInvoiceLevel: { avgDays: number | null; medianDays: number | null; onTimePct: number | null; note: string };
  speedBuckets: RcvSpeedBucket[];             // dagen-tot-betaling-verdeling (bedrag-gewogen)
  customers: RcvCustomerRow[];                // top-N op gefactureerd 12m
  businessUnits: RcvBuRow[];                  // facturatie/DSO per AFDELING (dimensie op de factuur)
  weekFlow: RcvWeekFlow[];                    // facturatie per week (laatste 26w), excl. IC
  factors: RcvFactorRow[];
  // Factoringkost: commissie (613340, kl. 61) + rente (650000 beperkt tot de posten van
  // de factormaatschappij, kl. 65). `totalYtd` = t/m `ytdThrough` (laatste rijpe maand).
  factoringCost: {
    months: string[]; amounts: number[]; fee: number[]; interest: number[]; total12m: number;
    totalYtd?: number; feeYtd?: number; interestYtd?: number; ytdThrough?: string;
  };
  // CRF-collectie-KPI's (crfonline.org), PER MAAND berekend; `asOfMonth` = de laatste
  // rijpe maand. De *Series-velden lopen gelijk met `months`, zodat de UI elke maand
  // kan tonen die de gebruiker kiest.
  crfKpis: {
    cei: number | null; cei12mAvg: number | null; bpdso: number | null; add: number | null;
    months: string[]; ceiSeries: (number | null)[];
    bpdsoSeries?: (number | null)[]; addSeries?: (number | null)[];
    asOfMonth: string; note: string;
  };
  bounceBacks: { count: number; amount: number; note: string; examples: RcvInvoiceItem[] };
  // Open FACTUREN (bruto, extern) + IC apart + het grootboek-nettosaldo als aansluiting.
  openInvoices: {
    total: number; overdue: number; ic: number; netLedger: number;
    items: RcvInvoiceItem[]; itemsShown: number; itemsTotal: number;
  };
  cashExpectation: RcvCashWeekExpectation[];  // 13 weken verwachte inning
  forecastBeyond?: { net: number; factor: number }; // open AR die pas ná week 13 verwacht wordt
  // Doorklik-detail cashforecast: de grootste posten (top 15/week) achter elke
  // forecast-week. week 13 = "ná week 13"; spread = achterstallig, gespreid wk 1–6.
  forecastDetail?: { week: number; co: string; cust: string; doc: string; amount: number; expected: string; factored: boolean; spread: boolean; oud?: boolean; bcUrl: string }[];
  behaviour?: CfoBehaviour;                   // betaalgedrag-analyse (norm 30 dagen)
  icShare: { arOpenIcPct: number; salesIcPct: number };
  dataQuality: string[];                      // bv. INTERCO-dim ontbreekt bij X; beginbalans ontbreekt
  sources: CfoSource[];
  notes: string[];
  loadError?: string;
  refreshing?: boolean;
}

export interface VatMonthRow {
  month: string;                              // "YYYY-MM" (btw-aangifteperiode)
  saleBase: number; saleVat: number;          // verkoop: maatstaf + verschuldigde btw
  purchBase: number; purchVat: number;        // aankoop: maatstaf + aftrekbare btw
  net: number;                                // te betalen (+) / te vorderen (−)
  nonDeductible: number;                      // niet-aftrekbare btw (werkelijke kost)
}

// === Betaalgedrag & cash-timing (bankvraag: "hoe verlagen we onze DSO?") ===
export interface RcvPayRow {
  company: string; customer: string; docNo: string;
  invDate: string; dueDate: string; paidAt: string | null;
  amount: number; daysToPay: number | null; daysVsDue: number | null;
  via: string; open: boolean; bcUrl: string;
}
export interface RcvCustomerRisk {
  name: string; companies: string[];
  invoiced12m: number; openNow: number; overdueNow: number;
  avgDaysToPay: number | null;
  excessDays: number;      // dagen boven de norm van 30
  tiedUp: number;          // gemiddeld vastgezet kapitaal door dat uitstel
  costAtRate: number;      // wat dat kost tegen `rate` per jaar
  dsoImpactDays: number;   // hoeveel dagen groeps-DSO deze klant kost
  creditLimit: number | null; aboveLimit: number;
  factoredSharePct: number;
}
export interface RcvFactorTiming {
  key: string; label: string; companies: string[];
  p50: number | null; p75: number | null; p90: number | null; max: number | null;
  n: number; settled12m: number;
}
// Sales-beltool: openstaand geld in blokken vanaf de norm van 30 dagen, met per blok
// de klanten erachter — bedrag, oudste factuur in dagen en contactgegevens.
export interface RcvAgeCustomer {
  name: string; companies: string[]; amount: number; invoices: number;
  maxDays: number; avgDays: number; phone: string; email: string;
  factored: boolean; overdue: number;
  // Kruisverwijzing naar BC: alle posten van deze klant en zijn klantenkaart.
  custNo: string; company: string; ledgerUrl: string; cardUrl: string;
}
export interface RcvAgeBucket {
  label: string; minDays: number; maxDays: number | null;
  amount: number; invoiceCount: number; customerCount: number;
  customers: RcvAgeCustomer[];
}
// === Cash-potentieel & target (vraag Peter/Laura 05/08/2026) ===
// "Wat is de effectieve beschikbare cash t.o.v. de invorderingen, en hoeveel komt
// er vrij als iedereen op 30 dagen betaalt?" — met het onderscheid dat bij
// factoring 85% al voorgeschoten is (dus enkel de 15%-retentie nog moet komen)
// terwijl je bij niet-factoring 100% zelf draagt.
export interface RcvCashTarget {
  normDays: number;          // het doel waarop gerekend wordt (30/45/60/90)
  unlock: number;            // EENMALIGE vrijmaking bij dat doel
  unlockFactored: number;    // waarvan enkel de retentie (85% had je al)
  unlockNonFactored: number; // waarvan de volle 100%
  invoices: number;
}
export interface RcvCashCustomer {
  name: string; companies: string[];
  open: number;              // openstaand incl. btw
  alreadyAdvanced: number;   // wat de factor hierop al voorschoot (aanname)
  toCollect: number;         // wat er nog écht moet binnenkomen
  unlockAtNorm: number;      // vrijmaking als déze klant naar de norm gaat
  maxDays: number; avgDays: number;
  factored: boolean;
  phone: string; email: string;
  custNo: string; company: string; ledgerUrl: string; cardUrl: string;
}
export interface RcvCashPotential {
  advancePct: number;        // AANNAME, niet uit BC afleidbaar
  normDays: number;
  ratePct: number;
  // Stand vandaag
  openTotal: number; openFactored: number; openNonFactored: number;
  alreadyAdvanced: number;   // cash die de factor al betaalde
  retentionDue: number;      // 15% die nog van de factor moet komen
  effectiveOutstanding: number; // retentie + niet-factoring = de échte cashkloof
  // Terugnamerisico: factoringposten ouder dan 90 dagen
  recourseOver90Gross: number;  // bruto factuurwaarde >90d bij factoring-klanten
  recourseOver90: number;       // het voorgeschoten deel dat de bank kan terugvragen
  // Vrijmaking bij de norm
  unlockAtNorm: number; unlockFactored: number; unlockNonFactored: number;
  // Brug naar de structurele berekening: de BRUTO factuurwaarde boven de norm
  // (vóór aftrek van het voorschot) en het deel dat in oude dossierschuld zit.
  // Zonder deze twee lijken de cash-vrijmaking en de DSO-berekening elkaar tegen
  // te spreken, terwijl ze simpelweg iets anders meten.
  unlockGrossAtNorm: number;
  dossierOver180: number;      // vrijmaking die in posten > 180 dagen zit
  unlockCallable: number;      // vrijmaking ≤ 180 dagen = het realistische belwerk
  perBucket: { label: string; minDays: number; maxDays: number | null; open: number; unlock: number }[];
  targets: RcvCashTarget[];  // traject: 30 / 45 / 60 / 90 dagen
  // Onderscheid eenmalig vs terugkerend — hier gaat het vaakst mis
  monthlyInterestSaved: number;  // rentewinst per maand op de vrijgemaakte cash
  structuralRelease: number | null; // permanent lager werkkapitaal bij DSO → norm
  dsoNow: number | null;
  // Terugname-buffer (meeting F&A 11/08/2026): gefactureerde facturen die de
  // 85-dagen-drempel passeren — het voorschot daarop kan de bank bij recourse
  // (90 d) terugvragen, dus dat bedrag hoort klaar te staan als buffer.
  buffer85?: {
    thresholdDays: number; gross: number; advance: number; invoices: number;
    customers: { name: string; open: number; advance: number; maxDays: number }[];
  };
  // Prioriteits-opvolging: posten 60–80 dagen oud — bellen is daar nog goedkoop
  // en voorkomt terugname én dossierwerk.
  prio6080?: {
    minDays: number; maxDays: number; amount: number; invoices: number;
    customers: { name: string; open: number; maxDays: number; factored: boolean; phone: string; email: string }[];
  };
  customers: RcvCashCustomer[];  // belijst met een €-target per klant
  notes: string[];
}

export interface CfoBehaviour {
  ageing: RcvAgeBucket[];
  cashPotential?: RcvCashPotential;
  ageingTotal: number;
  monthlyFloating: { month: string; open: number }[];   // "hoeveel geld zweeft er per maand"
  norm: number;                 // richtlijn in dagen (30)
  ratePct: number;              // gehanteerde jaarrente voor de kostberekening
  buckets: { label: string; amount: number; count: number; pct: number }[];
  factorTiming: RcvFactorTiming[];
  topCost: RcvCustomerRisk[];
  aboveLimit: RcvCustomerRisk[];
  invoices: RcvPayRow[];
  overdueNow: number;
  overdueWeightedDays: number | null;
  monthlyOpenAvg: number;
  tiedUpTotal: number;
  costTotal: number;
  dsoIfNorm: number | null;     // DSO als iedereen binnen de norm betaalde
  notes: string[];
}

export interface CfoVat {
  asOf: string;
  isLive: boolean;
  months: VatMonthRow[];                      // laatste 19 maanden (YoY-vergelijking mogelijk)
  ytd: { net: number; paid: number; recoverable: number; year: number };
  // Zelfde periode vorig jaar. `matchedNet` = dit jaar over EXACT dezelfde
  // kalendermaanden (`monthsCompared`), zodat de YoY appels-met-appels is: het
  // datavenster van 19 maanden dekt vroege maanden van vorig jaar niet altijd.
  prevYtd: { net: number; year: number; matchedNet?: number; monthsCompared?: string };
  perCompany: { code: string; ytdNet: number; ytdSaleVat: number; ytdPurchVat: number }[];
  icVat: { basePct: number; note: string };   // aandeel btw-basis met groeps-tegenpartij (VAT-match)
  vatUnit: { active: boolean; note: string };
  prefinance: { avgMonthlyNet: number; note: string }; // wat schieten we de overheid gem./maand voor
  sources: CfoSource[];
  notes: string[];
  loadError?: string;
  refreshing?: boolean;
}
