"use client";

import { getVarianceStatus } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface VarianceIndicatorProps {
  variancePercent: number;
  showLabel?: boolean;
  size?: "sm" | "md";
}

export function VarianceIndicator({
  variancePercent,
  showLabel = true,
  size = "sm",
}: VarianceIndicatorProps) {
  const status = getVarianceStatus(variancePercent);

  const dotClass = cn(
    "rounded-full shrink-0",
    size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5",
    status === "green" && "bg-emerald-500",
    status === "amber" && "bg-amber-500",
    status === "red" && "bg-red-500"
  );

  const textClass = cn(
    "font-medium tabular-nums",
    size === "sm" ? "text-xs" : "text-sm",
    status === "green" && "text-emerald-400",
    status === "amber" && "text-amber-400",
    status === "red" && "text-red-400"
  );

  const absVal = Math.abs(variancePercent);
  const sign = variancePercent > 0 ? "+" : variancePercent < 0 ? "-" : "";
  const label = `${sign}${absVal.toFixed(1)}%`;

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={dotClass} />
      {showLabel && <span className={textClass}>{label}</span>}
    </span>
  );
}
