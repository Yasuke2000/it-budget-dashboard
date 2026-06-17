"use client";

import { useState } from "react";
import { GDPRToggle } from "./gdpr-toggle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KPICard } from "@/components/dashboard/kpi-card";
import { ITTeamTable } from "./it-team-table";
import { formatCurrency } from "@/lib/utils";
import type { Employee, PersonnelKPIs } from "@/lib/types";
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
}

function anonymizeEmployees(employees: Employee[]): Employee[] {
  return employees.map((emp, i) => ({
    ...emp,
    name: `Employee #${i + 1}`,
    email: "•••@example.com",
    monthlyCost: undefined,
  }));
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

export function PersonnelContent({ employees, kpis }: PersonnelContentProps) {
  const [privacyMode, setPrivacyMode] = useState(true);

  const displayEmployees = privacyMode ? anonymizeEmployees(employees) : employees;

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
            IT headcount, salary costs, and labor allocation — Officient HR
          </p>
        </div>
        <GDPRToggle enabled={privacyMode} onChange={setPrivacyMode} />
      </div>

      {/* KPI Cards */}
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

      {/* IT Cost Breakdown */}
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
    </div>
  );
}
