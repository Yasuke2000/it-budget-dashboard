import { PersonnelContent } from "@/components/personnel/personnel-content";
import { getEmployees, getPersonnelKPIs, getJiraProjectCosts, getJiraWorklogs } from "@/lib/data-source";

export default async function PersonnelPage() {
  const [allEmployees, kpis, projectCosts, worklogs] = await Promise.all([
    getEmployees(),
    getPersonnelKPIs(),
    getJiraProjectCosts(),
    getJiraWorklogs(),
  ]);

  // Pass only IT employees to the client component
  const employees = allEmployees.filter(
    (e) => e.status === "active" && e.department === "IT"
  );

  return (
    <PersonnelContent
      employees={employees}
      kpis={kpis}
      projectCosts={projectCosts}
      worklogs={worklogs}
    />
  );
}
