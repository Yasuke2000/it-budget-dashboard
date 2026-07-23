"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UtilizationGauge } from "./utilization-gauge";
import { formatCurrency, cn } from "@/lib/utils";
import type { M365License } from "@/lib/types";
import { AlertTriangle, Users, Package } from "lucide-react";

interface LicenseCardProps {
  license: M365License;
}

export function LicenseCard({ license }: LicenseCardProps) {
  const isFree = license.pricePerUser === 0;
  // utilizationRate is already a percentage (0–100), not a fraction.
  const pct = license.utilizationRate;

  const utilizationLabel =
    isFree
      ? "Free"
      : pct >= 90
      ? "Healthy"
      : pct >= 70
      ? "Moderate"
      : "Underutilized";

  const utilizationBadgeClass =
    isFree
      ? "bg-muted text-muted-foreground border-border"
      : pct >= 90
      ? "bg-positive/10 text-positive border-positive/30"
      : pct >= 70
      ? "bg-warning/10 text-warning border-warning/30"
      : "bg-negative/10 text-negative border-negative/30";

  const available = license.prepaidUnits - license.consumedUnits;

  return (
    <Card className="hover:border-border-strong transition-colors">
      <CardContent className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-foreground text-sm leading-snug truncate">
              {license.displayName}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5 font-mono">
              {license.skuPartNumber}
            </p>
          </div>
          <Badge
            variant="outline"
            className={cn("text-xs shrink-0 border", utilizationBadgeClass)}
          >
            {utilizationLabel}
          </Badge>
        </div>

        {/* Gauge + Stats row */}
        <div className="flex items-center gap-4 mb-4">
          <UtilizationGauge
            value={license.consumedUnits}
            max={license.prepaidUnits}
            isFree={isFree}
          />

          {/* Seat breakdown */}
          <div className="flex-1 space-y-2">
            <StatRow
              icon={<Package className="h-3.5 w-3.5 text-muted-foreground" />}
              label="Purchased"
              value={license.prepaidUnits.toString()}
              valueClass="text-foreground"
            />
            <StatRow
              icon={<Users className="h-3.5 w-3.5 text-muted-foreground" />}
              label="Assigned"
              value={license.consumedUnits.toString()}
              valueClass="text-foreground"
            />
            <StatRow
              icon={
                <span
                  className={cn(
                    "h-3.5 w-3.5 inline-flex items-center justify-center rounded-full text-[8px] font-bold",
                    available > 0 ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  ●
                </span>
              }
              label="Available"
              value={available.toString()}
              valueClass={available > 0 ? "text-primary" : "text-muted-foreground"}
            />
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-border pt-3 space-y-2">
          {/* Monthly cost */}
          {!isFree && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Monthly cost</span>
              <span className="text-sm font-mono font-semibold text-foreground">
                {formatCurrency(license.monthlyCost)}
              </span>
            </div>
          )}

          {/* Per-user price */}
          {!isFree && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Per user / mo</span>
              <span className="text-xs font-mono text-muted-foreground">
                {formatCurrency(license.pricePerUser)}
              </span>
            </div>
          )}

          {/* Waste indicator */}
          {!isFree && license.wastedUnits > 0 && (
            <div className="flex items-start gap-2 rounded-md bg-negative/10 border border-negative/20 px-3 py-2 mt-1">
              <AlertTriangle className="h-3.5 w-3.5 text-negative shrink-0 mt-0.5" />
              <p className="text-xs text-negative leading-snug">
                <span className="font-semibold">{license.wastedUnits} unused</span>{" "}
                license{license.wastedUnits !== 1 ? "s" : ""} ={" "}
                <span className="font-semibold font-mono">
                  {formatCurrency(license.wastedCost)}/mo
                </span>{" "}
                waste
              </p>
            </div>
          )}

          {/* Free license note */}
          {isFree && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Cost</span>
              <Badge
                variant="secondary"
                className="bg-muted text-muted-foreground text-xs"
              >
                Free tier
              </Badge>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StatRow({
  icon,
  label,
  value,
  valueClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0">{icon}</span>
      <span className="text-xs text-muted-foreground flex-1">{label}</span>
      <span className={cn("text-xs font-mono font-medium tabular-nums", valueClass)}>
        {value}
      </span>
    </div>
  );
}
