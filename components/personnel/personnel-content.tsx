"use client";

import { useState } from "react";
import { GDPRToggle } from "./gdpr-toggle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KPICard } from "@/components/dashboard/kpi-card";
import { ITTeamTable } from "./it-team-table";
import { ProjectCostDonut } from "./project-cost-donut";
import { WorklogTable } from "./worklog-table";
import { formatCurrency } from "@/lib/utils";
import type { Employee, PersonnelKPIs, JiraProjectCost, JiraWorklog } from "@/lib/types";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface PersonnelContentProps {
  employees: Employee[];
  kpis: PersonnelKPIs;
  projectCosts: JiraProjectCost[];
  worklogs: JiraWorklog[];
}

function anonymizeEmployees(employees: Employee[]): Employee[] {
  return employees.map((emp, i) => ({
    ...emp,
    name: `Employee #${i + 1}`,
    email: "•••@example.com",
    monthlyCost: undefined,
  }));
}

function anonymizeWorklogs(worklogs: JiraWorklog[]): JiraWorklog[] {
  const authorMap = new Map<string, string>();
  let counter = 1;
  return worklogs.map((wl) => {
    if (!authorMap.has(wl.author)) {
      authorMap.set(wl.author, `Team Member #${counter++}`);
    }
    return {
      ...wl,
      author: authorMap.get(wl.author)!,
      totalCost: undefined,
      hourlyCost: undefined,
    };
  });
}

const COST_COLORS = ["#14b8a6", "#3b82f6", "#a855f7"];

interface CostTooltipPayloadEntry {
  value: number;
  payload?: { name?: string };
}

function CostTooltip({ active, payload, privacyMode }: { active?: boolean; payload?: CostTooltipPayloadEntry[]; privacyMode: boolean }) {
  if (!active || !payload || !payload.length) return null;
  const entry = payload[0];
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 text-xs shadow-xl">
      <p className="text-slate-300 mb-0.5 font-medium">{entry.payload?.name}</p>
      <p className="font-mono text-white">
        {privacyMode ? "•••" : formatCurrency(entry.value as number)}
      </p>
    </div>
  );
}

export function PersonnelContent({ employees, kpis, projectCosts, worklogs }: PersonnelContentProps) {
  const [privacyMode, setPrivacyMode] = useState(true);

  // employees prop is already filtered to active IT members (filtered in page.tsx)
  const displayEmployees = privacyMode ? anonymizeEmployees(employees) : employees;
  const displayWorklogs = privacyMode ? anonymizeWorklogs(worklogs) : worklogs;

  const totalLaborCost = projectCosts.reduce((sum, p) => sum + p.totalCost, 0);
  const totalLaborHours = projectCosts.reduce((sum, p) => sum + p.totalHours, 0);

  const costBreakdownData = [
    { name: "Internal Salaries", value: kpis.itSalaryCost, color: COST_COLORS[0] },
    { name: "External Services", value: kpis.externalServicesCost, color: COST_COLORS[1] },
    { name: "Tools & Licenses", value: kpis.toolsLicensesCost, color: COST_COLORS[2] },
  ];

  const annualITPersonnelCost = kpis.itSalaryCost * 12;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">IT Team</h1>
          <p className="text-slate-400">
            IT headcount, salary costs, and labor allocation — Officient HR &amp; Jira
          </p>
        </div>
        <GDPRToggle enabled={privacyMode} onChange={setPrivacyMode} />
      </div>

      {/* KPI Cards — IT-focused */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="IT Team Size"
          value={kpis.itHeadcount.toString()}
          iconName="Monitor"
          description="Active IT employees"
        />
        <KPICard
          title="Monthly IT Salary Cost"
          value={privacyMode ? "•••" : formatCurrency(kpis.itSalaryCost)}
          iconName="DollarSign"
          description={privacyMode ? "Enable full view to see costs" : "Sum of IT gross salaries"}
          changeType="neutral"
        />
        <KPICard
          title="Annual IT Personnel Cost"
          value={privacyMode ? "•••" : formatCurrency(annualITPersonnelCost)}
          iconName="TrendingUp"
          description={privacyMode ? "Hidden in privacy mode" : "Salary × 12 months"}
          changeType="neutral"
        />
        <KPICard
          title="IT Staff Ratio"
          value={`${kpis.itStaffRatio}%`}
          iconName="Percent"
          description={`${kpis.itHeadcount} of ${kpis.totalHeadcount} total employees`}
          changeType="neutral"
        />
      </div>

      {/* IT Cost Breakdown + IT Labor Cost by Project */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white">IT Cost Breakdown</CardTitle>
            <p className="text-sm text-slate-400">
              {privacyMode
                ? "Monthly cost categories — amounts hidden"
                : `${formatCurrency(kpis.itSalaryCost + kpis.externalServicesCost + kpis.toolsLicensesCost)} / month total`}
            </p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={costBreakdownData}
                margin={{ top: 4, right: 8, left: 8, bottom: 4 }}
                barCategoryGap="30%"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fill: "#94a3b8", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "#94a3b8", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) =>
                    privacyMode ? "•••" : `€${(v / 1000).toFixed(0)}k`
                  }
                  width={48}
                />
                <Tooltip content={<CostTooltip privacyMode={privacyMode} />} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {costBreakdownData.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            {/* Legend */}
            <div className="mt-3 flex flex-col gap-1.5">
              {costBreakdownData.map((item) => (
                <div key={item.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-sm"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="text-slate-400">{item.name}</span>
                  </div>
                  <span className="font-mono text-slate-300 tabular-nums">
                    {privacyMode ? "•••" : formatCurrency(item.value)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white">IT Labor Cost by Project</CardTitle>
            <p className="text-sm text-slate-400">
              {totalLaborHours}h logged · {privacyMode ? "•••" : formatCurrency(totalLaborCost)} total — YTD
            </p>
          </CardHeader>
          <CardContent>
            <ProjectCostDonut
              projectCosts={
                privacyMode
                  ? projectCosts.map((p) => ({ ...p, totalCost: 0 }))
                  : projectCosts
              }
            />
          </CardContent>
        </Card>
      </div>

      {/* IT Team Table */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white">IT Team</CardTitle>
          <p className="text-sm text-slate-400">
            {kpis.itHeadcount} active members{privacyMode ? "" : " · monthly cost overview"}
          </p>
        </CardHeader>
        <CardContent>
          <ITTeamTable employees={displayEmployees} />
        </CardContent>
      </Card>

      {/* Project Cost Summary Cards */}
      {!privacyMode && (
        <div>
          <h2 className="text-lg font-semibold text-white mb-4">Project Cost Summary</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {projectCosts.map((p) => (
              <Card key={p.projectKey} className="bg-slate-900 border-slate-800">
                <CardContent className="p-5">
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
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Recent Worklogs */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white">Recent Worklogs</CardTitle>
          <p className="text-sm text-slate-400">
            Latest {Math.min(worklogs.length, 20)} of {worklogs.length} entries — Jira time tracking
          </p>
        </CardHeader>
        <CardContent>
          <WorklogTable worklogs={displayWorklogs} />
        </CardContent>
      </Card>
    </div>
  );
}
