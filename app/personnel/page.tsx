import { PersonnelContent } from "@/components/personnel/personnel-content";
import { getEmployees, getPersonnelKPIs } from "@/lib/data-source";

export default async function PersonnelPage() {
  const [allEmployees, kpis] = await Promise.all([
    getEmployees(),
    getPersonnelKPIs(),
  ]);

  const employees = allEmployees.filter(
    (e) => e.status === "active" && e.department === "IT"
  );

  return (
    <PersonnelContent
      employees={employees}
      kpis={kpis}
    />
  );
}
