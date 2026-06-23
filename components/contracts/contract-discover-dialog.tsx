"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Check, Sparkles } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface Suggestion {
  vendor: string;
  annualCost: number;
  monthsActive: number;
  billingCycle: string;
  category: string;
  itCategory: string;
}

interface ContractDiscoverDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}

export function ContractDiscoverDialog({ open, onOpenChange, onAdded }: ContractDiscoverDialogProps) {
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setAdded(new Set());
    fetch("/api/contracts/discover")
      .then((r) => r.json())
      .then((d) => setSuggestions(d.suggestions || []))
      .catch(() => setSuggestions([]))
      .finally(() => setLoading(false));
  }, [open]);

  async function add(s: Suggestion) {
    setBusy(s.vendor);
    try {
      const res = await fetch("/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendor: s.vendor,
          description: `${s.itCategory} — auto-discovered from spend (${s.monthsActive} months active)`,
          category: s.category,
          billingCycle: s.billingCycle,
          annualCost: s.annualCost,
          tags: ["auto-discovered"],
        }),
      });
      if (res.ok) {
        setAdded((prev) => new Set(prev).add(s.vendor));
        onAdded();
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto bg-slate-950 border-slate-800">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-teal-400" /> Discover contracts from spend
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            IT vendors billing across 4+ months in the last year — almost certainly recurring contracts.
            Add the ones you want to track, then fill in renewal dates and documents.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-400 gap-2">
            <Loader2 className="h-5 w-5 animate-spin" /> Analysing 12 months of spend…
          </div>
        ) : suggestions.length === 0 ? (
          <p className="text-slate-500 text-center py-10 text-sm">No new recurring IT vendors found (all already tracked, or no live spend).</p>
        ) : (
          <div className="space-y-2 py-2">
            {suggestions.map((s) => {
              const isAdded = added.has(s.vendor);
              return (
                <div key={s.vendor} className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white font-medium truncate">{s.vendor}</p>
                    <p className="text-xs text-slate-500">
                      {s.itCategory} · {s.monthsActive} months · {s.billingCycle}
                    </p>
                  </div>
                  <span className="text-sm font-mono tabular-nums text-slate-300 shrink-0">{formatCurrency(s.annualCost)}/yr</span>
                  {isAdded ? (
                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 gap-1 shrink-0">
                      <Check className="h-3 w-3" /> Added
                    </Badge>
                  ) : (
                    <Button size="sm" variant="outline" className="shrink-0 gap-1" disabled={busy === s.vendor} onClick={() => add(s)}>
                      {busy === s.vendor ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                      Add
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="flex justify-end pt-2 border-t border-slate-800">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
