import { KPICard } from "@/components/dashboard/kpi-card";
import { VendorList } from "@/components/vendors/vendor-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getVendorSummary, getInvoices } from "@/lib/data-source";
import { formatCurrencyCompact } from "@/lib/utils";
import { VendorSpendChart } from "@/components/vendors/vendor-spend-chart";

export default async function VendorsPage() {
  const [vendors, invoices] = await Promise.all([
    getVendorSummary(),
    getInvoices(),
  ]);

  const totalVendors = vendors.length;
  const highestConcentration = vendors[0]?.percentOfTotal ?? 0;
  const totalSpend = vendors.reduce((s, v) => s + v.totalSpend, 0);
  const concentrationRiskCount = vendors.filter((v) => v.isConcentrationRisk).length;

  const top10 = vendors.slice(0, 10);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Vendors</h1>
        <p className="text-slate-400">Vendor spend analysis and concentration risk — FY 2025</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KPICard
          title="Total Vendors"
          value={totalVendors.toString()}
          iconName="Building2"
          description={`${concentrationRiskCount} with concentration risk`}
          changeType={concentrationRiskCount > 0 ? "negative" : "positive"}
          change={concentrationRiskCount > 0 ? `${concentrationRiskCount} vendor${concentrationRiskCount > 1 ? "s" : ""} >30% share` : "No concentration risk"}
        />
        <KPICard
          title="Highest Concentration"
          value={`${highestConcentration.toFixed(1)}%`}
          iconName="AlertTriangle"
          changeType={highestConcentration > 30 ? "negative" : highestConcentration > 20 ? "neutral" : "positive"}
          description={vendors[0]?.vendorName ?? "—"}
          change={highestConcentration > 30 ? "Above 30% threshold" : "Within acceptable range"}
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
