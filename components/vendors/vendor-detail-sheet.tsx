"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { AlertTriangle, FileText, Percent, CalendarClock, Tag } from "lucide-react";
import type { VendorSummary } from "@/lib/types";

interface VendorDetailSheetProps {
  vendor: VendorSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VendorDetailSheet({ vendor, open, onOpenChange }: VendorDetailSheetProps) {
  if (!vendor) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[440px] sm:max-w-[440px] overflow-y-auto bg-background border-border">
        <SheetHeader className="pb-2">
          <SheetTitle className="text-foreground text-lg">{vendor.vendorName}</SheetTitle>
          <SheetDescription className="text-muted-foreground">
            Vendor #{vendor.vendorNumber || "N/A"}
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-6 space-y-6">
          {/* Key stats grid */}
          <div className="grid grid-cols-2 gap-4">
            <StatCard
              label="Total Spend"
              value={formatCurrency(vendor.totalSpend)}
              icon={<span className="text-primary text-sm font-bold">EUR</span>}
            />
            <StatCard
              label="Invoice Count"
              value={vendor.invoiceCount.toString()}
              icon={<FileText className="h-4 w-4 text-muted-foreground" />}
            />
            <StatCard
              label="% of Total"
              value={`${vendor.percentOfTotal.toFixed(1)}%`}
              icon={<Percent className="h-4 w-4 text-muted-foreground" />}
              highlight={vendor.isConcentrationRisk}
            />
            <StatCard
              label="Last Invoice"
              value={vendor.lastInvoiceDate ? formatDate(vendor.lastInvoiceDate) : "N/A"}
              icon={<CalendarClock className="h-4 w-4 text-muted-foreground" />}
            />
          </div>

          {/* Concentration risk */}
          {vendor.isConcentrationRisk && (
            <div className="flex items-center gap-3 rounded-lg border border-warning/50 bg-warning/10 px-4 py-3">
              <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
              <div>
                <p className="text-sm font-medium text-warning">Concentration Risk</p>
                <p className="text-xs text-warning/70">
                  This vendor represents {vendor.percentOfTotal.toFixed(1)}% of total IT spend, exceeding the 30% threshold.
                </p>
              </div>
            </div>
          )}

          {/* Categories */}
          {vendor.categories.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Tag className="h-4 w-4 text-muted-foreground" />
                Categories
              </div>
              <div className="flex flex-wrap gap-2">
                {vendor.categories.map((cat) => (
                  <Badge
                    key={cat}
                    variant="outline"
                    className="bg-muted text-foreground border-border text-xs"
                  >
                    {cat}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Contract renewal date */}
          {vendor.contractRenewalDate && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <CalendarClock className="h-4 w-4 text-muted-foreground" />
                Contract Renewal
              </div>
              <p className="text-sm text-muted-foreground pl-6">
                {formatDate(vendor.contractRenewalDate)}
              </p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function StatCard({
  label,
  value,
  icon,
  highlight = false,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <p
        className={`text-sm font-semibold font-mono tabular-nums ${
          highlight ? "text-warning" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
