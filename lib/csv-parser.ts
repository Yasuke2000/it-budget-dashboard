import type { PurchaseInvoice, BudgetEntry, ManagedDevice, M365License } from './types';
import { generateId } from './utils';

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

export function mapInvoiceCSV(rows: Record<string, string>[]): PurchaseInvoice[] {
  return rows.map(row => ({
    id: row.id || generateId(),
    number: row.number || row.invoice_number || row['Invoice Number'] || '',
    invoiceDate: row.invoiceDate || row.invoice_date || row['Invoice Date'] || row.date || '',
    postingDate: row.postingDate || row.posting_date || row['Posting Date'] || row.invoiceDate || row.date || '',
    dueDate: row.dueDate || row.due_date || row['Due Date'] || '',
    vendorNumber: row.vendorNumber || row.vendor_number || row['Vendor Number'] || '',
    vendorName: row.vendorName || row.vendor_name || row['Vendor Name'] || row.vendor || '',
    totalAmountExcludingTax: parseFloat(row.totalAmountExcludingTax || row.amount_excl_tax || row['Amount Excl. Tax'] || row.amount || '0'),
    totalAmountIncludingTax: parseFloat(row.totalAmountIncludingTax || row.amount_incl_tax || row['Amount Incl. Tax'] || '0'),
    totalTaxAmount: parseFloat(row.totalTaxAmount || row.tax_amount || row['Tax Amount'] || '0'),
    status: (row.status || row.Status || 'Open') as PurchaseInvoice['status'],
    currencyCode: row.currencyCode || row.currency || 'EUR',
    companyId: row.companyId || row.company_id || row['Company ID'] || 'comp-gdi',
    companyName: row.companyName || row.company_name || row['Company Name'] || row.company || 'GDI',
    costCategory: row.costCategory || row.cost_category || row['Cost Category'] || row.category || 'Other IT',
    lines: [],
  }));
}

export function mapBudgetCSV(rows: Record<string, string>[]): BudgetEntry[] {
  return rows.map(row => {
    const budget = parseFloat(row.budgetAmount || row.budget_amount || row['Budget'] || row.budget || '0');
    const actual = parseFloat(row.actualAmount || row.actual_amount || row['Actual'] || row.actual || '0');
    const variance = actual - budget;
    const variancePercent = budget > 0 ? (variance / budget) * 100 : 0;
    return {
      id: row.id || generateId(),
      category: row.category || row.Category || 'Other IT',
      month: row.month || row.Month || '2025-01',
      budgetAmount: budget,
      actualAmount: actual,
      variance,
      variancePercent,
      companyId: row.companyId || row.company_id || 'all',
    };
  });
}

export function mapDeviceCSV(rows: Record<string, string>[]): ManagedDevice[] {
  return rows.map(row => {
    const enrolled = row.enrolledDateTime || row.enrolled_date || row['Enrolled Date'] || '';
    const enrolledDate = enrolled ? new Date(enrolled) : new Date();
    const ageYears = (Date.now() - enrolledDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    return {
      id: row.id || generateId(),
      deviceName: row.deviceName || row.device_name || row['Device Name'] || '',
      model: row.model || row.Model || '',
      manufacturer: row.manufacturer || row.Manufacturer || '',
      serialNumber: row.serialNumber || row.serial_number || row['Serial Number'] || '',
      osVersion: row.osVersion || row.os_version || row['OS Version'] || '',
      operatingSystem: row.operatingSystem || row.operating_system || row['OS'] || 'Windows',
      enrolledDateTime: enrolled,
      complianceState: (row.complianceState || row.compliance || row['Compliance'] || 'unknown') as ManagedDevice['complianceState'],
      managedDeviceOwnerType: (row.managedDeviceOwnerType || row.owner_type || 'company') as ManagedDevice['managedDeviceOwnerType'],
      chassisType: (row.chassisType || row.chassis_type || row['Type'] || 'laptop') as ManagedDevice['chassisType'],
      ageYears: parseFloat(row.ageYears || '') || Math.round(ageYears * 10) / 10,
      assignedUser: row.assignedUser || row.assigned_user || row['Assigned User'] || row.user || '',
    };
  });
}

export function mapLicenseCSV(rows: Record<string, string>[]): M365License[] {
  return rows.map(row => {
    const prepaid = parseInt(row.prepaidUnits || row.prepaid || row['Purchased'] || '0');
    const consumed = parseInt(row.consumedUnits || row.consumed || row['Assigned'] || '0');
    const price = parseFloat(row.pricePerUser || row.price || row['Price Per User'] || '0');
    const utilization = prepaid > 0 ? (consumed / prepaid) * 100 : 0;
    const wasted = prepaid - consumed;
    return {
      skuId: row.skuId || generateId(),
      skuPartNumber: row.skuPartNumber || row.sku || row['SKU'] || '',
      displayName: row.displayName || row.display_name || row['License Name'] || row.name || '',
      prepaidUnits: prepaid,
      consumedUnits: consumed,
      utilizationRate: utilization,
      pricePerUser: price,
      monthlyCost: consumed * price,
      wastedUnits: Math.max(0, wasted),
      wastedCost: Math.max(0, wasted) * price,
    };
  });
}
