"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { VendorSummary } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";

interface TopVendorsProps {
  vendors: VendorSummary[];
}

export function TopVendors({ vendors }: TopVendorsProps) {
  const top5 = vendors.slice(0, 5);
  const maxSpend = top5[0]?.totalSpend || 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top vendors</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {top5.map((vendor) => (
            <div key={vendor.vendorName} className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{vendor.vendorName}</span>
                  {vendor.isConcentrationRisk && (
                    <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                  )}
                </div>
                <span className="font-mono text-sm tabnum text-muted-foreground">{formatCurrency(vendor.totalSpend)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-primary/70 transition-all"
                  style={{ width: `${(vendor.totalSpend / maxSpend) * 100}%` }}
                />
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {vendor.invoiceCount} invoices
                </Badge>
                <span className="text-xs text-muted-foreground/70">{vendor.percentOfTotal.toFixed(1)}% of total</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
