"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Sparkles, X, FileDown, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KPICard } from "@/components/dashboard/kpi-card";
import { SpendTrendChart } from "@/components/dashboard/spend-trend-chart";
import { EntityComparison } from "@/components/dashboard/entity-comparison";
import { TopVendors } from "@/components/dashboard/top-vendors";
import { CategoryBreakdown } from "@/components/dashboard/category-breakdown";
import { useDateRange } from "@/components/layout/date-range-context";
import { useCompany } from "@/components/layout/company-context";
import { formatCurrencyCompact, formatPercent } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardKPIs, MonthlySpend, EntitySpend, VendorSummary, CategorySpend } from "@/lib/types";

export function OverviewClient() {
  const { selectedRange } = useDateRange();
  const { selectedCompany } = useCompany();
  const [loading, setLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showSetupBanner, setShowSetupBanner] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return !localStorage.getItem("itdash_setup_complete");
    } catch {
      return false;
    }
  });
  const [data, setData] = useState<{
    kpis: DashboardKPIs;
    monthly: MonthlySpend[];
    entities: EntitySpend[];
    vendors: VendorSummary[];
    categories: CategorySpend[];
  } | null>(null);

  useEffect(() => {
    setLoading(true);
    let cancelled = false;
    const params = new URLSearchParams({
      company: selectedCompany,
      dateFrom: selectedRange.from,
      dateTo: selectedRange.to,
    });
    const controller = new AbortController();
    // 45s: a cold-cache first load fans out to many live BC/Graph calls across 11
    // companies and can exceed 20s; the result is then cached so refreshes are fast.
    const timer = setTimeout(() => controller.abort(), 45_000);
    const startedAt = Date.now();
    fetch(`/api/dashboard?${params}`, { signal: controller.signal, cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((d) => {
        clearTimeout(timer);
        if (cancelled) return;
        // Guard against an error payload that parses as a truthy object but
        // lacks the expected shape — otherwise the render would destructure
        // undefined and white-screen.
        if (d && d.kpis && Array.isArray(d.monthly)) {
          setData(d);
        } else {
          setErrorMsg("The server returned an unexpected response.");
        }
        setLoading(false);
      })
      .catch((err) => {
        clearTimeout(timer);
        if (cancelled) return;
        const secs = Math.round((Date.now() - startedAt) / 1000);
        setErrorMsg(
          err?.name === "AbortError"
            ? `Request timed out after ${secs}s — the dashboard API didn't respond.`
            : `Couldn't reach the dashboard API (${err?.message || "network error"}).`
        );
        setLoading(false);
      });
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [selectedCompany, selectedRange.from, selectedRange.to, retryCount]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Overview</h1>
          <p className="text-slate-400">Loading dashboard data…</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-28 bg-slate-800 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-[400px] bg-slate-800 rounded-xl" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-[300px] bg-slate-800 rounded-xl" />
          <Skeleton className="h-[300px] bg-slate-800 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-white">Overview</h1>
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-4 flex items-center gap-4">
          <p className="text-sm text-red-300 flex-1">
            {errorMsg ?? "Dashboard data could not be loaded. The API may be temporarily unavailable."}
          </p>
          <Button
            size="sm"
            variant="ghost"
            className="text-red-400 hover:text-red-300 shrink-0"
            onClick={() => setRetryCount((c) => c + 1)}
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const { kpis, monthly, entities, vendors, categories } = data;
  const spendSparkline = monthly.slice(-6).map((m) => m.actual);

  return (
    <div className="space-y-6">
      {/* Setup banner */}
      {showSetupBanner && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-teal-500/30 bg-teal-500/10 px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <Sparkles className="h-4 w-4 text-teal-400 shrink-0" />
            <p className="text-sm text-teal-300">
              <span className="font-semibold">Welcome!</span> Set up your data sources to get started.{" "}
              <Link href="/setup" className="underline underline-offset-2 hover:text-white transition-colors">
                Run setup wizard
              </Link>
            </p>
          </div>
          <button
            onClick={() => {
              setShowSetupBanner(false);
              try { localStorage.setItem("itdash_setup_complete", "1"); } catch { /* ignore */ }
            }}
            className="text-teal-500 hover:text-teal-300 transition-colors shrink-0"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Overview</h1>
          <p className="text-slate-400">
            IT spend across all entities — {selectedRange.label}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-teal-400 hover:text-teal-300 hover:bg-teal-500/10 gap-2"
          onClick={async () => {
            const qs = `company=${selectedCompany}&dateFrom=${selectedRange.from}&dateTo=${selectedRange.to}`;
            const res = await fetch(`/api/report?${qs}`);
            const reportData = await res.json();
            const { generateExecutiveReport } = await import("@/lib/pdf-report");
            const doc = generateExecutiveReport(reportData);
            doc.save(`IT-Finance-Report-${new Date().toISOString().split("T")[0]}.pdf`);
          }}
        >
          <FileDown className="h-4 w-4" />
          PDF Report
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-slate-400 hover:text-slate-300 hover:bg-slate-500/10 gap-2"
          onClick={() => {
            window.open(`/api/export?company=${selectedCompany}&dateFrom=${selectedRange.from}&dateTo=${selectedRange.to}`, "_blank");
          }}
        >
          <Share2 className="h-4 w-4" />
          Export
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <KPICard
          title="Total IT Spend"
          value={formatCurrencyCompact(kpis.totalSpendYTD)}
          change={formatPercent(kpis.spendChangePercent)}
          changeType={kpis.spendTrend === "up" ? "negative" : kpis.spendTrend === "down" ? "positive" : "neutral"}
          iconName="DollarSign"
          description={`${selectedRange.label} · booked, ex-VAT`}
          sparklineData={spendSparkline}
        />
        <KPICard
          title={kpis.annualisedSpendTTM > 0 ? "Annualised IT Spend" : "Projected Full Year"}
          value={formatCurrencyCompact(kpis.annualisedSpendTTM > 0 ? kpis.annualisedSpendTTM : kpis.projectedAnnualSpend)}
          iconName="TrendingUp"
          changeType="neutral"
          description={kpis.annualisedSpendTTM > 0 ? "Trailing 12 months (actual)" : `Run-rate · ${kpis.projectionMonths} complete mo`}
        />
        <KPICard
          title="IT Spend % of Revenue"
          value={kpis.itSpendPercentOfRevenue > 0 ? `${kpis.itSpendPercentOfRevenue.toFixed(2)}%` : "—"}
          changeType="neutral"
          iconName="Percent"
          description={`vs ~${kpis.revenueBenchmarkPercent}% transport median${kpis.revenueIsConsolidated ? "" : " · gross rev."}`}
        />
        <KPICard
          title="IT Asset Depreciation"
          value={formatCurrencyCompact(kpis.itDepreciationYTD)}
          changeType="neutral"
          iconName="BarChart2"
          description="Separate from spend — write-down of IT assets"
        />
        <KPICard
          title="License Utilization"
          value={`${kpis.licenseUtilizationPercent.toFixed(1)}%`}
          changeType={kpis.licenseUtilizationPercent >= 90 ? "positive" : kpis.licenseUtilizationPercent >= 70 ? "neutral" : "negative"}
          iconName="Key"
          description={kpis.licenseActiveUsagePercent != null ? `assigned · ${kpis.licenseActiveUsagePercent.toFixed(0)}% active 30d` : "Paid licenses (assigned)"}
        />
        <KPICard
          title="Managed Devices"
          value={kpis.deviceCount.toString()}
          iconName="Monitor"
          description="Enrolled in Intune"
        />
      </div>

      {/* Spend Trend */}
      <SpendTrendChart data={monthly} />

      {/* Category breakdown — full width (rows drill into filtered invoices) */}
      <CategoryBreakdown data={categories} company={selectedCompany} from={selectedRange.from} to={selectedRange.to} />

      {/* Entity comparison + Top vendors */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <EntityComparison data={entities} />
        <TopVendors vendors={vendors} />
      </div>
    </div>
  );
}
