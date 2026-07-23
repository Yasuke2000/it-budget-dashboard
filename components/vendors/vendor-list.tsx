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
  Paid: "bg-positive/10 text-positive border-positive/30",
  Open: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  Draft: "bg-muted text-muted-foreground border-border",
  Canceled: "bg-negative/10 text-negative border-negative/30",
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
              "transition-colors",
              vendor.isConcentrationRisk && "border-warning/50"
            )}
          >
            {/* Header row — always visible */}
            <CardContent className="p-0">
              <button
                className="w-full text-left"
                onClick={() => setSelectedVendor(vendor)}
              >
                <div className="flex items-center gap-4 p-4 hover:bg-accent transition-colors rounded-t-lg">
                  {/* Rank */}
                  <span className="text-lg font-bold text-muted-foreground/70 tabular-nums w-7 shrink-0">
                    #{idx + 1}
                  </span>

                  {/* Vendor icon */}
                  <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                  </div>

                  {/* Name + categories */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-foreground truncate">
                        {vendor.vendorName}
                      </span>
                      {vendor.isConcentrationRisk && (
                        <Badge className="bg-warning/10 text-warning border-warning/30 border text-xs gap-1 shrink-0">
                          <AlertTriangle className="h-3 w-3" />
                          Concentration risk
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {vendor.categories.map((cat) => (
                        <span
                          key={cat}
                          className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded"
                        >
                          {cat}
                        </span>
                      ))}
                    </div>
                    {/* Which entities the spend comes from */}
                    {vendor.entities?.length > 0 && (
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">via</span>
                        {vendor.entities.slice(0, 3).map((e) => (
                          <span
                            key={e.name}
                            className="text-[10px] text-primary/80 bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded"
                          >
                            {e.name} · {formatCurrency(e.spend)}
                          </span>
                        ))}
                        {vendor.entities.length > 3 && (
                          <span className="text-[10px] text-muted-foreground/70">+{vendor.entities.length - 3} more</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Stats */}
                  <div className="hidden sm:flex items-center gap-8 shrink-0">
                    <div className="text-right">
                      <p className="text-sm font-mono font-semibold text-foreground tabular-nums">
                        {formatCurrency(vendor.totalSpend)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {vendor.invoiceCount} invoice{vendor.invoiceCount !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <div className="w-28">
                      <div className="flex justify-between mb-1">
                        <span className="text-xs text-muted-foreground">Share</span>
                        <span
                          className={cn(
                            "text-xs font-mono font-semibold tabular-nums",
                            vendor.isConcentrationRisk ? "text-warning" : "text-foreground"
                          )}
                        >
                          {vendor.percentOfTotal.toFixed(1)}%
                        </span>
                      </div>
                      <Progress
                        value={vendor.percentOfTotal}
                        className={cn(
                          "h-1.5 bg-muted",
                          vendor.isConcentrationRisk ? "[&>div]:bg-warning" : "[&>div]:bg-primary"
                        )}
                      />
                    </div>
                  </div>

                  {/* Chevron — toggles invoice expansion */}
                  <div
                    role="button"
                    className="shrink-0 text-muted-foreground hover:text-foreground p-1 rounded transition-colors"
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
                <span className="text-sm font-mono font-semibold text-foreground tabular-nums">
                  {formatCurrency(vendor.totalSpend)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {vendor.invoiceCount} invoice{vendor.invoiceCount !== 1 ? "s" : ""}
                </span>
                <span
                  className={cn(
                    "text-xs font-mono tabular-nums ml-auto",
                    vendor.isConcentrationRisk ? "text-warning" : "text-muted-foreground"
                  )}
                >
                  {vendor.percentOfTotal.toFixed(1)}% of total
                </span>
              </div>

              {/* Expanded: recent invoices */}
              {isExpanded && (
                <div className="border-t border-border px-4 pb-4 pt-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    Recent invoices
                  </p>
                  {vendorInvoices.length === 0 ? (
                    <p className="text-sm text-muted-foreground/70 italic">No invoices found.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-border hover:bg-transparent">
                            <TableHead className="text-muted-foreground text-xs">Invoice #</TableHead>
                            <TableHead className="text-muted-foreground text-xs">Date</TableHead>
                            <TableHead className="text-muted-foreground text-xs">Category</TableHead>
                            <TableHead className="text-muted-foreground text-xs">Status</TableHead>
                            <TableHead className="text-muted-foreground text-xs text-right">Amount (excl. VAT)</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {vendorInvoices.map((inv) => (
                            <TableRow key={inv.id} className="border-border/50 hover:bg-accent">
                              <TableCell className="text-xs font-mono text-foreground">
                                {inv.number}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {formatDate(inv.postingDate)}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
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
                              <TableCell className="text-xs font-mono text-foreground text-right tabular-nums">
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
