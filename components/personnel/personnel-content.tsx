"use client";

import { useState } from "react";
import { GDPRToggle } from "./gdpr-toggle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KPICard } from "@/components/dashboard/kpi-card";
import { PageHeader } from "@/components/layout/page-header";
import { ITTeamTable } from "./it-team-table";
import { formatCurrency } from "@/lib/utils";
import { useChartPalette } from "@/lib/chart-theme";
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

interface CostTooltipPayloadEntry {
  value: number;
  payload?: { name?: string };
}

function CostTooltip({ active, payload, privacyMode }: { active?: boolean; payload?: CostTooltipPayloadEntry[]; privacyMode: boolean }) {
  if (!active || !payload || !payload.length) return null;
  const entry = payload[0];
  return (
    <div className="rounded-lg border border-border bg-popover/95 p-3 text-xs shadow-xl backdrop-blur-sm">
      <p className="text-muted-foreground mb-0.5 font-medium">{entry.payload?.name}</p>
      <p className="font-mono text-foreground">
        {privacyMode ? "•••" : formatCurrency(entry.value as number)}
      </p>
    </div>
  );
}

export function PersonnelContent({ employees, kpis }: PersonnelContentProps) {
  const [privacyMode, setPrivacyMode] = useState(true);
  const p = useChartPalette();
  const COST_COLORS = [p.categorical[0], p.categorical[1], p.categorical[4]];

  const displayEmployees = privacyMode ? anonymizeEmployees(employees) : employees;

  const costBreakdownData = [
    { name: "Internal Salaries", value: kpis.itSalaryCost, color: COST_COLORS[0] },
    { name: "External Services", value: kpis.externalServicesCost, color: COST_COLORS[1] },
    { name: "Tools & Licenses", value: kpis.toolsLicensesCost, color: COST_COLORS[2] },
  ];

  const annualITPersonnelCost = kpis.itSalaryCost * 12;

  return (
    <div className="space-y-6">
      <PageHeader
        title="IT Team"
        description="Roster & per-person employer cost from Officient HR"
        actions={<GDPRToggle enabled={privacyMode} onChange={setPrivacyMode} />}
      />

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
          description={privacyMode ? "Enable full view to see costs" : "Employer cost, full-time staff (excl. students)"}
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
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">IT Cost Breakdown</CardTitle>
          <p className="text-sm text-muted-foreground">
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
              <CartesianGrid stroke={p.grid} vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fill: p.text, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: p.textMuted, fontSize: 11 }}
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
                  <span className="text-muted-foreground">{item.name}</span>
                </div>
                <span className="font-mono text-foreground tabular-nums">
                  {privacyMode ? "•••" : formatCurrency(item.value)}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* IT Team Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">IT Team</CardTitle>
          <p className="text-sm text-muted-foreground">
            {kpis.itHeadcount} members · monthly employer cost — internal from Officient (gross + charges + provisions), external from BC
          </p>
        </CardHeader>
        <CardContent>
          <ITTeamTable employees={displayEmployees} />
        </CardContent>
      </Card>
    </div>
  );
}
