"use client";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
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
}

export function KPICard({
  title,
  value,
  change,
  changeType = "neutral",
  iconName,
  description,
}: KPICardProps) {
  const Icon = ICON_MAP[iconName];

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-400">{title}</p>
            <p className="text-2xl font-bold font-mono text-white">{value}</p>
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
