"use client";

import { useState, useEffect, useMemo } from "react";
import { KPICard } from "@/components/dashboard/kpi-card";
import { ContractTimeline } from "@/components/contracts/contract-timeline";
import { ContractTable } from "@/components/contracts/contract-table";
import { formatCurrencyCompact } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import type { Contract } from "@/lib/types";

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/contracts")
      .then((res) => res.json())
      .then((data) => { setContracts(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const kpis = useMemo(() => {
    const now = Date.now();
    const active = contracts.filter((c) => c.status === "active" || c.status === "expiring_soon");
    const expiringSoon = contracts.filter((c) => {
      const days = (new Date(c.endDate).getTime() - now) / 86400000;
      return days > 0 && days <= 90;
    });
    const totalAnnual = active.reduce((s, c) => s + c.annualCost, 0);
    const avgDuration = active.length > 0
      ? active.reduce((s, c) => {
          const start = new Date(c.startDate).getTime();
          const end = new Date(c.endDate).getTime();
          return s + (end - start) / (86400000 * 30);
        }, 0) / active.length
      : 0;
    return { activeCount: active.length, expiringCount: expiringSoon.length, totalAnnual, avgDuration };
  }, [contracts]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div><h1 className="text-2xl font-bold text-white">Contracts</h1></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 bg-slate-800 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Contracts</h1>
        <p className="text-slate-400">IT contract & renewal management</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Active Contracts"
          value={kpis.activeCount.toString()}
          iconName="Shield"
          description="Currently active"
        />
        <KPICard
          title="Expiring ≤90 Days"
          value={kpis.expiringCount.toString()}
          changeType={kpis.expiringCount > 0 ? "negative" : "positive"}
          iconName="AlertTriangle"
          description="Needs attention"
        />
        <KPICard
          title="Annual Commitment"
          value={formatCurrencyCompact(kpis.totalAnnual)}
          iconName="DollarSign"
          description="Total active contracts"
        />
        <KPICard
          title="Avg Duration"
          value={`${Math.round(kpis.avgDuration)} mo`}
          iconName="Clock"
          description="Average contract length"
        />
      </div>

      <ContractTimeline contracts={contracts} />
      <ContractTable contracts={contracts} />
    </div>
  );
}
