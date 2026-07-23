import { KPICard } from "@/components/dashboard/kpi-card";
import { DeviceTable } from "@/components/devices/device-table";
import { AgeChart } from "@/components/devices/age-chart";
import { ComplianceDonut } from "@/components/devices/compliance-donut";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SampleDataBanner } from "@/components/ui/sample-data-banner";
import { PageHeader } from "@/components/layout/page-header";
import { getDevices, isDemoMode, sourceStatus } from "@/lib/data-source";

export const dynamic = "force-dynamic";

export default async function DevicesPage() {
  const devices = await getDevices();
  const notConnected = !isDemoMode() && sourceStatus.devices === "empty";

  const total = devices.length;
  const compliant = devices.filter((d) => d.complianceState === "compliant").length;
  const noncompliant = devices.filter((d) => d.complianceState === "noncompliant").length;
  const unknown = devices.filter((d) => d.complianceState === "unknown").length;
  const compliancePct = total > 0 ? (compliant / total) * 100 : 0;

  const aged = devices.filter((d) => d.ageYears > 4).length;
  const avgAge = total > 0 ? devices.reduce((s, d) => s + d.ageYears, 0) / total : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Devices"
        description="Managed device inventory, compliance, and lifecycle — Intune"
      />

      {notConnected && (
        <SampleDataBanner message="No device data yet — Intune access needs the DeviceManagementManagedDevices.Read.All permission as an APPLICATION permission (it is currently Delegated, which app-only sign-in can't use). Once granted, your real fleet appears here." />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total Devices"
          value={total.toString()}
          iconName="Monitor"
          description="Enrolled in Intune"
        />
        <KPICard
          title="Compliant"
          value={`${compliancePct.toFixed(1)}%`}
          iconName="ShieldCheck"
          change={`${compliant} of ${total} devices`}
          changeType={
            compliancePct >= 90 ? "positive" : compliancePct >= 70 ? "neutral" : "negative"
          }
          description={`${noncompliant} non-compliant · ${unknown} unknown`}
        />
        <KPICard
          title="Average Age"
          value={`${avgAge.toFixed(1)} yrs`}
          iconName="Clock"
          changeType={avgAge > 4 ? "negative" : avgAge > 3 ? "neutral" : "positive"}
          change={avgAge > 4 ? "Above lifecycle threshold" : "Within lifecycle target"}
          description="Target: under 4 years"
        />
        <KPICard
          title="Replacement Needed"
          value={aged.toString()}
          iconName="AlertTriangle"
          changeType={aged > 0 ? "negative" : "positive"}
          change={aged > 0 ? `${aged} device${aged > 1 ? "s" : ""} older than 4 years` : "No devices need replacement"}
          description=">4 year lifecycle alert"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">Compliance Status</CardTitle>
          </CardHeader>
          <CardContent>
            <ComplianceDonut
              compliant={compliant}
              noncompliant={noncompliant}
              unknown={unknown}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">Age Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <AgeChart devices={devices} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Device Inventory</CardTitle>
        </CardHeader>
        <CardContent>
          <DeviceTable devices={devices} />
        </CardContent>
      </Card>
    </div>
  );
}
