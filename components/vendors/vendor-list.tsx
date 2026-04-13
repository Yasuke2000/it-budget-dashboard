"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Building2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { VendorDetailSheet } from "./vendor-detail-sheet";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import type { VendorSummary, PurchaseInvoice } from "@/lib/types";

interface VendorListProps {
  vendors: VendorSummary[];
  invoices: PurchaseInvoice[];
}

const STATUS_COLORS: Record<string, string> = {
  Paid: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  Open: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  Draft: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  Canceled: "bg-red-500/20 text-red-400 border-red-500/30",
};

export function VendorList({ vendors, invoices }: VendorListProps) {
  const [expandedVendor, setExpandedVendor] = useState<string | null>(null);
  const [selectedVendor, setSelectedVendor] = useState<VendorSummary | null>(null);

  function toggle(vendorName: string) {
    setExpandedVendor((prev) => (prev === vendorName ? null : vendorName));
  }

  function getVendorInvoices(vendorName: string): PurchaseInvoice[] {
    return invoices
      .filter((inv) => inv.vendorName === vendorName)
      .sort((a, b) => b.postingDate.localeCompare(a.postingDate))
      .slice(0, 8);
  }

  return (
    <div className="space-y-3">
      {vendors.map((vendor, idx) => {
        const isExpanded = expandedVendor === vendor.vendorName;
        const vendorInvoices = isExpanded ? getVendorInvoices(vendor.vendorName) : [];

        return (
          <Card
            key={vendor.vendorNumber || vendor.vendorName}
            className={cn(
              "bg-slate-900 border-slate-800 transition-colors",
              vendor.isConcentrationRisk && "border-amber-800/50"
            )}
          >
            {/* Header row — always visible */}
            <CardContent className="p-0">
              <button
                className="w-full text-left"
                onClick={() => setSelectedVendor(vendor)}
              >
                <div className="flex items-center gap-4 p-4 hover:bg-slate-800/50 transition-colors rounded-t-lg">
                  {/* Rank */}
                  <span className="text-lg font-bold text-slate-600 tabular-nums w-7 shrink-0">
                    #{idx + 1}
                  </span>

                  {/* Vendor icon */}
                  <div className="h-9 w-9 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
                    <Building2 className="h-4 w-4 text-slate-400" />
                  </div>

                  {/* Name + categories */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-white truncate">
                        {vendor.vendorName}
                      </span>
                      {vendor.isConcentrationRisk && (
                        <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 border text-xs gap-1 shrink-0">
                          <AlertTriangle className="h-3 w-3" />
                          Concentration risk
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {vendor.categories.map((cat) => (
                        <span
                          key={cat}
                          className="text-[10px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded"
                        >
                          {cat}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="hidden sm:flex items-center gap-8 shrink-0">
                    <div className="text-right">
                      <p className="text-sm font-mono font-semibold text-white tabular-nums">
                        {formatCurrency(vendor.totalSpend)}
                      </p>
                      <p className="text-xs text-slate-500">
                        {vendor.invoiceCount} invoice{vendor.invoiceCount !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <div className="w-28">
                      <div className="flex justify-between mb-1">
                        <span className="text-xs text-slate-500">Share</span>
                        <span
                          className={cn(
                            "text-xs font-mono font-semibold tabular-nums",
                            vendor.isConcentrationRisk ? "text-amber-400" : "text-slate-300"
                          )}
                        >
                          {vendor.percentOfTotal.toFixed(1)}%
                        </span>
                      </div>
                      <Progress
                        value={vendor.percentOfTotal}
                        className={cn(
                          "h-1.5 bg-slate-800",
                          vendor.isConcentrationRisk ? "[&>div]:bg-amber-500" : "[&>div]:bg-teal-500"
                        )}
                      />
                    </div>
                  </div>

                  {/* Chevron — toggles invoice expansion */}
                  <div
                    role="button"
                    className="shrink-0 text-slate-500 hover:text-slate-300 p-1 rounded transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(vendor.vendorName);
                    }}
                  >
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </div>
                </div>
              </button>

              {/* Mobile stats row */}
              <div className="sm:hidden flex items-center gap-4 px-4 pb-3">
                <span className="text-sm font-mono font-semibold text-white tabular-nums">
                  {formatCurrency(vendor.totalSpend)}
                </span>
                <span className="text-xs text-slate-500">
                  {vendor.invoiceCount} invoice{vendor.invoiceCount !== 1 ? "s" : ""}
                </span>
                <span
                  className={cn(
                    "text-xs font-mono tabular-nums ml-auto",
                    vendor.isConcentrationRisk ? "text-amber-400" : "text-slate-400"
                  )}
                >
                  {vendor.percentOfTotal.toFixed(1)}% of total
                </span>
              </div>

              {/* Expanded: recent invoices */}
              {isExpanded && (
                <div className="border-t border-slate-800 px-4 pb-4 pt-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                    Recent invoices
                  </p>
                  {vendorInvoices.length === 0 ? (
                    <p className="text-sm text-slate-600 italic">No invoices found.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-slate-800 hover:bg-transparent">
                            <TableHead className="text-slate-500 text-xs">Invoice #</TableHead>
                            <TableHead className="text-slate-500 text-xs">Date</TableHead>
                            <TableHead className="text-slate-500 text-xs">Category</TableHead>
                            <TableHead className="text-slate-500 text-xs">Status</TableHead>
                            <TableHead className="text-slate-500 text-xs text-right">Amount (excl. VAT)</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {vendorInvoices.map((inv) => (
                            <TableRow key={inv.id} className="border-slate-800/50 hover:bg-slate-800/30">
                              <TableCell className="text-xs font-mono text-slate-300">
                                {inv.number}
                              </TableCell>
                              <TableCell className="text-xs text-slate-400">
                                {formatDate(inv.postingDate)}
                              </TableCell>
                              <TableCell className="text-xs text-slate-400">
                                {inv.costCategory || "—"}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  className={cn(
                                    "text-[10px] border",
                                    STATUS_COLORS[inv.status] || STATUS_COLORS.Draft
                                  )}
                                >
                                  {inv.status}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs font-mono text-white text-right tabular-nums">
                                {formatCurrency(inv.totalAmountExcludingTax)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
      <VendorDetailSheet
        vendor={selectedVendor}
        open={selectedVendor !== null}
        onOpenChange={(open) => { if (!open) setSelectedVendor(null); }}
      />
    </div>
  );
}
