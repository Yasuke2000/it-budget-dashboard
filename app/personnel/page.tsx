import { PersonnelContent } from "@/components/personnel/personnel-content";
import { getEmployees, getPersonnelKPIs, getJiraProjectCosts, getJiraWorklogs } from "@/lib/data-source";

export default async function PersonnelPage() {
  const [employees, kpis, projectCosts, worklogs] = await Promise.all([
    getEmployees(),
    getPersonnelKPIs(),
    getJiraProjectCosts(),
    getJiraWorklogs(),
  ]);

  return (
    <PersonnelContent
      employees={employees}
      kpis={kpis}
      projectCosts={projectCosts}
      worklogs={worklogs}
    />
  );
}
