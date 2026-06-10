import type { PurchaseInvoice, BudgetEntry, ManagedDevice, M365License, PayrollCostEntry, SoftwareLicense } from './types';
import { generateId } from './utils';

// ─── Result types ─────────────────────────────────────────────────────────────

export interface ValidationError {
  row: number;
  field: string;
  message: string;
  value: string;
}

export interface ImportResult<T> {
  data: T[];
  errors: ValidationError[];
  duplicatesRemoved: number;
  totalRows: number;
}

// ─── CSV parsing ──────────────────────────────────────────────────────────────

export function parseCSV(csvText: string): Record<string, string>[] {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]).map(h => h.trim());

  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, i) => {
      row[header] = (values[i] || '').trim();
    });
    return row;
  });
}

// Handle quoted fields with commas inside
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// ─── Validation helpers ───────────────────────────────────────────────────────

function isValidDate(value: string): boolean {
  if (!value) return false;
  const d = new Date(value);
  return !isNaN(d.getTime());
}

function isValidNumber(value: string): boolean {
  if (value === '' || value === undefined) return false;
  return !isNaN(parseFloat(value));
}

// Pick the first non-empty value among a set of candidate header names,
// matching case-insensitively (handles NL/FR/EN export column variants).
function pickField(row: Record<string, string>, candidates: string[]): string {
  const lower = new Map<string, string>();
  for (const [k, v] of Object.entries(row)) lower.set(k.trim().toLowerCase(), v);
  for (const c of candidates) {
    const v = lower.get(c.toLowerCase());
    if (v !== undefined && v.trim() !== '') return v.trim();
  }
  return '';
}

