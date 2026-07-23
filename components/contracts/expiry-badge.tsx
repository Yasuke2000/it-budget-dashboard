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
      <Badge variant="outline" className="bg-muted text-muted-foreground border-border font-mono text-xs">
        Expired
      </Badge>
    );
  }
  if (daysLeft <= 30) {
    return (
      <Badge variant="outline" className="bg-negative/10 text-negative border-negative/30 font-mono tabular-nums text-xs">
        {daysLeft}d
      </Badge>
    );
  }
  if (daysLeft <= 90) {
    return (
      <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30 font-mono tabular-nums text-xs">
        {daysLeft}d
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="bg-positive/10 text-positive border-positive/30 font-mono tabular-nums text-xs">
      {daysLeft}d
    </Badge>
  );
}
