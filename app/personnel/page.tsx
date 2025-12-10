import { KPICard } from "@/components/dashboard/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DepartmentChart } from "@/components/personnel/department-chart";
import { ITTeamTable } from "@/components/personnel/it-team-table";
import { ProjectCostDonut } from "@/components/personnel/project-cost-donut";
import { WorklogTable } from "@/components/personnel/worklog-table";
import { getEmployees, getPersonnelKPIs, getJiraProjectCosts, getJiraWorklogs } from "@/lib/data-source";
import { formatCurrency } from "@/lib/utils";

export default async function PersonnelPage() {
  const [employees, kpis, projectCosts, worklogs] = await Promise.all([
    getEmployees(),
    getPersonnelKPIs(),
    getJiraProjectCosts(),
    getJiraWorklogs(),
  ]);

  const totalLaborCost = projectCosts.reduce((sum, p) => sum + p.totalCost, 0);
  const totalLaborHours = projectCosts.reduce((sum, p) => sum + p.totalHours, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Personnel</h1>
        <p className="text-slate-400">
          Headcount, IT team costs, and labor allocation — Officient HR &amp; Jira
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total Headcount"
          value={kpis.totalHeadcount.toString()}
          iconName="Users"
          description="Active employees"
        />
        <KPICard
          title="IT Team Size"
          value={kpis.itHeadcount.toString()}
          iconName="Monitor"
          description={`${kpis.departments.length} departments total`}
          changeType="neutral"
        />
        <KPICard
          title="Avg IT Cost / Employee"
          value={formatCurrency(kpis.avgITCostPerEmployee)}
          iconName="DollarSign"
          description="Monthly gross cost"
          changeType="neutral"
        />
        <KPICard
          title="Total IT Personnel Cost"
          value={formatCurrency(kpis.totalPersonnelCost)}
          iconName="TrendingUp"
          description={`${formatCurrency(kpis.totalPersonnelCost * 12)} / year`}
          changeType="neutral"
        />
      </div>

      {/* Department Breakdown + IT Labor Cost */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white">Headcount by Department</CardTitle>
          </CardHeader>
          <CardContent>
            <DepartmentChart departments={kpis.departments} />
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white">IT Labor Cost by Project</CardTitle>
            <p className="text-sm text-slate-400">
              {totalLaborHours}h logged · {formatCurrency(totalLaborCost)} total — YTD
            </p>
          </CardHeader>
          <CardContent>
            <ProjectCostDonut projectCosts={projectCosts} />
          </CardContent>
        </Card>
      </div>

      {/* IT Team Table */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white">IT Team</CardTitle>
          <p className="text-sm text-slate-400">
            {kpis.itHeadcount} active members · monthly cost overview
          </p>
        </CardHeader>
        <CardContent>
          <ITTeamTable employees={employees} />
        </CardContent>
      </Card>

      {/* Project Cost Summary Cards */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-4">Project Cost Summary</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {projectCosts.map((p) => (
            <Card key={p.projectKey} className="bg-slate-900 border-slate-800">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <p className="text-xs font-mono font-semibold text-teal-400 uppercase tracking-wider">
                      {p.projectKey}
                    </p>
                    <p className="text-sm font-medium text-white">{p.projectName}</p>
                    <p className="text-xl font-bold font-mono text-white tabular-nums">
                      {formatCurrency(p.totalCost)}
                    </p>
                    <p className="text-xs text-slate-500">
                      {p.totalHours}h · {p.contributors} contributor{p.contributors !== 1 ? "s" : ""}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Recent Worklogs */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white">Recent Worklogs</CardTitle>
          <p className="text-sm text-slate-400">
            Latest {Math.min(worklogs.length, 20)} of {worklogs.length} entries — Jira time tracking
          </p>
        </CardHeader>
        <CardContent>
          <WorklogTable worklogs={worklogs} />
        </CardContent>
      </Card>
    </div>
  );
}
