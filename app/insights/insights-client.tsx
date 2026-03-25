"use client";

import { useState, useMemo } from "react";
import type { CostInsight } from "@/lib/cost-insights";
import { cn } from "@/lib/utils";

// ── helpers ──────────────────────────────────────────────────────────────────

function formatEur(amount: number): string {
  return new Intl.NumberFormat("en-BE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(amount);
}

// ── Severity badge ────────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: CostInsight["severity"] }) {
  const cfg = {
    critical: {
      label: "Critical",
      cls: "bg-red-500/15 text-red-400 border-red-500/30",
      dot: "bg-red-400",
    },
    warning: {
      label: "Warning",
      cls: "bg-amber-500/15 text-amber-400 border-amber-500/30",
      dot: "bg-amber-400",
    },
    info: {
      label: "Info",
      cls: "bg-blue-500/15 text-blue-400 border-blue-500/30",
      dot: "bg-blue-400",
    },
  };
  const { label, cls, dot } = cfg[severity];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        cls
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
      {label}
    </span>
  );
}

// ── Category badge ────────────────────────────────────────────────────────────

function CategoryBadge({
  category,
  label,
}: {
  category: CostInsight["category"];
  label: string;
}) {
  const colorMap: Record<CostInsight["category"], string> = {
    license_waste: "bg-purple-500/15 text-purple-400 border-purple-500/30",
    vendor_risk: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    hardware_lifecycle: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
    budget_overrun: "bg-red-500/15 text-red-400 border-red-500/30",
    optimization: "bg-teal-500/15 text-teal-400 border-teal-500/30",
    shadow_it: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    duplicate_cost: "bg-pink-500/15 text-pink-400 border-pink-500/30",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        colorMap[category]
      )}
    >
      {label}
    </span>
  );
}

// ── Insight card ──────────────────────────────────────────────────────────────

function InsightCard({
  insight,
  categoryLabel,
}: {
  insight: CostInsight;
  categoryLabel: string;
}) {
  const leftBorder = {
    critical: "border-l-red-500",
    warning: "border-l-amber-500",
    info: "border-l-blue-500",
  }[insight.severity];

  return (
    <div
      className={cn(
        "rounded-xl border border-slate-800 bg-slate-900 p-5 border-l-2",
        leftBorder
      )}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <SeverityBadge severity={insight.severity} />
          <CategoryBadge category={insight.category} label={categoryLabel} />
        </div>
        {insight.potentialSavings > 0 && (
          <span className="shrink-0 text-sm font-semibold font-mono text-emerald-400">
            {formatEur(insight.potentialSavings)}/yr
          </span>
        )}
      </div>

      {/* Title */}
      <h3 className="text-sm font-semibold text-white mb-2 leading-snug">
        {insight.title}
      </h3>

      {/* Description */}
      <p className="text-sm text-slate-400 leading-relaxed mb-4">
        {insight.description}
      </p>

      {/* Action recommendation */}
      <div className="rounded-lg border border-teal-500/20 bg-teal-500/5 px-4 py-3 mb-3">
        <p className="text-xs font-semibold text-teal-400 mb-1 uppercase tracking-wide">
          Recommended action
        </p>
        <p className="text-sm text-slate-300 leading-relaxed">{insight.action}</p>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <span className="text-xs text-slate-600 font-mono">
          Source: {insight.dataSource}
        </span>
        <span className="text-xs text-slate-600">
          Detected {insight.detectedAt}
        </span>
      </div>
    </div>
  );
}

// ── Filter pill ───────────────────────────────────────────────────────────────

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-teal-500/50 bg-teal-500/15 text-teal-400"
          : "border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-600 hover:text-slate-300"
      )}
    >
      {children}
    </button>
  );
}

// ── Main client component ─────────────────────────────────────────────────────

interface InsightsClientProps {
  insights: CostInsight[];
  categoryLabels: Record<CostInsight["category"], string>;
}

export function InsightsClient({ insights, categoryLabels }: InsightsClientProps) {
  const [severityFilter, setSeverityFilter] = useState<CostInsight["severity"] | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<CostInsight["category"] | "all">("all");

  // Derive unique categories present in the data
  const presentCategories = useMemo(
    () => [...new Set(insights.map(i => i.category))],
    [insights]
  );

  const filtered = useMemo(
    () =>
      insights.filter(i => {
        if (severityFilter !== "all" && i.severity !== severityFilter) return false;
        if (categoryFilter !== "all" && i.category !== categoryFilter) return false;
        return true;
      }),
    [insights, severityFilter, categoryFilter]
  );

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <div className="space-y-3">
          {/* Severity filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-500 font-medium w-16 shrink-0">Severity</span>
            <FilterPill active={severityFilter === "all"} onClick={() => setSeverityFilter("all")}>
              All ({insights.length})
            </FilterPill>
            {(["critical", "warning", "info"] as const).map(s => {
              const count = insights.filter(i => i.severity === s).length;
              if (count === 0) return null;
              return (
                <FilterPill
                  key={s}
                  active={severityFilter === s}
                  onClick={() => setSeverityFilter(s)}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)} ({count})
                </FilterPill>
              );
            })}
          </div>

          {/* Category filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-500 font-medium w-16 shrink-0">Category</span>
            <FilterPill active={categoryFilter === "all"} onClick={() => setCategoryFilter("all")}>
              All
            </FilterPill>
            {presentCategories.map(cat => (
              <FilterPill
                key={cat}
                active={categoryFilter === cat}
                onClick={() => setCategoryFilter(cat)}
              >
                {categoryLabels[cat]}
              </FilterPill>
            ))}
          </div>
        </div>
      </div>

      {/* Result count */}
      <p className="text-xs text-slate-500">
        Showing {filtered.length} of {insights.length} insights
      </p>

      {/* Insight cards */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900 py-12 text-center">
          <p className="text-slate-500 text-sm">No insights match the selected filters.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map(insight => (
            <InsightCard
              key={insight.id}
              insight={insight}
              categoryLabel={categoryLabels[insight.category]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
