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
  const pct = license.utilizationRate * 100;

  const utilizationColor =
    isFree
      ? "text-slate-400"
      : pct >= 90
      ? "text-emerald-400"
      : pct >= 70
      ? "text-amber-400"
      : "text-red-400";

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
      ? "bg-slate-700/50 text-slate-400 border-slate-600"
      : pct >= 90
      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
      : pct >= 70
      ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
      : "bg-red-500/15 text-red-400 border-red-500/30";

  const available = license.prepaidUnits - license.consumedUnits;

  return (
    <Card className="bg-slate-900 border-slate-800 hover:border-slate-700 transition-colors">
      <CardContent className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-white text-sm leading-snug truncate">
              {license.displayName}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 font-mono">
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
              icon={<Package className="h-3.5 w-3.5 text-slate-500" />}
              label="Purchased"
              value={license.prepaidUnits.toString()}
              valueClass="text-slate-300"
            />
            <StatRow
              icon={<Users className="h-3.5 w-3.5 text-slate-500" />}
              label="Assigned"
              value={license.consumedUnits.toString()}
              valueClass="text-slate-300"
            />
            <StatRow
              icon={
                <span
                  className={cn(
                    "h-3.5 w-3.5 inline-flex items-center justify-center rounded-full text-[8px] font-bold",
                    available > 0 ? "text-teal-400" : "text-slate-500"
                  )}
                >
                  ●
                </span>
              }
              label="Available"
              value={available.toString()}
              valueClass={available > 0 ? "text-teal-400" : "text-slate-500"}
            />
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-slate-800 pt-3 space-y-2">
          {/* Monthly cost */}
          {!isFree && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Monthly cost</span>
              <span className="text-sm font-mono font-semibold text-white">
                {formatCurrency(license.monthlyCost)}
              </span>
            </div>
          )}

          {/* Per-user price */}
          {!isFree && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Per user / mo</span>
              <span className="text-xs font-mono text-slate-400">
                {formatCurrency(license.pricePerUser)}
              </span>
            </div>
          )}

          {/* Waste indicator */}
          {!isFree && license.wastedUnits > 0 && (
            <div className="flex items-start gap-2 rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 mt-1">
              <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-300 leading-snug">
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
              <span className="text-xs text-slate-500">Cost</span>
              <Badge
                variant="secondary"
                className="bg-slate-800 text-slate-400 text-xs"
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
      <span className="text-xs text-slate-500 flex-1">{label}</span>
      <span className={cn("text-xs font-mono font-medium tabular-nums", valueClass)}>
        {value}
      </span>
    </div>
  );
}
