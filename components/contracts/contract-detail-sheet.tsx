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
  FileText,
} from "lucide-react";
import type { Contract } from "@/lib/types";

interface ContractDetailSheetProps {
  contract: Contract | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STATUS_STYLES: Record<string, string> = {
  active: "bg-positive/10 text-positive border-positive/30",
  expiring_soon: "bg-warning/10 text-warning border-warning/30",
  expired: "bg-negative/10 text-negative border-negative/30",
  cancelled: "bg-muted text-muted-foreground border-border",
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

// Days until the notice deadline (end date minus the notice period).
function getNoticeDaysLeft(endDate: string, noticePeriodDays: number): number {
  const noticeDate = new Date(endDate);
  noticeDate.setDate(noticeDate.getDate() - noticePeriodDays);
  return Math.ceil((noticeDate.getTime() - Date.now()) / 86400000);
}

function getDaysLeftColor(days: number): string {
  if (days < 0) return "text-muted-foreground";
  if (days <= 30) return "text-negative";
  if (days <= 90) return "text-warning";
  return "text-positive";
}

export function ContractDetailSheet({ contract, open, onOpenChange }: ContractDetailSheetProps) {
  if (!contract) return null;

  const daysLeft = getDaysLeft(contract.endDate);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[460px] sm:max-w-[460px] overflow-y-auto bg-background border-border">
        <SheetHeader className="pb-2">
          <SheetTitle className="text-foreground text-lg">{contract.vendor}</SheetTitle>
          <SheetDescription className="text-muted-foreground line-clamp-2">
            {contract.description}
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-6 space-y-6">
          {/* Status + Category row */}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={STATUS_STYLES[contract.status] || ""}>
              {contract.status.replace("_", " ")}
            </Badge>
            <Badge variant="outline" className="border-border text-foreground">
              {CATEGORY_LABELS[contract.category] || contract.category}
            </Badge>
            {contract.autoRenew ? (
              <Badge variant="outline" className="bg-positive/10 text-positive border-positive/30 gap-1">
                <CheckCircle className="h-3 w-3" />
                Auto-renew
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-muted text-muted-foreground border-border gap-1">
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
              icon={<CalendarDays className="h-4 w-4 text-muted-foreground" />}
            />
            <InfoCard
              label="End Date"
              value={formatDate(contract.endDate)}
              icon={<CalendarClock className="h-4 w-4 text-muted-foreground" />}
            />
            <InfoCard
              label="Days Left"
              value={daysLeft < 0 ? "Expired" : `${daysLeft} days`}
              icon={<Clock className="h-4 w-4 text-muted-foreground" />}
              valueClassName={getDaysLeftColor(daysLeft)}
            />
            <InfoCard
              label="Billing Cycle"
              value={BILLING_LABELS[contract.billingCycle] || contract.billingCycle}
              icon={<RefreshCw className="h-4 w-4 text-muted-foreground" />}
            />
            <InfoCard
              label="Annual Cost"
              value={formatCurrency(contract.annualCost)}
              icon={<CreditCard className="h-4 w-4 text-primary" />}
            />
            <InfoCard
              label="Monthly Cost"
              value={formatCurrency(contract.monthlyCost)}
              icon={<CreditCard className="h-4 w-4 text-muted-foreground" />}
            />
          </div>

          {/* Notice period */}
          {contract.noticePeriodDays > 0 && (
            <div className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3">
              <Bell className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-foreground">Notice Period</p>
                <p className="text-xs text-muted-foreground">
                  {contract.noticePeriodDays} days before end date
                  {(() => {
                    const noticeDaysLeft = getNoticeDaysLeft(contract.endDate, contract.noticePeriodDays);
                    if (noticeDaysLeft <= 0) {
                      return " — notice period has passed";
                    }
                    return ` — ${noticeDaysLeft} days until notice deadline`;
                  })()}
                </p>
              </div>
            </div>
          )}

          {/* Attached document */}
          {contract.fileId && (
            <a
              href={`/api/contracts/file?id=${contract.fileId}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 hover:border-primary/40 transition-colors"
            >
              <FileText className="h-4 w-4 text-primary shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-primary truncate">{contract.fileName || "View document"}</p>
                <p className="text-xs text-muted-foreground">Open contract document</p>
              </div>
            </a>
          )}

          {/* Owner */}
          {contract.owner && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Owner</p>
              <p className="text-sm text-foreground">{contract.owner}</p>
            </div>
          )}

          {/* Notes */}
          {contract.notes && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <StickyNote className="h-4 w-4 text-muted-foreground" />
                Notes
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{contract.notes}</p>
              </div>
            </div>
          )}

          {/* Tags */}
          {contract.tags.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Tag className="h-4 w-4 text-muted-foreground" />
                Tags
              </div>
              <div className="flex flex-wrap gap-2">
                {contract.tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="outline"
                    className="bg-muted text-foreground border-border text-xs"
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
    <div className="rounded-lg border border-border bg-card p-3 space-y-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className={`text-sm font-semibold font-mono tabular-nums ${valueClassName || "text-foreground"}`}>
        {value}
      </p>
    </div>
  );
}
