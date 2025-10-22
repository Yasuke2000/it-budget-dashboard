"use client";

import { useState } from "react";
import { Download, Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CsvImportCard } from "@/components/import/csv-import-card";
import { clearAllImportedData } from "@/lib/imported-data";

// ─── Template definitions ────────────────────────────────────────────────────

const TEMPLATES = {
  invoices: {
    headers: ["number", "invoiceDate", "postingDate", "dueDate", "vendorNumber", "vendorName", "totalAmountExcludingTax", "totalAmountIncludingTax", "totalTaxAmount", "status", "currencyCode", "companyId", "companyName", "costCategory"],
    rows: [
      ["INV-2025-001", "2025-01-15", "2025-01-15", "2025-02-14", "V001", "Microsoft Belgium", "12500.00", "15125.00", "2625.00", "Open", "EUR", "comp-gdi", "GDI", "Software & Licenses"],
      ["INV-2025-002", "2025-01-20", "2025-01-20", "2025-02-19", "V002", "Dell Technologies", "8400.00", "10164.00", "1764.00", "Paid", "EUR", "comp-gdi", "GDI", "Hardware (Purchases)"],
      ["INV-2025-003", "2025-02-03", "2025-02-03", "2025-03-05", "V003", "AWS EMEA SARL", "3200.00", "3872.00", "672.00", "Open", "EUR", "comp-gdi", "GDI", "Cloud & Hosting"],
    ],
  },
  budget: {
    headers: ["category", "month", "budgetAmount", "actualAmount", "companyId"],
    rows: [
      ["Software & Licenses", "2025-01", "15000", "14200", "all"],
      ["Hardware (Purchases)", "2025-01", "8000", "8400", "all"],
      ["Cloud & Hosting", "2025-01", "4000", "3200", "all"],
    ],
  },
  devices: {
    headers: ["deviceName", "model", "manufacturer", "serialNumber", "osVersion", "operatingSystem", "enrolledDateTime", "complianceState", "managedDeviceOwnerType", "chassisType", "assignedUser"],
    rows: [
      ["LAPTOP-001", "Latitude 5540", "Dell", "SN123456", "Windows 11 22H2", "Windows", "2023-06-15T09:00:00Z", "compliant", "company", "laptop", "john.doe@company.com"],
      ["LAPTOP-002", "ThinkPad X1 Carbon", "Lenovo", "SN789012", "Windows 11 23H2", "Windows", "2022-11-20T10:30:00Z", "compliant", "company", "laptop", "jane.smith@company.com"],
      ["DESKTOP-001", "OptiPlex 7090", "Dell", "SN345678", "Windows 10 22H2", "Windows", "2021-03-10T08:00:00Z", "noncompliant", "company", "desktop", "bob.jones@company.com"],
    ],
  },
  licenses: {
    headers: ["skuPartNumber", "displayName", "prepaidUnits", "consumedUnits", "pricePerUser"],
    rows: [
      ["SPE_E3", "Microsoft 365 E3", "100", "87", "32.00"],
      ["ENTERPRISEPREMIUM", "Microsoft 365 E5", "50", "48", "54.80"],
      ["POWER_BI_PRO", "Power BI Pro", "30", "22", "9.40"],
    ],
  },
} as const;

type TemplateKey = keyof typeof TEMPLATES;

