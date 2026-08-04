"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { KPICard } from "@/components/dashboard/kpi-card";
import { ContractTimeline } from "@/components/contracts/contract-timeline";
import { ContractTable } from "@/components/contracts/contract-table";
import { ContractFormDialog } from "@/components/contracts/contract-form-dialog";
import { ContractDiscoverDialog } from "@/components/contracts/contract-discover-dialog";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
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
    // Automatisch ontdekte contracten zijn afgeleid uit terugkerende leveranciers-
    // spend, niet uit een ondertekend document. Ze horen in het register (anders
    // mis je ze), maar "Annual Commitment" mag niet doen alsof het contractueel
    // vastgelegde bedragen zijn — vandaar deze aparte teller.
    const discovered = active.filter((c) => c.tags?.includes("auto-discovered"));
    const discoveredAnnual = discovered.reduce((s, c) => s + c.annualCost, 0);
    const withoutDocument = active.filter((c) => !c.fileId).length;
    return {
      activeCount: active.length, expiringCount: expiringSoon.length, totalAnnual, autoRenewing,
      discoveredCount: discovered.length, discoveredAnnual, withoutDocument,
    };
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
        <PageHeader title="Contracts" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contracts"
        description="IT contract & renewal management"
        actions={
          <>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => setDiscoverOpen(true)}>
              <Sparkles className="h-4 w-4" /> Discover from spend
            </Button>
            <Button size="sm" className="gap-2" onClick={openNew}>
              <Plus className="h-4 w-4" /> Add contract
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Active Contracts" value={kpis.activeCount.toString()} iconName="Shield" description="Currently active" />
        <KPICard title="Expiring ≤90 Days" value={kpis.expiringCount.toString()} changeType={kpis.expiringCount > 0 ? "negative" : "positive"} iconName="AlertTriangle" description="Needs attention" />
        <KPICard
          title="Annual Commitment"
          value={formatCurrencyCompact(kpis.totalAnnual)}
          iconName="DollarSign"
          description={kpis.discoveredAnnual > 0
            ? `waarvan ${formatCurrencyCompact(kpis.discoveredAnnual)} afgeleid uit spend, niet uit een contract`
            : "Total active contracts"}
        />
        <KPICard title="Auto-renewing" value={kpis.autoRenewing.toString()} changeType={kpis.autoRenewing > 0 ? "neutral" : "positive"} iconName="Clock" description="Watch the notice window" />
      </div>

      {/* Eerlijk over de herkomst: het register is voor een groot deel automatisch
          gevuld uit terugkerende leveranciersspend. Dat is bruikbaar (je mist geen
          leverancier meer) maar het zijn geen gecontroleerde contractvoorwaarden. */}
      {kpis.discoveredCount > 0 && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          <b>{kpis.discoveredCount} van de {kpis.activeCount} actieve lijnen zijn automatisch ontdekt</b> uit
          terugkerende leveranciersspend in Business Central, niet ingelezen uit een ondertekend contract.
          Bedragen, einddatums, opzegtermijnen en de vlag &quot;auto-verlengend&quot; zijn dus <b>aannames</b> tot
          iemand het document erbij legt. {kpis.withoutDocument > 0 && <>Bij {kpis.withoutDocument} lijnen hangt nog geen document. </>}
          Gebruik dit register om niets te missen en de opzegvensters in het oog te houden — niet als
          bron voor contractuele verplichtingen.
        </div>
      )}

      {contracts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center rounded-xl border border-border bg-card">
          <p className="text-foreground font-medium">No contracts tracked yet</p>
          <p className="text-muted-foreground text-sm mt-1 max-w-md">
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
