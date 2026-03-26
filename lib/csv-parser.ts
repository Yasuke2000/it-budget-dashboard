import type { PurchaseInvoice, BudgetEntry, ManagedDevice, M365License } from './types';
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
