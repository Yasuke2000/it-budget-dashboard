"use client";

import { useState } from "react";
import { Download, Trash2, AlertTriangle, Building2, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { CsvImportCard } from "@/components/import/csv-import-card";
import { ServerImportCard } from "@/components/import/server-import-card";
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
  easypay: {
    headers: ["month", "employer cost", "company"],
    rows: [
      ["2025-01", "18250.00", "all"],
      ["2025-02", "18410.00", "all"],
      ["2025-03", "18960.00", "all"],
    ],
  },
  softwarelicenses: {
    headers: ["vendor", "product", "type", "seats", "assigned", "unit cost", "billing cycle", "renewal date", "category"],
    rows: [
      ["Adobe", "Creative Cloud", "subscription", "5", "4", "59.99", "monthly", "2026-09-30", "Software & Licenses"],
      ["Bitdefender", "GravityZone", "subscription", "120", "118", "32.00", "annual", "2026-12-01", "Security"],
      ["JetBrains", "All Products Pack", "subscription", "3", "3", "779.00", "annual", "2026-07-15", "Software & Licenses"],
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
      <PageHeader
        title="Import Data"
        description="Import CSV files to use your own data instead of demo data. Data is stored locally in your browser."
      />

      {/* Info banner */}
      <div className="rounded-xl border border-border bg-accent px-4 py-3 flex items-start gap-3">
        <div className="mt-0.5 size-5 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
          <div className="size-2 rounded-full bg-primary" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">How it works</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Invoices, budget, devices and licenses are parsed in the browser and saved to <code className="bg-muted rounded px-1 text-primary">localStorage</code> — nothing leaves your machine.
            EasyPay payroll is stored on the server (so the automated drop and dashboard can read it). Once imported, the dashboard uses your data in place of the built-in demo data.
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
        {/* Server-side imports (persisted on the server, shared with the automated drop) */}
        <ServerImportCard
          title="EasyPay Payroll"
          description="Monthly IT-personnel cost from EasyPay (EASY online export). Export only your IT department's payroll — it rolls up to the 'IT Personnel' cost line."
          endpoint="/api/import/easypay"
          icon={Building2}
          columns={["maand / mois / month", "werkgeverskost / coût total / employer cost", "brutoloon / gross", "company (optional)"]}
        />
        <ServerImportCard
          title="Other Software Licenses"
          description="Non-Microsoft licenses (Adobe, antivirus, SaaS, perpetual). Tracked on the Licenses page with seats, cost and renewal date."
          endpoint="/api/import/software-licenses"
          icon={KeyRound}
          columns={["vendor", "product", "seats", "assigned", "unit cost", "billing cycle", "renewal date", "category"]}
        />
      </div>

      {/* Download templates section */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="size-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <Download className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Download Templates</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
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
              className="border-border bg-muted text-foreground hover:bg-accent hover:text-foreground text-xs h-8 gap-1.5"
            >
              <Download className="h-3.5 w-3.5" />
              {card.title}
            </Button>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadCSV("easypay-template.csv", "easypay")}
            className="border-border bg-muted text-foreground hover:bg-accent hover:text-foreground text-xs h-8 gap-1.5"
          >
            <Download className="h-3.5 w-3.5" />
            EasyPay
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadCSV("software-licenses-template.csv", "softwarelicenses")}
            className="border-border bg-muted text-foreground hover:bg-accent hover:text-foreground text-xs h-8 gap-1.5"
          >
            <Download className="h-3.5 w-3.5" />
            Licenses+
          </Button>
        </div>
      </div>

      {/* Clear all section */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Clear All Imported Data</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Remove all imported data and revert the dashboard to demo data.
            </p>
          </div>

          {cleared ? (
            <span className="text-xs text-primary font-medium">All data cleared.</span>
          ) : showClearConfirm ? (
            <div className="flex items-center gap-2 rounded-lg border border-negative/30 bg-negative/10 px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-negative shrink-0" />
              <span className="text-xs text-negative">Are you sure?</span>
              <button
                onClick={handleClearAll}
                className="text-xs font-semibold text-negative hover:text-negative transition-colors"
              >
                Yes, clear all
              </button>
              <button
                onClick={() => setShowClearConfirm(false)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowClearConfirm(true)}
              className="border-negative/30 bg-negative/10 text-negative hover:bg-negative/20 hover:text-negative hover:border-negative/50 text-xs h-8 gap-1.5"
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
