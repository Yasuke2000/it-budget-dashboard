import { getLicenses, getSoftwareLicenses } from "@/lib/data-source";
import { LicenseCard } from "@/components/licenses/license-card";
import { KPICard } from "@/components/dashboard/kpi-card";
import { Separator } from "@/components/ui/separator";
import { formatCurrency } from "@/lib/utils";

// Days until a renewal date (negative if past). Module-level so the date read
// isn't flagged as an impure call during render.
function daysUntil(dateStr?: string): number | null {
  if (!dateStr) return null;
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return null;
  return (t - Date.now()) / 86400000;
}

export default async function LicensesPage() {
  const [licenses, softwareLicenses] = await Promise.all([
    getLicenses(),
    getSoftwareLicenses(),
  ]);
  const otherAnnualCost = softwareLicenses.reduce((s, l) => s + l.annualCost, 0);

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
        <h1 className="text-2xl font-bold text-white">Software Licenses</h1>
        <p className="text-slate-400">Microsoft 365 utilization from your tenant, plus other tracked licenses</p>
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

      {/* Non-Microsoft / manually tracked licenses */}
      {softwareLicenses.length > 0 && (
        <>
          <Separator className="bg-slate-800" />
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-white">Other Software Licenses</h2>
                <span className="text-sm text-slate-500">
                  {softwareLicenses.length} product{softwareLicenses.length !== 1 ? "s" : ""}
                </span>
              </div>
              <span className="text-xs text-slate-500 font-mono tabular-nums">
                {formatCurrency(otherAnnualCost)}/yr
              </span>
            </div>
            <div className="rounded-xl border border-slate-800 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900 text-left text-xs text-slate-400">
                    <th className="px-4 py-2.5 font-medium">Vendor</th>
                    <th className="px-4 py-2.5 font-medium">Product</th>
                    <th className="px-4 py-2.5 font-medium">Type</th>
                    <th className="px-4 py-2.5 font-medium text-right">Seats</th>
                    <th className="px-4 py-2.5 font-medium text-right">Monthly</th>
                    <th className="px-4 py-2.5 font-medium text-right">Annual</th>
                    <th className="px-4 py-2.5 font-medium">Renewal</th>
                    <th className="px-4 py-2.5 font-medium">Category</th>
                  </tr>
                </thead>
                <tbody>
                  {softwareLicenses.map((l, i) => {
                    const daysToRenewal = daysUntil(l.renewalDate);
                    const renewalSoon = daysToRenewal !== null && daysToRenewal > 0 && daysToRenewal <= 90;
                    const overAllocated = l.seats > 0 && l.assignedSeats > l.seats;
                    return (
                      <tr key={l.id} className={`border-b border-slate-800/60 last:border-0 ${i % 2 ? "bg-slate-900/40" : "bg-slate-900"}`}>
                        <td className="px-4 py-2.5 text-slate-300">{l.vendor}</td>
                        <td className="px-4 py-2.5 text-slate-300">{l.product}</td>
                        <td className="px-4 py-2.5 text-slate-400 capitalize">{l.licenseType}</td>
                        <td className={`px-4 py-2.5 text-right font-mono tabular-nums ${overAllocated ? "text-amber-400" : "text-slate-300"}`}>
                          {l.assignedSeats}/{l.seats || "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-300">{formatCurrency(l.monthlyCost)}</td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-300">{formatCurrency(l.annualCost)}</td>
                        <td className={`px-4 py-2.5 ${renewalSoon ? "text-amber-400" : "text-slate-400"}`}>
                          {l.renewalDate || "—"}{renewalSoon ? " ⚠" : ""}
                        </td>
                        <td className="px-4 py-2.5 text-slate-400">{l.category}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-600">
              Imported via the Import page (&quot;Other Software Licenses&quot;). Renewals within 90 days are flagged.
            </p>
          </section>
        </>
      )}

      {licenses.length === 0 && softwareLicenses.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-slate-400 font-medium">No license data available</p>
          <p className="text-slate-600 text-sm mt-1">
            Sync your Microsoft 365 tenant, or import other licenses on the Import page.
          </p>
        </div>
      )}
    </div>
  );
}
