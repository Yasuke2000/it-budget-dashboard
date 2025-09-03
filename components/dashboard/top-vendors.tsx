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
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white">Top Vendors</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {top5.map((vendor) => (
            <div key={vendor.vendorName} className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-300">{vendor.vendorName}</span>
                  {vendor.isConcentrationRisk && (
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                  )}
                </div>
                <span className="text-sm font-mono text-slate-400">{formatCurrency(vendor.totalSpend)}</span>
              </div>
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-teal-500 rounded-full transition-all"
                  style={{ width: `${(vendor.totalSpend / maxSpend) * 100}%` }}
                />
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="bg-slate-800 text-slate-400 text-xs">
                  {vendor.invoiceCount} invoices
                </Badge>
                <span className="text-xs text-slate-500">{vendor.percentOfTotal.toFixed(1)}% of total</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