// Parse a European-formatted number: "1.234,56" or "1 234,56" or "1234.56".
function parseEuroNumber(value: string): number {
  if (!value) return 0;
  let s = value.replace(/[€\s]/g, '');
  if (s.includes(',') && s.includes('.')) {
    // Both present: assume '.' thousands, ',' decimal (Belgian format)
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// Normalise many date/period spellings to "YYYY-MM".
function toYearMonth(value: string): string {
  if (!value) return '';
  const v = value.trim();
  let m = v.match(/^(\d{4})[-/](\d{1,2})/);            // 2025-03 / 2025/3 / 2025-03-01
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = v.match(/^(\d{1,2})[-/](\d{4})$/);                // 03/2025
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  m = v.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);   // 01/03/2025 (DD/MM/YYYY)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}`;
  const d = new Date(v);                                // "March 2025" etc.
  if (!isNaN(d.getTime())) return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
  return '';
}

// ─── Deduplication helper ─────────────────────────────────────────────────────

export function checkDuplicates<T>(
  newData: T[],
  existingData: T[],
  keyFn: (item: T) => string
): { unique: T[]; duplicates: T[] } {
  const existingKeys = new Set(existingData.map(keyFn));
  const unique: T[] = [];
  const duplicates: T[] = [];

  for (const item of newData) {
    if (existingKeys.has(keyFn(item))) {
      duplicates.push(item);
    } else {
      unique.push(item);
    }
  }

  return { unique, duplicates };
}

function deduplicateBy<T>(items: T[], keyFn: (item: T) => string): { items: T[]; removed: number } {
  const seen = new Map<string, T>();
  for (const item of items) {
    seen.set(keyFn(item), item); // later entries overwrite earlier ones (keep latest)
  }
  const deduped = Array.from(seen.values());
  return { items: deduped, removed: items.length - deduped.length };
}

// ─── Invoice mapper + validator ───────────────────────────────────────────────

export function mapInvoiceCSV(rows: Record<string, string>[]): PurchaseInvoice[] {
  return importInvoiceCSV(rows).data;
}

export function importInvoiceCSV(rows: Record<string, string>[]): ImportResult<PurchaseInvoice> {
  const errors: ValidationError[] = [];
  const valid: PurchaseInvoice[] = [];

  rows.forEach((row, index) => {
    const rowNum = index + 2; // 1-based, account for header row
    const rowErrors: ValidationError[] = [];

    const vendorName = row.vendorName || row.vendor_name || row['Vendor Name'] || row.vendor || '';
    const amountRaw = row.totalAmountExcludingTax || row.amount_excl_tax || row['Amount Excl. Tax'] || row.amount || '';

    if (!vendorName) {
      rowErrors.push({ row: rowNum, field: 'vendorName', message: 'Vendor name is required', value: vendorName });
    }

    if (!amountRaw) {
      rowErrors.push({ row: rowNum, field: 'totalAmountExcludingTax', message: 'Amount is required', value: amountRaw });
    } else if (!isValidNumber(amountRaw)) {
      rowErrors.push({ row: rowNum, field: 'totalAmountExcludingTax', message: 'Amount must be a valid number', value: amountRaw });
    }

    const invoiceDateRaw = row.invoiceDate || row.invoice_date || row['Invoice Date'] || row.date || '';
    if (invoiceDateRaw && !isValidDate(invoiceDateRaw)) {
      rowErrors.push({ row: rowNum, field: 'invoiceDate', message: 'Invoice date is not a valid date', value: invoiceDateRaw });
    }

    const dueDateRaw = row.dueDate || row.due_date || row['Due Date'] || '';
    if (dueDateRaw && !isValidDate(dueDateRaw)) {
      rowErrors.push({ row: rowNum, field: 'dueDate', message: 'Due date is not a valid date', value: dueDateRaw });
    }

    const amountInclRaw = row.totalAmountIncludingTax || row.amount_incl_tax || row['Amount Incl. Tax'] || '';
    if (amountInclRaw && !isValidNumber(amountInclRaw)) {
      rowErrors.push({ row: rowNum, field: 'totalAmountIncludingTax', message: 'Amount incl. tax must be a valid number', value: amountInclRaw });
    }

    if (rowErrors.some(e => e.field === 'vendorName' || e.field === 'totalAmountExcludingTax')) {
      // Critical errors: skip this row
      errors.push(...rowErrors);
      return;
    }

    errors.push(...rowErrors);

    valid.push({
      id: row.id || generateId(),
      number: row.number || row.invoice_number || row['Invoice Number'] || '',
      invoiceDate: invoiceDateRaw,
      postingDate: row.postingDate || row.posting_date || row['Posting Date'] || invoiceDateRaw || row.date || '',
      dueDate: dueDateRaw,
      vendorNumber: row.vendorNumber || row.vendor_number || row['Vendor Number'] || '',
      vendorName,
      totalAmountExcludingTax: parseFloat(amountRaw || '0'),
      totalAmountIncludingTax: parseFloat(amountInclRaw || amountRaw || '0'),
      totalTaxAmount: parseFloat(row.totalTaxAmount || row.tax_amount || row['Tax Amount'] || '0'),
      status: (row.status || row.Status || 'Open') as PurchaseInvoice['status'],
      currencyCode: row.currencyCode || row.currency || 'EUR',
      companyId: row.companyId || row.company_id || row['Company ID'] || 'comp-gdi',
      companyName: row.companyName || row.company_name || row['Company Name'] || row.company || 'GDI',
      costCategory: row.costCategory || row.cost_category || row['Cost Category'] || row.category || 'Other IT',
      lines: [],
    });
  });

  // Deduplicate by invoice number (keep latest)
  const numberKey = (inv: PurchaseInvoice) => inv.number || inv.id;
  const { items: deduped, removed } = deduplicateBy(valid, numberKey);

  return {
    data: deduped,
    errors,
    duplicatesRemoved: removed,
    totalRows: rows.length,
  };
}

// ─── Budget mapper + validator ────────────────────────────────────────────────

export function mapBudgetCSV(rows: Record<string, string>[]): BudgetEntry[] {
  return importBudgetCSV(rows).data;
}

export function importBudgetCSV(rows: Record<string, string>[]): ImportResult<BudgetEntry> {
  const errors: ValidationError[] = [];
  const valid: BudgetEntry[] = [];

  rows.forEach((row, index) => {
    const rowNum = index + 2;
    const rowErrors: ValidationError[] = [];

    const category = row.category || row.Category || '';
    const month = row.month || row.Month || '';
    const budgetRaw = row.budgetAmount || row.budget_amount || row['Budget'] || row.budget || '';
    const actualRaw = row.actualAmount || row.actual_amount || row['Actual'] || row.actual || '';

    if (!category) {
      rowErrors.push({ row: rowNum, field: 'category', message: 'Category is required', value: category });
    }
    if (!month) {
      rowErrors.push({ row: rowNum, field: 'month', message: 'Month is required', value: month });
    }
    if (!budgetRaw) {
      rowErrors.push({ row: rowNum, field: 'budgetAmount', message: 'Budget amount is required', value: budgetRaw });
    } else if (!isValidNumber(budgetRaw)) {
      rowErrors.push({ row: rowNum, field: 'budgetAmount', message: 'Budget amount must be a valid number', value: budgetRaw });
    }
    if (actualRaw && !isValidNumber(actualRaw)) {
      rowErrors.push({ row: rowNum, field: 'actualAmount', message: 'Actual amount must be a valid number', value: actualRaw });
    }

    const hasCritical = rowErrors.some(e => ['category', 'month', 'budgetAmount'].includes(e.field));
    errors.push(...rowErrors);
    if (hasCritical) return;

    const budget = parseFloat(budgetRaw);
    const actual = parseFloat(actualRaw || '0');
    const variance = actual - budget;
    const variancePercent = budget > 0 ? (variance / budget) * 100 : 0;

    valid.push({
      id: row.id || generateId(),
      category,
      month,
      budgetAmount: budget,
      actualAmount: actual,
      variance,
      variancePercent,
      companyId: row.companyId || row.company_id || 'all',
    });
  });

  // Deduplicate by category + month
  const { items: deduped, removed } = deduplicateBy(valid, e => `${e.category}__${e.month}`);

  return {
    data: deduped,
    errors,
    duplicatesRemoved: removed,
    totalRows: rows.length,
  };
}

// ─── Device mapper + validator ────────────────────────────────────────────────

export function mapDeviceCSV(rows: Record<string, string>[]): ManagedDevice[] {
  return importDeviceCSV(rows).data;
}

export function importDeviceCSV(rows: Record<string, string>[]): ImportResult<ManagedDevice> {
  const errors: ValidationError[] = [];
  const valid: ManagedDevice[] = [];

  rows.forEach((row, index) => {
    const rowNum = index + 2;
    const rowErrors: ValidationError[] = [];

    const deviceName = row.deviceName || row.device_name || row['Device Name'] || '';
    const serialNumber = row.serialNumber || row.serial_number || row['Serial Number'] || '';
    const enrolled = row.enrolledDateTime || row.enrolled_date || row['Enrolled Date'] || '';

    if (!deviceName) {
      rowErrors.push({ row: rowNum, field: 'deviceName', message: 'Device name is required', value: deviceName });
    }

    if (enrolled && !isValidDate(enrolled)) {
      rowErrors.push({ row: rowNum, field: 'enrolledDateTime', message: 'Enrolled date is not a valid date', value: enrolled });
    }

    const hasCritical = rowErrors.some(e => e.field === 'deviceName');
    errors.push(...rowErrors);
    if (hasCritical) return;

    const enrolledDate = enrolled && isValidDate(enrolled) ? new Date(enrolled) : new Date();
    const ageYears = (Date.now() - enrolledDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);

    valid.push({
      id: row.id || generateId(),
      deviceName,
      model: row.model || row.Model || '',
      manufacturer: row.manufacturer || row.Manufacturer || '',
      serialNumber,
      osVersion: row.osVersion || row.os_version || row['OS Version'] || '',
      operatingSystem: row.operatingSystem || row.operating_system || row['OS'] || 'Windows',
      enrolledDateTime: enrolled,
      complianceState: (row.complianceState || row.compliance || row['Compliance'] || 'unknown') as ManagedDevice['complianceState'],
      managedDeviceOwnerType: (row.managedDeviceOwnerType || row.owner_type || 'company') as ManagedDevice['managedDeviceOwnerType'],
      chassisType: (row.chassisType || row.chassis_type || row['Type'] || 'laptop') as ManagedDevice['chassisType'],
      ageYears: parseFloat(row.ageYears || '') || Math.round(ageYears * 10) / 10,
      assignedUser: row.assignedUser || row.assigned_user || row['Assigned User'] || row.user || '',
    });
  });

  // Deduplicate by serialNumber (keep latest)
  const { items: deduped, removed } = deduplicateBy(valid, d => d.serialNumber || d.id);

  return {
    data: deduped,
    errors,
    duplicatesRemoved: removed,
    totalRows: rows.length,
  };
}

// ─── License mapper + validator ───────────────────────────────────────────────

export function mapLicenseCSV(rows: Record<string, string>[]): M365License[] {
  return importLicenseCSV(rows).data;
}

export function importLicenseCSV(rows: Record<string, string>[]): ImportResult<M365License> {
  const errors: ValidationError[] = [];
  const valid: M365License[] = [];

  rows.forEach((row, index) => {
    const rowNum = index + 2;
    const rowErrors: ValidationError[] = [];

    const skuPartNumber = row.skuPartNumber || row.sku || row['SKU'] || '';
    const displayName = row.displayName || row.display_name || row['License Name'] || row.name || '';
    const prepaidRaw = row.prepaidUnits || row.prepaid || row['Purchased'] || '';
    const consumedRaw = row.consumedUnits || row.consumed || row['Assigned'] || '';
    const priceRaw = row.pricePerUser || row.price || row['Price Per User'] || '';

    if (!skuPartNumber && !displayName) {
      rowErrors.push({ row: rowNum, field: 'skuPartNumber', message: 'SKU or license name is required', value: skuPartNumber });
    }
    if (!prepaidRaw) {
      rowErrors.push({ row: rowNum, field: 'prepaidUnits', message: 'Purchased unit count is required', value: prepaidRaw });
    } else if (!isValidNumber(prepaidRaw)) {
      rowErrors.push({ row: rowNum, field: 'prepaidUnits', message: 'Purchased units must be a valid number', value: prepaidRaw });
    }
    if (consumedRaw && !isValidNumber(consumedRaw)) {
      rowErrors.push({ row: rowNum, field: 'consumedUnits', message: 'Consumed units must be a valid number', value: consumedRaw });
    }
    if (priceRaw && !isValidNumber(priceRaw)) {
      rowErrors.push({ row: rowNum, field: 'pricePerUser', message: 'Price per user must be a valid number', value: priceRaw });
    }

    const hasCritical = rowErrors.some(e => e.field === 'skuPartNumber' || e.field === 'prepaidUnits');
    errors.push(...rowErrors);
    if (hasCritical) return;

    const prepaid = parseInt(prepaidRaw || '0');
    const consumed = parseInt(consumedRaw || '0');
    const price = parseFloat(priceRaw || '0');
    const utilization = prepaid > 0 ? (consumed / prepaid) * 100 : 0;
    const wasted = prepaid - consumed;

    valid.push({
      skuId: row.skuId || generateId(),
      skuPartNumber,
      displayName,
      prepaidUnits: prepaid,
      consumedUnits: consumed,
      utilizationRate: utilization,
      pricePerUser: price,
      monthlyCost: consumed * price,
      wastedUnits: Math.max(0, wasted),
      wastedCost: Math.max(0, wasted) * price,
    });
  });

  // Deduplicate by skuPartNumber (keep latest)
  const { items: deduped, removed } = deduplicateBy(valid, l => l.skuPartNumber || l.skuId);

  return {
    data: deduped,
    errors,
    duplicatesRemoved: removed,
    totalRows: rows.length,
  };
}

// ─── EasyPay payroll mapper + validator ─────────────────────────────────────────
//
// EasyPay (social secretariat) payroll export → monthly IT-personnel cost.
// Export ONLY your IT department's payroll from EASY online, then the whole file
// rolls up to the "IT Personnel" cost line. Rows are aggregated per month (and
// per company if a company column is present). Employer cost is preferred over
// gross. Column names are matched flexibly across NL / FR / EN.

const EASYPAY_MONTH_COLS = ['month', 'maand', 'mois', 'periode', 'période', 'period', 'date', 'datum'];
const EASYPAY_COST_COLS = [
  'employer cost', 'werkgeverskost', 'werkgeverskosten', 'totale kost', 'totale loonkost',
  'coût total', 'cout total', 'coût patronal', 'cout patronal', 'total_cost', 'totalcost', 'kost', 'cost',
];
const EASYPAY_GROSS_COLS = ['gross', 'brutoloon', 'bruto', 'salaire brut', 'brut', 'gross_monthly'];
const EASYPAY_COMPANY_COLS = ['companyid', 'company_id', 'company', 'onderneming', 'bedrijf', 'entité', 'entite', 'entity'];
const EASYPAY_HEADCOUNT_COLS = ['headcount', 'aantal', 'nombre', 'fte', 'count'];

export function mapEasyPayCSV(rows: Record<string, string>[]): PayrollCostEntry[] {
  return importEasyPayCSV(rows).data;
}

export function importEasyPayCSV(rows: Record<string, string>[]): ImportResult<PayrollCostEntry> {
  const errors: ValidationError[] = [];
  const agg = new Map<string, PayrollCostEntry>();

  rows.forEach((row, index) => {
    const rowNum = index + 2;

    const month = toYearMonth(pickField(row, EASYPAY_MONTH_COLS));
    const costRaw = pickField(row, EASYPAY_COST_COLS) || pickField(row, EASYPAY_GROSS_COLS);
    const companyId = pickField(row, EASYPAY_COMPANY_COLS) || 'all';
    const headcountRaw = pickField(row, EASYPAY_HEADCOUNT_COLS);

    if (!month) {
      errors.push({ row: rowNum, field: 'month', message: 'Could not read a month/period column', value: pickField(row, EASYPAY_MONTH_COLS) });
      return;
    }
    if (!costRaw) {
      errors.push({ row: rowNum, field: 'amount', message: 'Could not read an employer-cost / gross column', value: '' });
      return;
    }

    const amount = parseEuroNumber(costRaw);
    const headcount = headcountRaw ? parseInt(headcountRaw.replace(/\D/g, ''), 10) || undefined : undefined;
    const key = `${companyId}__${month}`;
    const existing = agg.get(key);
    if (existing) {
      existing.amount += amount;
      if (headcount) existing.headcount = (existing.headcount || 0) + headcount;
    } else {
      agg.set(key, { month, companyId, amount, headcount, source: 'EasyPay' });
    }
  });

  const data = Array.from(agg.values()).sort((a, b) => a.month.localeCompare(b.month));
  return { data, errors, duplicatesRemoved: 0, totalRows: rows.length };
}

// ─── Software-license mapper + validator (non-Microsoft / manual) ───────────────
//
// Tracks any license M365/Graph doesn't cover: Adobe, antivirus, SaaS, perpetual,
// maintenance. Flexible NL/FR/EN columns; normalises cost to monthly + annual.

const SWL_VENDOR_COLS = ['vendor', 'publisher', 'leverancier', 'fournisseur', 'supplier'];
const SWL_PRODUCT_COLS = ['product', 'name', 'license', 'licence', 'software', 'naam', 'nom', 'productname'];
const SWL_TYPE_COLS = ['type', 'licensetype', 'license_type', 'licencetype'];
const SWL_SEATS_COLS = ['seats', 'quantity', 'qty', 'licenses', 'licences', 'total', 'purchased', 'aantal', 'count'];
const SWL_ASSIGNED_COLS = ['assigned', 'used', 'consumed', 'active', 'gebruikt', 'inuse', 'assignedseats'];
const SWL_COST_COLS = ['unitcost', 'unit_cost', 'price', 'cost', 'prijs', 'prix', 'unitprice', 'priceperseat', 'seatprice'];
const SWL_CYCLE_COLS = ['billingcycle', 'billing', 'cycle', 'frequency', 'facturatie', 'period'];
const SWL_RENEWAL_COLS = ['renewal', 'renewaldate', 'renewal_date', 'expiry', 'expirydate', 'enddate', 'end_date', 'vervaldatum', 'echeance'];
const SWL_CATEGORY_COLS = ['category', 'categorie', 'costcategory'];
const SWL_AUTORENEW_COLS = ['autorenew', 'auto_renew', 'autorenewal'];

function normalizeLicenseType(raw: string): SoftwareLicense['licenseType'] {
  const v = raw.toLowerCase();
  if (v.includes('perpet')) return 'perpetual';
  if (v.includes('open') || v.includes('foss') || v.includes('gpl')) return 'open-source';
  if (v.includes('mainten') || v.includes('support')) return 'maintenance';
  return 'subscription';
}

function normalizeBillingCycle(raw: string): SoftwareLicense['billingCycle'] {
  const v = raw.toLowerCase();
  if (v.startsWith('month') || v.includes('maand') || v.includes('mois')) return 'monthly';
  if (v.startsWith('quart') || v.includes('kwart') || v.includes('trimest')) return 'quarterly';
  if (v.includes('one') || v.includes('once') || v.includes('perpet') || v.includes('eenmalig')) return 'one-time';
  return 'annual';
}

function isTruthy(raw: string): boolean {
  const v = raw.toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'ja' || v === 'oui' || v === 'y';
}

export function mapSoftwareLicenseCSV(rows: Record<string, string>[]): SoftwareLicense[] {
  return importSoftwareLicenseCSV(rows).data;
}

export function importSoftwareLicenseCSV(rows: Record<string, string>[]): ImportResult<SoftwareLicense> {
  const errors: ValidationError[] = [];
  const valid: SoftwareLicense[] = [];

  rows.forEach((row, index) => {
    const rowNum = index + 2;
    const vendor = pickField(row, SWL_VENDOR_COLS);
    const product = pickField(row, SWL_PRODUCT_COLS);

    if (!vendor && !product) {
      errors.push({ row: rowNum, field: 'product', message: 'Vendor or product name is required', value: '' });
      return;
    }

    const seats = parseInt(pickField(row, SWL_SEATS_COLS).replace(/\D/g, ''), 10) || 0;
    const assignedSeats = parseInt(pickField(row, SWL_ASSIGNED_COLS).replace(/\D/g, ''), 10) || 0;
    const unitCost = parseEuroNumber(pickField(row, SWL_COST_COLS));
    const billingCycle = normalizeBillingCycle(pickField(row, SWL_CYCLE_COLS));
    const licenseType = normalizeLicenseType(pickField(row, SWL_TYPE_COLS));
    const renewalRaw = pickField(row, SWL_RENEWAL_COLS);
    const category = pickField(row, SWL_CATEGORY_COLS) || 'Software & Licenses';
    const autoRenew = isTruthy(pickField(row, SWL_AUTORENEW_COLS));

    // Cost per billing cycle for all seats, normalised to monthly + annual.
    const perCycle = unitCost * (seats || 1);
    let monthlyCost = 0;
    let annualCost = 0;
    switch (billingCycle) {
      case 'monthly': monthlyCost = perCycle; annualCost = perCycle * 12; break;
      case 'quarterly': monthlyCost = perCycle / 3; annualCost = perCycle * 4; break;
      case 'annual': monthlyCost = perCycle / 12; annualCost = perCycle; break;
      case 'one-time': monthlyCost = 0; annualCost = 0; break; // capex, not recurring
    }

    valid.push({
      id: row.id || generateId(),
      vendor: vendor || product,
      product: product || vendor,
      licenseType,
      seats,
      assignedSeats,
      unitCost,
      billingCycle,
      monthlyCost: Math.round(monthlyCost * 100) / 100,
      annualCost: Math.round(annualCost * 100) / 100,
      renewalDate: renewalRaw && isValidDate(renewalRaw) ? renewalRaw : undefined,
      autoRenew,
      category,
      source: 'csv',
      notes: pickField(row, ['notes', 'note', 'opmerking', 'remarque']) || undefined,
    });
  });

  const { items: deduped, removed } = deduplicateBy(valid, l => `${l.vendor.toLowerCase()}__${l.product.toLowerCase()}`);
  return { data: deduped, errors, duplicatesRemoved: removed, totalRows: rows.length };
}
