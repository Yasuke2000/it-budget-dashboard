import { NextResponse } from "next/server";
import { getDeveloperDashboard } from "@/lib/azure-devops-client";
import { getVendorSummary, getITPersonnelCost } from "@/lib/data-source";
import { getJiraDevMetrics } from "@/lib/jira-client";
import type { DeveloperROIRow } from "@/lib/types";

// Map each developer (by commit-author email) to a cost source. External devs map
// to a BC vendor (exact); internal devs sit inside the IT-department payroll
// (per-person not separable in BC); management is excluded. Editable here.
const COST_MAP: Record<string, { kind: "vendor" | "internal" | "excluded"; match?: string; label: string }> = {
  "jonas.willaeys@gheeraert.be": { kind: "vendor", match: "allphi", label: "ALLPHI (external)" },
  "peter.gheeraert@gheeraert.be": { kind: "excluded", label: "G-Force (management — excluded)" },
  "stijn.vandamme@gheeraert.be": { kind: "internal", label: "Internal (IT-dept payroll)" },
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const now = new Date();
  const defaultTo = now.toISOString().slice(0, 10);
  const defaultFrom = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  const dateFrom = searchParams.get("dateFrom") || defaultFrom;
  const dateTo = searchParams.get("dateTo") || defaultTo;
  const branchEnv = searchParams.get("branch") === "production"
    ? (process.env.AZURE_DEVOPS_PROD_BRANCH || "master")
    : (process.env.AZURE_DEVOPS_PRIMARY_BRANCH || "develop");
  try {
    const data = await getDeveloperDashboard(dateFrom, dateTo, branchEnv);
    if (data.configured && data.developers.length) {
      // Jira ticket + hours KPIs for the same developers (best-effort).
      const jira = await getJiraDevMetrics(data.developers.map((d) => d.email), ["GP", "IT"], dateFrom, dateTo).catch(() => null);
      if (jira) data.jira = jira;
      // Cost sources for the same window (best-effort; lumpy invoice timing means
      // ROI is most meaningful over months, not days).
      const [vendors, itPayroll] = await Promise.all([
        getVendorSummary("all", dateFrom, dateTo).catch(() => []),
        getITPersonnelCost("all", dateFrom, dateTo).catch(() => 0),
      ]);
      const roi: DeveloperROIRow[] = data.developers.map((d) => {
        const m = COST_MAP[d.email.toLowerCase()];
        const base = { name: d.name, email: d.email, commits: d.commits, issues: d.issues, filesChanged: d.filesChanged };
        if (!m) return { ...base, costLabel: "Unmapped", periodCost: null, costPerCommit: null, costPerIssue: null, note: "No cost source mapped." };
        if (m.kind === "excluded") return { ...base, costLabel: m.label, periodCost: null, costPerCommit: null, costPerIssue: null, note: "Management comp — not counted as dev cost." };
        if (m.kind === "internal") return { ...base, costLabel: m.label, periodCost: null, costPerCommit: null, costPerIssue: null, note: "Inside the IT-department payroll; per-person not separable in BC." };
        // vendor — sum ALL matching vendors (not just the first), so split vendor
        // names aggregate. If none match, cost is UNKNOWN (null), not a misleading €0.
        const matches = vendors.filter((x) => (x.vendorName || "").toLowerCase().includes(m.match || ""));
        if (!matches.length) {
          return { ...base, costLabel: m.label, periodCost: null, costPerCommit: null, costPerIssue: null, note: "No vendor spend found in this period." };
        }
        const cost = Math.round(matches.reduce((s, x) => s + (x.totalSpend || 0), 0));
        return {
          ...base, costLabel: m.label, periodCost: cost,
          costPerCommit: d.commits ? Math.round(cost / d.commits) : null,
          costPerIssue: d.issues ? Math.round(cost / d.issues) : null,
        };
      });
      data.roi = roi;
      data.itDeptPayrollPeriod = itPayroll;
    }
    return NextResponse.json(data);
  } catch (e) {
    console.error("developer dashboard error:", e);
    return NextResponse.json({ error: "Failed to load developer metrics" }, { status: 500 });
  }
}
