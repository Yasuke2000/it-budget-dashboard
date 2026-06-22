import { PersonnelContent } from "@/components/personnel/personnel-content";
import { SampleDataBanner } from "@/components/ui/sample-data-banner";
import { getEmployees, getPersonnelKPIs, isDemoMode, sourceStatus } from "@/lib/data-source";

export const dynamic = "force-dynamic";

export default async function PersonnelPage() {
  const [allEmployees, kpis] = await Promise.all([
    getEmployees(),
    getPersonnelKPIs(),
  ]);

  const isSample = !isDemoMode() && sourceStatus.employees === "demo";

  const employees = allEmployees.filter(
    (e) => e.status === "active" && e.department === "IT"
  );

  return (
    <div className="space-y-6">
      {isSample && (
        <SampleDataBanner message="Showing sample employees — live HR data from Officient is not connected yet (credentials pending). Headcount and cost figures are illustrative." />
      )}
      <PersonnelContent employees={employees} kpis={kpis} />
    </div>
  );
}
