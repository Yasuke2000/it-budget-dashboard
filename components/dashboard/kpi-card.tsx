"use client";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AreaChart, Area, ResponsiveContainer } from "recharts";
import {
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
}

const SPARKLINE_COLORS = {
  positive: { stroke: "#34d399", fill: "#34d399" },
  negative: { stroke: "#f87171", fill: "#f87171" },
  neutral: { stroke: "#94a3b8", fill: "#94a3b8" },
} as const;

export function KPICard({
  title,
  value,
  change,
  changeType = "neutral",
  iconName,
  description,
  sparklineData,
}: KPICardProps) {
  const Icon = ICON_MAP[iconName];
  const colors = SPARKLINE_COLORS[changeType];
  const chartData = sparklineData?.map((v) => ({ v }));

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-400">{title}</p>
            <div className="flex items-center gap-3">
              <p className="text-2xl font-bold font-mono tabular-nums text-white">{value}</p>
              {chartData && chartData.length > 1 && (
                <ResponsiveContainer width={80} height={28}>
                  <AreaChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id={`spark-${iconName}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={colors.fill} stopOpacity={0.2} />
                        <stop offset="100%" stopColor={colors.fill} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area
                      type="monotone"
                      dataKey="v"
                      stroke={colors.stroke}
                      strokeWidth={1.5}
                      fill={`url(#spark-${iconName})`}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
            {change && (
              <p
                className={cn(
                  "text-xs font-medium",
                  changeType === "positive" && "text-emerald-400",
                  changeType === "negative" && "text-red-400",
                  changeType === "neutral" && "text-slate-400"
                )}
              >
                {change}
              </p>
            )}
            {description && (
              <p className="text-xs text-slate-500">{description}</p>
            )}
          </div>
          <div className="p-3 rounded-lg bg-slate-800">
            <Icon className="h-6 w-6 text-teal-400" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
