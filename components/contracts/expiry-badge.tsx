"use client";

import { Badge } from "@/components/ui/badge";

interface ExpiryBadgeProps {
  endDate: string;
}

export function ExpiryBadge({ endDate }: ExpiryBadgeProps) {
  const now = new Date();
  const end = new Date(endDate);
  const daysLeft = Math.ceil((end.getTime() - now.getTime()) / 86400000);

  if (daysLeft < 0) {
    return (
      <Badge variant="outline" className="bg-slate-500/20 text-slate-400 border-slate-500/30 font-mono text-xs">
        Expired
      </Badge>
    );
  }
  if (daysLeft <= 30) {
    return (
      <Badge variant="outline" className="bg-red-500/20 text-red-400 border-red-500/30 font-mono text-xs">
        {daysLeft}d
      </Badge>
    );
  }
  if (daysLeft <= 90) {
    return (
      <Badge variant="outline" className="bg-amber-500/20 text-amber-400 border-amber-500/30 font-mono text-xs">
        {daysLeft}d
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 font-mono text-xs">
      {daysLeft}d
    </Badge>
  );
}
