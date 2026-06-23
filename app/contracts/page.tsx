"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { KPICard } from "@/components/dashboard/kpi-card";
import { ContractTimeline } from "@/components/contracts/contract-timeline";
import { ContractTable } from "@/components/contracts/contract-table";
import { ContractFormDialog } from "@/components/contracts/contract-form-dialog";
import { ContractDiscoverDialog } from "@/components/contracts/contract-discover-dialog";
import { Button } from "@/components/ui/button";
import { Plus, Sparkles } from "lucide-react";
import { formatCurrencyCompact } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import type { Contract } from "@/lib/types";

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [now] = useState(() => Date.now());
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Contract> | null>(null);
  const [discoverOpen, setDiscoverOpen] = useState(false);

  const load = useCallback(() => {
    return fetch("/api/contracts")
      .then((res) => res.json())
      .then((data) => { setContracts(Array.isArray(data) ? data : []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const kpis = useMemo(() => {
    const active = contracts.filter((c) => c.status === "active" || c.status === "expiring_soon");
    const expiringSoon = contracts.filter((c) => {
      const days = (new Date(c.endDate).getTime() - now) / 86400000;
      return days > 0 && days <= 90;
    });
    const totalAnnual = active.reduce((s, c) => s + c.annualCost, 0);
    const autoRenewing = active.filter((c) => c.autoRenew).length;
    return { activeCount: active.length, expiringCount: expiringSoon.length, totalAnnual, autoRenewing };
  }, [contracts, now]);

  function openNew() { setEditing(null); setFormOpen(true); }
  function openEdit(c: Contract) { setEditing(c); setFormOpen(true); }
  async function handleDelete(c: Contract) {
    if (!confirm(`Delete the ${c.vendor} contract?`)) return;
    await fetch(`/api/contracts?id=${encodeURIComponent(c.id)}`, { method: "DELETE" });
    load();
  }

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
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Contracts</h1>
          <p className="text-slate-400">IT contract & renewal management</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setDiscoverOpen(true)}>
            <Sparkles className="h-4 w-4" /> Discover from spend
          </Button>
          <Button size="sm" className="gap-2" onClick={openNew}>
            <Plus className="h-4 w-4" /> Add contract
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Active Contracts" value={kpis.activeCount.toString()} iconName="Shield" description="Currently active" />
        <KPICard title="Expiring ≤90 Days" value={kpis.expiringCount.toString()} changeType={kpis.expiringCount > 0 ? "negative" : "positive"} iconName="AlertTriangle" description="Needs attention" />
        <KPICard title="Annual Commitment" value={formatCurrencyCompact(kpis.totalAnnual)} iconName="DollarSign" description="Total active contracts" />
        <KPICard title="Auto-renewing" value={kpis.autoRenewing.toString()} changeType={kpis.autoRenewing > 0 ? "neutral" : "positive"} iconName="Clock" description="Watch the notice window" />
      </div>

      {contracts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center rounded-xl border border-slate-800 bg-slate-900/40">
          <p className="text-slate-300 font-medium">No contracts tracked yet</p>
          <p className="text-slate-500 text-sm mt-1 max-w-md">
            Add a contract manually, or let the dashboard find your recurring IT vendors
            from Business Central spend — then fill in renewal dates and upload the signed documents.
          </p>
          <div className="flex items-center gap-2 mt-4">
            <Button variant="outline" size="sm" className="gap-2" onClick={() => setDiscoverOpen(true)}>
              <Sparkles className="h-4 w-4" /> Discover from spend
            </Button>
            <Button size="sm" className="gap-2" onClick={openNew}>
              <Plus className="h-4 w-4" /> Add contract
            </Button>
          </div>
        </div>
      ) : (
        <>
          <ContractTimeline contracts={contracts} />
          <ContractTable contracts={contracts} onEdit={openEdit} onDelete={handleDelete} />
        </>
      )}

      <ContractFormDialog open={formOpen} onOpenChange={setFormOpen} contract={editing} onSaved={load} />
      <ContractDiscoverDialog open={discoverOpen} onOpenChange={setDiscoverOpen} onAdded={load} />
    </div>
  );
}
