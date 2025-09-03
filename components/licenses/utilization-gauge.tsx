"use client";

import { cn } from "@/lib/utils";

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
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;

  // Color logic
  const color = isFree
    ? { stroke: "#64748b", text: "text-slate-400", ring: "#334155" }
    : pct >= 90
    ? { stroke: "#10b981", text: "text-emerald-400", ring: "#064e3b" }
    : pct >= 70
    ? { stroke: "#f59e0b", text: "text-amber-400", ring: "#451a03" }
    : { stroke: "#ef4444", text: "text-red-400", ring: "#450a0a" };

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
            stroke="#1e293b"
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
            <span className="text-xs font-medium text-slate-500">Free</span>
          ) : (
            <>
              <span className={cn("text-lg font-bold leading-none", color.text)}>
                {pct.toFixed(0)}%
              </span>
              <span className="text-[10px] text-slate-500 mt-0.5">used</span>
            </>
          )}
        </div>
      </div>

      {label && (
        <span className="text-xs text-slate-500 text-center">{label}</span>
      )}
    </div>
  );
}
