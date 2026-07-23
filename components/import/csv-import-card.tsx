"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, CheckCircle2, AlertTriangle, X, FileText, Trash2, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  parseCSV,
  importInvoiceCSV,
  importBudgetCSV,
  importDeviceCSV,
  importLicenseCSV,
} from "@/lib/csv-parser";
import type { ImportResult, ValidationError } from "@/lib/csv-parser";
import { saveImportedData, getImportedData, clearImportedData } from "@/lib/imported-data";
import type { PurchaseInvoice, BudgetEntry, ManagedDevice, M365License } from "@/lib/types";

type DataType = "invoices" | "budget" | "devices" | "licenses";

interface CsvImportCardProps {
  dataType: DataType;
  title: string;
  description: string;
  expectedColumns: readonly string[];
  onImport?: () => void;
}

type ImportState = "idle" | "preview" | "success" | "error";

type MappedType = PurchaseInvoice | BudgetEntry | ManagedDevice | M365License;

function getExistingCount(dataType: DataType): number {
  const data = getImportedData(dataType);
  return data ? data.length : 0;
}

function runImport(dataType: DataType, rows: Record<string, string>[]): ImportResult<MappedType> {
  switch (dataType) {
    case "invoices": return importInvoiceCSV(rows) as ImportResult<MappedType>;
    case "budget":   return importBudgetCSV(rows) as ImportResult<MappedType>;
    case "devices":  return importDeviceCSV(rows) as ImportResult<MappedType>;
    case "licenses": return importLicenseCSV(rows) as ImportResult<MappedType>;
  }
}

function hasCriticalErrors(errors: ValidationError[], dataType: DataType): boolean {
  const criticalFields: Record<DataType, string[]> = {
    invoices: ['vendorName', 'totalAmountExcludingTax'],
    budget: ['category', 'month', 'budgetAmount'],
    devices: ['deviceName'],
    licenses: ['skuPartNumber', 'prepaidUnits'],
  };
  return errors.some(e => criticalFields[dataType].includes(e.field));
}

