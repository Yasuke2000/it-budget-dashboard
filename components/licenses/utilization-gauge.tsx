"use client";

import { cn } from "@/lib/utils";
import { useChartPalette } from "@/lib/chart-theme";

interface UtilizationGaugeProps {
  value: number;
  max: number;
  label?: string;
  isFree?: boolean;
}

export function UtilizationGauge({
  value,
  max,
  label,
  isFree = false,
}: UtilizationGaugeProps) {
  const p = useChartPalette();
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;

  // Color logic
  const color = isFree
    ? { stroke: p.budget, text: "text-muted-foreground", ring: p.grid }
    : pct >= 90
    ? { stroke: p.positive, text: "text-positive", ring: p.grid }
    : pct >= 70
    ? { stroke: p.warning, text: "text-warning", ring: p.grid }
    : { stroke: p.negative, text: "text-negative", ring: p.grid };

  // SVG circle gauge
  const size = 96;
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  // Use 270° arc (start at 135°, sweep 270°)
  const arcFraction = 0.75;
  const dashArray = circumference * arcFraction;
  const dashOffset = isFree ? dashArray : dashArray * (1 - pct / 100);

  // Rotation so the arc starts at bottom-left (135deg)
  const rotationDeg = 135;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="-rotate-[135deg]"
          style={{ transform: `rotate(${rotationDeg}deg)` }}
        >
          {/* Track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={p.grid}
            strokeWidth={strokeWidth}
            strokeDasharray={`${dashArray} ${circumference}`}
            strokeLinecap="round"
          />
          {/* Progress */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color.stroke}
            strokeWidth={strokeWidth}
            strokeDasharray={`${dashArray} ${circumference}`}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 0.6s ease" }}
          />
        </svg>

        {/* Center label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {isFree ? (
            <span className="text-xs font-medium text-muted-foreground">Free</span>
          ) : (
            <>
              <span className={cn("text-lg font-bold leading-none", color.text)}>
                {pct.toFixed(0)}%
              </span>
              <span className="text-[10px] text-muted-foreground mt-0.5">used</span>
            </>
          )}
        </div>
      </div>

      {label && (
        <span className="text-xs text-muted-foreground text-center">{label}</span>
      )}
    </div>
  );
}
