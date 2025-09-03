import { getLicenses } from "@/lib/data-source";
import { LicenseCard } from "@/components/licenses/license-card";
import { KPICard } from "@/components/dashboard/kpi-card";
import { Separator } from "@/components/ui/separator";
import { formatCurrency } from "@/lib/utils";

export default async function LicensesPage() {
  const licenses = await getLicenses();

  const paidLicenses = licenses.filter((l) => l.pricePerUser > 0);
  const freeLicenses = licenses.filter((l) => l.pricePerUser === 0);

  const totalMonthlyCost = paidLicenses.reduce((sum, l) => sum + l.monthlyCost, 0);
  const totalWaste = paidLicenses.reduce((sum, l) => sum + l.wastedCost, 0);

  const totalPrepaid = paidLicenses.reduce((sum, l) => sum + l.prepaidUnits, 0);
  const totalConsumed = paidLicenses.reduce((sum, l) => sum + l.consumedUnits, 0);
  const overallUtilization = totalPrepaid > 0 ? (totalConsumed / totalPrepaid) * 100 : 0;

  const utilizationChangeType =
    overallUtilization >= 90 ? "positive" : overallUtilization >= 70 ? "neutral" : "negative";
  const wasteChangeType = totalWaste === 0 ? "positive" : totalWaste < 500 ? "neutral" : "negative";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Microsoft 365 Licenses</h1>
        <p className="text-slate-400">License utilization and cost across your tenant</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KPICard
          title="Total Monthly Cost"
          value={formatCurrency(totalMonthlyCost)}
          iconName="DollarSign"
          description={`${paidLicenses.length} paid SKUs`}
          changeType="neutral"
        />
        <KPICard
          title="Monthly Waste"
          value={formatCurrency(totalWaste)}
          iconName="AlertTriangle"
          description="Unused paid licenses"
          changeType={wasteChangeType}
          change={
            totalWaste > 0
              ? `${paidLicenses.reduce((s, l) => s + l.wastedUnits, 0)} unused seats`
              : "No waste detected"
          }
        />
        <KPICard
          title="Overall Utilization"
          value={`${overallUtilization.toFixed(1)}%`}
          iconName="BarChart2"
          description={`${totalConsumed} / ${totalPrepaid} paid seats assigned`}
          changeType={utilizationChangeType}
        />
      </div>

      {paidLicenses.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-white">Paid Licenses</h2>
            <span className="text-sm text-slate-500">
              {paidLicenses.length} SKU{paidLicenses.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {paidLicenses.map((license) => (
              <LicenseCard key={license.skuId} license={license} />
            ))}
          </div>
        </section>
      )}

      {paidLicenses.length > 0 && freeLicenses.length > 0 && (
        <Separator className="bg-slate-800" />
      )}

      {freeLicenses.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-white">Free / Included Licenses</h2>
            <span className="text-sm text-slate-500">
              {freeLicenses.length} SKU{freeLicenses.length !== 1 ? "s" : ""}
            </span>
          </div>
          <p className="text-sm text-slate-500 -mt-2">
            These licenses are included at no extra cost — no waste tracking applies.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {freeLicenses.map((license) => (
              <LicenseCard key={license.skuId} license={license} />
            ))}
          </div>
        </section>
      )}

      {licenses.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-slate-400 font-medium">No license data available</p>
          <p className="text-slate-600 text-sm mt-1">
            Sync your Microsoft 365 tenant to see license information.
          </p>
        </div>
      )}
    </div>
  );
}
