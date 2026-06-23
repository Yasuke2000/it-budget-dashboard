import { PersonnelContent } from "@/components/personnel/personnel-content";
import { SampleDataBanner } from "@/components/ui/sample-data-banner";
import { getEmployees, getPersonnelKPIs, isDemoMode, sourceStatus } from "@/lib/data-source";

export const dynamic = "force-dynamic";

export default async function PersonnelPage() {
  const [allEmployees, kpis] = await Promise.all([
    getEmployees(),
    getPersonnelKPIs(),
  ]);

  const notConnected = !isDemoMode() && sourceStatus.employees === "empty";

  const employees = allEmployees.filter(
    (e) => e.status === "active" && e.department === "IT"
  );

  return (
    <div className="space-y-6">
      {notConnected && (
        <SampleDataBanner message="No HR data yet — Officient is not connected (awaiting API credentials). Headcount and personnel cost will populate once connected." />
      )}
      <PersonnelContent employees={employees} kpis={kpis} />
    </div>
  );
}
