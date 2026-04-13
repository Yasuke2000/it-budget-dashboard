import companiesData from "@/data/mock/companies.json";
import invoicesData from "@/data/mock/invoices.json";
import glEntriesData from "@/data/mock/gl-entries.json";
import licensesData from "@/data/mock/licenses.json";
import devicesData from "@/data/mock/devices.json";
import budgetData from "@/data/mock/budget.json";
import peppolData from "@/data/mock/peppol-invoices.json";
import contractsData from "@/data/mock/contracts.json";
import type {
  Company,
  PurchaseInvoice,
  GeneralLedgerEntry,
  M365License,
  ManagedDevice,
  BudgetEntry,
  Contract,
} from "./types";
import type { PeppolInvoice } from "./peppol-parser";

// Cast through unknown since mock JSON shape may not match types exactly
export const demoCompanies = companiesData as unknown as Company[];
export const demoInvoices = invoicesData as unknown as PurchaseInvoice[];
export const demoGLEntries = glEntriesData as unknown as GeneralLedgerEntry[];
export const demoLicenses = licensesData as unknown as M365License[];
export const demoDevices = devicesData as unknown as ManagedDevice[];
export const demoBudgetEntries = budgetData as unknown as BudgetEntry[];
export const demoPeppolInvoices = peppolData as unknown as PeppolInvoice[];
export const demoContracts = contractsData as unknown as Contract[];
