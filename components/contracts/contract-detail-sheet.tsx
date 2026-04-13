"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  CalendarClock,
  CalendarDays,
  Clock,
  CreditCard,
  RefreshCw,
  Bell,
  StickyNote,
  Tag,
  CheckCircle,
  XCircle,
} from "lucide-react";
import type { Contract } from "@/lib/types";

interface ContractDetailSheetProps {
  contract: Contract | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  expiring_soon: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  expired: "bg-red-500/20 text-red-400 border-red-500/30",
  cancelled: "bg-slate-500/20 text-slate-400 border-slate-500/30",
};

const CATEGORY_LABELS: Record<string, string> = {
  license: "License",
  domain: "Domain",
  ssl: "SSL",
  support: "Support",
  saas: "SaaS",
  infrastructure: "Infrastructure",
};

const BILLING_LABELS: Record<string, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
  "multi-year": "Multi-year",
};

function getDaysLeft(endDate: string): number {
  return Math.ceil((new Date(endDate).getTime() - Date.now()) / 86400000);
}

function getDaysLeftColor(days: number): string {
  if (days < 0) return "text-slate-400";
  if (days <= 30) return "text-red-400";
  if (days <= 90) return "text-amber-400";
  return "text-emerald-400";
}

export function ContractDetailSheet({ contract, open, onOpenChange }: ContractDetailSheetProps) {
  if (!contract) return null;

  const daysLeft = getDaysLeft(contract.endDate);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[460px] sm:max-w-[460px] overflow-y-auto bg-slate-950 border-slate-800">
        <SheetHeader className="pb-2">
          <SheetTitle className="text-white text-lg">{contract.vendor}</SheetTitle>
          <SheetDescription className="text-slate-400 line-clamp-2">
            {contract.description}
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-6 space-y-6">
          {/* Status + Category row */}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={STATUS_STYLES[contract.status] || ""}>
              {contract.status.replace("_", " ")}
            </Badge>
            <Badge variant="outline" className="border-slate-700 text-slate-300">
              {CATEGORY_LABELS[contract.category] || contract.category}
            </Badge>
            {contract.autoRenew ? (
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 gap-1">
                <CheckCircle className="h-3 w-3" />
                Auto-renew
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-slate-500/10 text-slate-400 border-slate-600 gap-1">
                <XCircle className="h-3 w-3" />
                Manual renewal
              </Badge>
            )}
          </div>

          {/* Key info grid */}
          <div className="grid grid-cols-2 gap-4">
            <InfoCard
              label="Start Date"
              value={formatDate(contract.startDate)}
              icon={<CalendarDays className="h-4 w-4 text-slate-400" />}
            />
            <InfoCard
              label="End Date"
              value={formatDate(contract.endDate)}
              icon={<CalendarClock className="h-4 w-4 text-slate-400" />}
            />
            <InfoCard
              label="Days Left"
              value={daysLeft < 0 ? "Expired" : `${daysLeft} days`}
              icon={<Clock className="h-4 w-4 text-slate-400" />}
              valueClassName={getDaysLeftColor(daysLeft)}
            />
            <InfoCard
              label="Billing Cycle"
              value={BILLING_LABELS[contract.billingCycle] || contract.billingCycle}
              icon={<RefreshCw className="h-4 w-4 text-slate-400" />}
            />
            <InfoCard
              label="Annual Cost"
              value={formatCurrency(contract.annualCost)}
              icon={<CreditCard className="h-4 w-4 text-teal-400" />}
            />
            <InfoCard
              label="Monthly Cost"
              value={formatCurrency(contract.monthlyCost)}
              icon={<CreditCard className="h-4 w-4 text-slate-400" />}
            />
          </div>

          {/* Notice period */}
          {contract.noticePeriodDays > 0 && (
            <div className="flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-900 px-4 py-3">
              <Bell className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-slate-300">Notice Period</p>
                <p className="text-xs text-slate-500">
                  {contract.noticePeriodDays} days before end date
                  {(() => {
                    const noticeDate = new Date(contract.endDate);
                    noticeDate.setDate(noticeDate.getDate() - contract.noticePeriodDays);
                    const noticeDaysLeft = Math.ceil((noticeDate.getTime() - Date.now()) / 86400000);
                    if (noticeDaysLeft <= 0) {
                      return " — notice period has passed";
                    }
                    return ` — ${noticeDaysLeft} days until notice deadline`;
                  })()}
                </p>
              </div>
            </div>
          )}

          {/* Owner */}
          {contract.owner && (
            <div className="space-y-1">
              <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">Owner</p>
              <p className="text-sm text-slate-300">{contract.owner}</p>
            </div>
          )}

          {/* Notes */}
          {contract.notes && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
                <StickyNote className="h-4 w-4 text-slate-400" />
                Notes
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900 p-3">
                <p className="text-sm text-slate-400 whitespace-pre-wrap">{contract.notes}</p>
              </div>
            </div>
          )}

          {/* Tags */}
          {contract.tags.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
                <Tag className="h-4 w-4 text-slate-400" />
                Tags
              </div>
              <div className="flex flex-wrap gap-2">
                {contract.tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="outline"
                    className="bg-slate-800 text-slate-300 border-slate-700 text-xs"
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function InfoCard({
  label,
  value,
  icon,
  valueClassName,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-3 space-y-1">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        {icon}
        {label}
      </div>
      <p className={`text-sm font-semibold font-mono tabular-nums ${valueClassName || "text-white"}`}>
        {value}
      </p>
    </div>
  );
}