export function CsvImportCard({
  dataType,
  title,
  description,
  expectedColumns,
  onImport,
}: CsvImportCardProps) {
  const [importState, setImportState] = useState<ImportState>("idle");
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [detectedHeaders, setDetectedHeaders] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [importedCount, setImportedCount] = useState(0);
  const [existingCount, setExistingCount] = useState(() => getExistingCount(dataType));
  const [importResult, setImportResult] = useState<ImportResult<MappedType> | null>(null);
  const [showAllErrors, setShowAllErrors] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Keep existing count in sync when data is imported elsewhere
  useEffect(() => {
    function handleDataImported(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail.type === dataType || detail.type === "all") {
        setExistingCount(getExistingCount(dataType));
      }
    }

    window.addEventListener("itdash-data-imported", handleDataImported);
    return () => window.removeEventListener("itdash-data-imported", handleDataImported);
  }, [dataType]);

  const processFile = useCallback((file: File) => {
    if (!file.name.endsWith(".csv") && file.type !== "text/csv") {
      setErrorMsg("Please upload a CSV file (.csv).");
      setImportState("error");
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      try {
        const rows = parseCSV(text);
        if (rows.length === 0) {
          setErrorMsg("The CSV file is empty or has no data rows.");
          setImportState("error");
          return;
        }
        setRawRows(rows);
        setDetectedHeaders(Object.keys(rows[0]));
        setImportResult(null);
        setShowAllErrors(false);
        setImportState("preview");
        setErrorMsg(null);
      } catch {
        setErrorMsg("Failed to parse the CSV file. Please check the file format.");
        setImportState("error");
      }
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  function handleValidateAndPreview() {
    const result = runImport(dataType, rawRows);
    setImportResult(result);
  }

  function handleImport() {
    try {
      const result = importResult ?? runImport(dataType, rawRows);
      saveImportedData(dataType, result.data);
      setImportedCount(result.data.length);
      setImportState("success");
      setExistingCount(result.data.length);
      onImport?.();
    } catch {
      setErrorMsg("Failed to import data. Please check that the columns match the expected format.");
      setImportState("error");
    }
  }

  function handleClear() {
    clearImportedData(dataType);
    setExistingCount(0);
    setImportState("idle");
    setFileName(null);
    setRawRows([]);
    setDetectedHeaders([]);
    setErrorMsg(null);
    setImportResult(null);
    setShowAllErrors(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleReset() {
    setImportState("idle");
    setFileName(null);
    setRawRows([]);
    setDetectedHeaders([]);
    setErrorMsg(null);
    setImportResult(null);
    setShowAllErrors(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const previewRows = rawRows.slice(0, 5);
  const previewHeaders = detectedHeaders.slice(0, 8); // cap preview columns at 8

  // Determine which expected columns are found
  const normalise = (s: string) => s.toLowerCase().replace(/[\s_]/g, "");
  const foundColumns = expectedColumns.map(col => {
    const colNorm = normalise(col);
    const found = detectedHeaders.some(h => normalise(h) === colNorm || normalise(h).includes(colNorm) || colNorm.includes(normalise(h)));
    return { col, found };
  });

  const blockingImport = importResult !== null && hasCriticalErrors(importResult.errors, dataType);
  const displayErrors = importResult?.errors ?? [];
  const visibleErrors = showAllErrors ? displayErrors : displayErrors.slice(0, 5);

  return (
    <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            {existingCount > 0 && (
              <Badge className="bg-primary/15 text-primary border-primary/30 text-[10px] font-semibold px-2 py-0.5">
                {existingCount} rows imported
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
        {existingCount > 0 && (
          <button
            onClick={handleClear}
            className="shrink-0 flex items-center gap-1 text-xs text-negative hover:text-negative/80 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </button>
        )}
      </div>

      {/* Drop zone — only shown when idle or after reset */}
      {(importState === "idle" || importState === "error") && (
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "relative cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors",
            isDragging
              ? "border-primary bg-primary/10"
              : "border-border hover:border-primary hover:bg-accent"
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleFileChange}
          />
          <Upload className={cn("mx-auto h-8 w-8 mb-3", isDragging ? "text-primary" : "text-muted-foreground")} />
          <p className="text-sm font-medium text-foreground">
            {isDragging ? "Drop your CSV here" : "Drag & drop your CSV file"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">or click to browse</p>
        </div>
      )}

      {/* Error state */}
      {importState === "error" && errorMsg && (
        <div className="flex items-start gap-2 rounded-lg bg-negative/10 border border-negative/30 px-3 py-2.5">
          <AlertTriangle className="h-4 w-4 text-negative shrink-0 mt-0.5" />
          <p className="text-xs text-negative">{errorMsg}</p>
        </div>
      )}

      {/* Preview state */}
      {importState === "preview" && (
        <div className="flex flex-col gap-3">
          {/* File name + dismiss */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-xs text-foreground truncate">{fileName}</span>
              <span className="text-xs text-muted-foreground shrink-0">— {rawRows.length} rows</span>
            </div>
            <button onClick={handleReset} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Column detection */}
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Column detection
            </p>
            <div className="flex flex-wrap gap-1.5">
              {foundColumns.map(({ col, found }) => (
                <span
                  key={col}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border",
                    found
                      ? "bg-primary/10 border-primary/30 text-primary"
                      : "bg-warning/10 border-warning/30 text-warning"
                  )}
                >
                  {found
                    ? <CheckCircle2 className="h-3 w-3 shrink-0" />
                    : <AlertTriangle className="h-3 w-3 shrink-0" />
                  }
                  {col}
                </span>
              ))}
            </div>
          </div>

          {/* Preview table */}
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Preview (first 5 rows)
            </p>
            <div className="rounded-lg border border-border overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted">
                    {previewHeaders.map(h => (
                      <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                    {detectedHeaders.length > 8 && (
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground/70 whitespace-nowrap">
                        +{detectedHeaders.length - 8} more
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, ri) => (
                    <tr
                      key={ri}
                      className={cn(
                        "border-b border-border last:border-0",
                        ri % 2 === 0 ? "bg-card" : "bg-accent"
                      )}
                    >
                      {previewHeaders.map(h => (
                        <td key={h} className="px-3 py-1.5 text-foreground whitespace-nowrap max-w-[160px] truncate">
                          {row[h] || <span className="text-muted-foreground/70">—</span>}
                        </td>
                      ))}
                      {detectedHeaders.length > 8 && <td />}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Validation results */}
          {importResult !== null && (
            <div className="flex flex-col gap-2">
              {/* Summary row */}
              <div className="flex items-center gap-3 flex-wrap text-xs">
                <span className="flex items-center gap-1.5 text-primary">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span className="font-semibold">{importResult.data.length}</span> rows valid
                </span>
                {importResult.errors.length > 0 && (
                  <span className="flex items-center gap-1.5 text-negative">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span className="font-semibold">{importResult.errors.length}</span> validation errors
                  </span>
                )}
                {importResult.duplicatesRemoved > 0 && (
                  <span className="flex items-center gap-1.5 text-warning">
                    <Info className="h-3.5 w-3.5" />
                    <span className="font-semibold">{importResult.duplicatesRemoved}</span> duplicates removed
                  </span>
                )}
              </div>

              {/* Validation errors list */}
              {displayErrors.length > 0 && (
                <div className="rounded-lg bg-negative/10 border border-negative/30 px-3 py-2.5 flex flex-col gap-1.5">
                  <p className="text-xs font-semibold text-negative mb-0.5">Validation errors</p>
                  {visibleErrors.map((err, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-negative">
                      <AlertTriangle className="h-3 w-3 text-negative shrink-0 mt-0.5" />
                      <span>
                        <span className="font-semibold">Row {err.row}</span> — {err.field}:{" "}
                        {err.message}
                        {err.value ? (
                          <span className="ml-1 font-mono text-negative/80">(got: &quot;{err.value}&quot;)</span>
                        ) : null}
                      </span>
                    </div>
                  ))}
                  {displayErrors.length > 5 && (
                    <button
                      onClick={() => setShowAllErrors(v => !v)}
                      className="text-xs text-negative hover:text-negative/80 self-start transition-colors mt-0.5"
                    >
                      {showAllErrors
                        ? "Show less"
                        : `Show ${displayErrors.length - 5} more errors`}
                    </button>
                  )}
                  {blockingImport && (
                    <p className="text-xs text-negative font-semibold mt-1 border-t border-negative/20 pt-1.5">
                      Import blocked: fix critical errors (missing required fields) before importing.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 flex-wrap">
            {importResult === null ? (
              <Button
                onClick={handleValidateAndPreview}
                className="bg-muted hover:bg-accent text-foreground text-xs h-8 px-4"
              >
                Validate {rawRows.length} rows
              </Button>
            ) : (
              <Button
                onClick={handleImport}
                disabled={blockingImport}
                className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs h-8 px-4 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Import {importResult.data.length} rows
                {importResult.errors.length > 0 && !blockingImport && " (with warnings)"}
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={handleReset}
              className="text-muted-foreground hover:text-foreground text-xs h-8 px-3"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Success state */}
      {importState === "success" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 rounded-lg bg-primary/10 border border-primary/30 px-3 py-2.5">
            <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
            <p className="text-xs text-primary">
              Successfully imported <span className="font-semibold">{importedCount} rows</span>. Refresh the page to see your data.
            </p>
          </div>
          <button
            onClick={handleReset}
            className="self-start text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Import another file
          </button>
        </div>
      )}

      {/* Expected columns hint (always visible in idle state) */}
      {importState === "idle" && (
        <div>
          <p className="text-[11px] text-muted-foreground mb-1.5 font-medium uppercase tracking-wider">Expected columns</p>
          <div className="flex flex-wrap gap-1">
            {expectedColumns.map(col => (
              <span key={col} className="rounded-full bg-muted border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                {col}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
