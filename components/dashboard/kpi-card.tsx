"use client";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AreaChart, Area, ResponsiveContainer } from "recharts";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Key,
  Monitor,
  BarChart2,
  Users,
  Shield,
  ShieldCheck,
  Clock,
  AlertTriangle,
  Building2,
  Percent,
  Lightbulb,
  Plug,
} from "lucide-react";

const ICON_MAP = {
  DollarSign,
  TrendingUp,
  Key,
  Monitor,
  BarChart2,
  Users,
  Shield,
  ShieldCheck,
  Clock,
  AlertTriangle,
  Building2,
  Percent,
  Lightbulb,
  Plug,
} as const;

export type KPIIconName = keyof typeof ICON_MAP;

interface KPICardProps {
  title: string;
  value: string;
  change?: string;
  changeType?: "positive" | "negative" | "neutral";
  iconName: KPIIconName;
  description?: string;
  sparklineData?: number[];
  /** Headline tile — renders the value in champagne gold. Use once per view. */
  featured?: boolean;
}

// Theme-aware via CSS custom properties (resolve against the live theme).
const SPARK: Record<NonNullable<KPICardProps["changeType"]>, string> = {
  positive: "var(--positive)",
  negative: "var(--negative)",
  neutral: "var(--chart-budget)",
};

export function KPICard({
  title,
  value,
  change,
  changeType = "neutral",
  iconName,
  description,
  sparklineData,
  featured = false,
}: KPICardProps) {
  const Icon = ICON_MAP[iconName];
  const sparkColor = SPARK[changeType];
  const chartData = sparklineData?.map((v) => ({ v }));
  const gradId = `spark-${iconName}-${changeType}`;

  return (
    <Card
      className={cn(
        "gap-0 py-0 hover:-translate-y-0.5 hover:ring-border-strong",
        featured &&
          "ring-gold/25 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_18px_50px_-30px_var(--gold)]"
      )}
    >
      {/* accent hairline at the very top */}
      <div
        aria-hidden
        className={cn(
          "h-px w-full",
          featured
            ? "bg-gradient-to-r from-transparent via-gold/60 to-transparent"
            : "bg-gradient-to-r from-transparent via-primary/40 to-transparent"
        )}
      />
      <div className="flex items-start justify-between gap-3 p-5 pb-4">
        <div className="min-w-0 space-y-2.5">
          <p className="truncate text-[13px] font-medium text-muted-foreground">
            {title}
          </p>
          <p
            className={cn(
              "text-[27px] font-semibold leading-none tracking-tight",
              featured ? "text-gradient-gold" : "text-foreground"
            )}
            aria-live="polite"
            {...((/[KM]/).test(value)
              ? {
                  "aria-label": `${title}: ${value
                    .replace(/K/, " thousand")
                    .replace(/M/, " million")}`,
                }
              : {})}
          >
            {value}
          </p>
          {change && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                changeType === "positive" && "bg-positive/10 text-positive",
                changeType === "negative" && "bg-negative/10 text-negative",
                changeType === "neutral" && "bg-muted text-muted-foreground"
              )}
            >
              {changeType === "positive" && <TrendingUp className="h-3 w-3" />}
              {changeType === "negative" && <TrendingDown className="h-3 w-3" />}
              {change}
            </span>
          )}
          {description && (
            <p className="text-xs leading-snug text-muted-foreground/70">
              {description}
            </p>
          )}
        </div>
        <div
          className={cn(
            "shrink-0 rounded-xl p-2.5 ring-1",
            featured
              ? "bg-gold/10 text-gold ring-gold/25"
              : "bg-primary/10 text-primary ring-primary/20"
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
      {/* full-bleed sparkline footer */}
      {chartData && chartData.length > 1 && (
        <div className="h-9 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={sparkColor} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={sparkColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="v"
                stroke={sparkColor}
                strokeWidth={1.75}
                fill={`url(#${gradId})`}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
