import { getLicenses, getSoftwareLicenses, isDemoMode, sourceStatus } from "@/lib/data-source";
import { LicenseCard } from "@/components/licenses/license-card";
import { KPICard } from "@/components/dashboard/kpi-card";
import { Separator } from "@/components/ui/separator";
import { SampleDataBanner } from "@/components/ui/sample-data-banner";
import { PageHeader } from "@/components/layout/page-header";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

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
  const notConnected = !isDemoMode() && sourceStatus.licenses === "empty";
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
      <PageHeader title="Software Licenses" description="Microsoft 365 utilization from your tenant, plus other tracked licenses" />

      {notConnected && (
        <SampleDataBanner message="No Microsoft 365 license data yet — this needs the Organization.Read.All permission as an APPLICATION permission (it is currently Delegated, which app-only sign-in can't use). Other tracked licenses below are still your imported data." />
      )}

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
            <h2 className="text-lg font-semibold text-foreground">Paid Licenses</h2>
            <span className="text-sm text-muted-foreground">
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
        <Separator />
      )}

      {freeLicenses.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-foreground">Free / Included Licenses</h2>
            <span className="text-sm text-muted-foreground">
              {freeLicenses.length} SKU{freeLicenses.length !== 1 ? "s" : ""}
            </span>
          </div>
          <p className="text-sm text-muted-foreground -mt-2">
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
          <Separator />
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-foreground">Other Software Licenses</h2>
                <span className="text-sm text-muted-foreground">
                  {softwareLicenses.length} product{softwareLicenses.length !== 1 ? "s" : ""}
                </span>
              </div>
              <span className="text-xs text-muted-foreground font-mono tabular-nums">
                {formatCurrency(otherAnnualCost)}/yr
              </span>
            </div>
            <div className="rounded-xl border border-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-card text-left text-xs text-muted-foreground">
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
                      <tr key={l.id} className={`border-b border-border last:border-0 ${i % 2 ? "bg-card/40" : "bg-card"}`}>
                        <td className="px-4 py-2.5 text-foreground">{l.vendor}</td>
                        <td className="px-4 py-2.5 text-foreground">{l.product}</td>
                        <td className="px-4 py-2.5 text-muted-foreground capitalize">{l.licenseType}</td>
                        <td className={`px-4 py-2.5 text-right font-mono tabular-nums ${overAllocated ? "text-warning" : "text-foreground"}`}>
                          {l.assignedSeats}/{l.seats || "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-foreground">{formatCurrency(l.monthlyCost)}</td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-foreground">{formatCurrency(l.annualCost)}</td>
                        <td className={`px-4 py-2.5 ${renewalSoon ? "text-warning" : "text-muted-foreground"}`}>
                          {l.renewalDate || "—"}{renewalSoon ? " ⚠" : ""}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">{l.category}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground/70">
              Imported via the Import page (&quot;Other Software Licenses&quot;). Renewals within 90 days are flagged.
            </p>
          </section>
        </>
      )}

      {licenses.length === 0 && softwareLicenses.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-muted-foreground font-medium">No license data available</p>
          <p className="text-muted-foreground/70 text-sm mt-1">
            Sync your Microsoft 365 tenant, or import other licenses on the Import page.
          </p>
        </div>
      )}
    </div>
  );
}