function downloadCSV(filename: string, key: TemplateKey) {
  const template = TEMPLATES[key];
  const lines = [
    template.headers.join(","),
    ...template.rows.map(row =>
      (row as readonly string[]).map(cell =>
        cell.includes(",") ? `"${cell}"` : cell
      ).join(",")
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Import cards config ─────────────────────────────────────────────────────

const IMPORT_CARDS = [
  {
    dataType: "invoices" as const,
    title: "Invoices",
    description: "Purchase invoices with vendor, amount, status, and cost category.",
    expectedColumns: ["date / invoiceDate", "vendor / vendorName", "amount / totalAmountExcludingTax", "status", "company / companyName", "category / costCategory"],
    templateFile: "invoices-template.csv",
    templateKey: "invoices" as TemplateKey,
  },
  {
    dataType: "budget" as const,
    title: "Budget",
    description: "Monthly budget vs. actual figures per cost category.",
    expectedColumns: ["category", "month", "budget / budgetAmount", "actual / actualAmount"],
    templateFile: "budget-template.csv",
    templateKey: "budget" as TemplateKey,
  },
  {
    dataType: "devices" as const,
    title: "Devices",
    description: "Managed device inventory from Intune or another MDM.",
    expectedColumns: ["deviceName", "model", "manufacturer", "serialNumber", "osVersion", "enrolledDateTime / enrolled_date", "complianceState / compliance", "assignedUser"],
    templateFile: "devices-template.csv",
    templateKey: "devices" as TemplateKey,
  },
  {
    dataType: "licenses" as const,
    title: "Licenses",
    description: "Microsoft 365 or other license inventory with utilisation and pricing.",
    expectedColumns: ["skuPartNumber / sku", "displayName / name", "prepaidUnits / prepaid", "consumedUnits / consumed", "pricePerUser / price"],
    templateFile: "licenses-template.csv",
    templateKey: "licenses" as TemplateKey,
  },
] as const;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ImportPage() {
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [cleared, setCleared] = useState(false);

  function handleClearAll() {
    clearAllImportedData();
    setShowClearConfirm(false);
    setCleared(true);
    setTimeout(() => setCleared(false), 3000);
  }

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Import Data</h1>
        <p className="mt-1 text-slate-400">
          Import CSV files to use your own data instead of demo data. Data is stored locally in your browser.
        </p>
      </div>

      {/* Info banner */}
      <div className="rounded-xl border border-slate-700 bg-slate-800/50 px-4 py-3 flex items-start gap-3">
        <div className="mt-0.5 size-5 rounded-full bg-teal-500/20 flex items-center justify-center shrink-0">
          <div className="size-2 rounded-full bg-teal-400" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-white">How it works</p>
          <p className="text-xs text-slate-400 leading-relaxed">
            Uploaded data is parsed in the browser and saved to <code className="bg-slate-700 rounded px-1 text-teal-300">localStorage</code>. Nothing is sent to a server.
            Once imported, the dashboard uses your data in place of the built-in demo data. Clearing a data type reverts that section back to demo data.
          </p>
        </div>
      </div>

      {/* Import cards grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {IMPORT_CARDS.map(card => (
          <CsvImportCard
            key={card.dataType}
            dataType={card.dataType}
            title={card.title}
            description={card.description}
            expectedColumns={card.expectedColumns}
          />
        ))}
      </div>

      {/* Download templates section */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="size-8 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
            <Download className="h-4 w-4 text-slate-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Download Templates</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Starter CSV files with the correct headers and a few sample rows.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {IMPORT_CARDS.map(card => (
            <Button
              key={card.dataType}
              variant="outline"
              size="sm"
              onClick={() => downloadCSV(card.templateFile, card.templateKey)}
              className="border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white text-xs h-8 gap-1.5"
            >
              <Download className="h-3.5 w-3.5" />
              {card.title}
            </Button>
          ))}
        </div>
      </div>

      {/* Clear all section */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-white">Clear All Imported Data</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Remove all imported data and revert the dashboard to demo data.
            </p>
          </div>

          {cleared ? (
            <span className="text-xs text-teal-400 font-medium">All data cleared.</span>
          ) : showClearConfirm ? (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
              <span className="text-xs text-red-300">Are you sure?</span>
              <button
                onClick={handleClearAll}
                className="text-xs font-semibold text-red-400 hover:text-red-300 transition-colors"
              >
                Yes, clear all
              </button>
              <button
                onClick={() => setShowClearConfirm(false)}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowClearConfirm(true)}
              className="border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300 hover:border-red-500/50 text-xs h-8 gap-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear All Data
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
