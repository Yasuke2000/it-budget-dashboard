import { KPICard } from "@/components/dashboard/kpi-card";
import { VendorList } from "@/components/vendors/vendor-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getVendorSummary, getInvoices, isDemoMode } from "@/lib/data-source";
import { formatCurrencyCompact } from "@/lib/utils";
import { VendorSpendChart } from "@/components/vendors/vendor-spend-chart";

export const dynamic = "force-dynamic";

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const company = sp.company || "all";
  const currentYear = new Date().getFullYear();
  const [vendors, invoices] = await Promise.all([
    getVendorSummary(company, sp.from, sp.to),
    getInvoices(company, sp.from, sp.to),
  ]);
  const live = !isDemoMode();

  const totalVendors = vendors.length;
  const highestConcentration = vendors[0]?.percentOfTotal ?? 0;
  const totalSpend = vendors.reduce((s, v) => s + v.totalSpend, 0);
  const riskCount = vendors.filter((v) => v.concentrationLevel === "risk").length;
  const watchCount = vendors.filter((v) => v.concentrationLevel === "watch").length;

  // Herfindahl-Hirschman Index (Σ share²) + 5-firm concentration ratio, as
  // distribution-shape indicators (NOT a pass/fail — DOJ bands assume competitive
  // markets; a small healthy vendor mix can legitimately read "concentrated").
  const hhi = Math.round(vendors.reduce((s, v) => s + v.percentOfTotal ** 2, 0));
  const cr5 = vendors.slice(0, 5).reduce((s, v) => s + v.percentOfTotal, 0);
  const hhiBand = hhi > 2500 ? "Concentrated" : hhi >= 1500 ? "Moderate" : "Diversified";

  const top10 = vendors.slice(0, 10);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Vendors</h1>
        <p className="text-slate-400">
          {live
            ? `IT spend by cost driver and concentration risk — ${currentYear}`
            : `Vendor spend analysis and concentration risk — FY ${currentYear}`}
        </p>
        {live && (
          <p className="text-xs text-slate-600 mt-1">
            Real vendor names from posted Business Central purchase invoices, limited to IT spend.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total Vendors"
          value={totalVendors.toString()}
          iconName="Building2"
          description={riskCount > 0 ? `${riskCount} over 30% · ${watchCount} on watch` : watchCount > 0 ? `${watchCount} on watch (25–30%)` : "No concentration risk"}
          changeType={riskCount > 0 ? "negative" : watchCount > 0 ? "neutral" : "positive"}
        />
        <KPICard
          title="Highest Concentration"
          value={`${highestConcentration.toFixed(1)}%`}
          iconName="AlertTriangle"
          changeType={highestConcentration > 30 ? "negative" : highestConcentration >= 25 ? "neutral" : "positive"}
          description={vendors[0]?.vendorName ?? "—"}
          change={highestConcentration > 30 ? "Above 30% — risk" : highestConcentration >= 25 ? "25–30% — watch" : "Within range"}
        />
        <KPICard
          title="Portfolio Concentration"
          value={`HHI ${hhi.toLocaleString()}`}
          iconName="BarChart2"
          changeType="neutral"
          description={`${hhiBand} · top-5 = ${cr5.toFixed(0)}% (trend, not pass/fail)`}
        />
        <KPICard
          title="Total IT Spend"
          value={formatCurrencyCompact(totalSpend)}
          iconName="DollarSign"
          description="Across all vendors YTD"
          changeType="neutral"
        />
      </div>

      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white">Top 10 Vendors by Spend</CardTitle>
        </CardHeader>
        <CardContent>
          <VendorSpendChart vendors={top10} />
        </CardContent>
      </Card>

      <div>
        <h2 className="text-lg font-semibold text-white mb-4">All Vendors — Ranked by Spend</h2>
        <VendorList vendors={vendors} invoices={invoices} />
      </div>
    </div>
  );
}
