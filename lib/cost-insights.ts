import type {
  M365License,
  ManagedDevice,
  VendorSummary,
  BudgetEntry,
  Employee,
} from "./types";

export interface CostInsight {
  id: string;
  category: "license_waste" | "vendor_risk" | "hardware_lifecycle" | "budget_overrun" | "optimization" | "shadow_it" | "duplicate_cost";
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  potentialSavings: number;  // EUR per year
  action: string;
  dataSource: string;
  detectedAt: string;
}

export function analyzeLicenseWaste(licenses: M365License[]): CostInsight[] {
  const insights: CostInsight[] = [];
  const paid = licenses.filter(l => l.pricePerUser > 0);

  // Unused paid licenses
  for (const lic of paid) {
    if (lic.wastedUnits > 0) {
      insights.push({
        id: `lic-waste-${lic.skuPartNumber}`,
        category: "license_waste",
        severity: lic.wastedCost > 100 ? "critical" : "warning",
        title: `${lic.wastedUnits} unused ${lic.displayName} licenses`,
        description: `You're paying for ${lic.prepaidUnits} licenses but only ${lic.consumedUnits} are assigned. ${lic.wastedUnits} licenses are sitting idle at €${lic.pricePerUser.toFixed(2)}/user/month.`,
        potentialSavings: lic.wastedCost * 12,
        action: `Reduce ${lic.displayName} from ${lic.prepaidUnits} to ${lic.consumedUnits + Math.ceil(lic.wastedUnits * 0.1)} licenses (keep 10% buffer)`,
        dataSource: "Microsoft Graph — subscribedSkus",
        detectedAt: new Date().toISOString().split("T")[0],
      });
    }
  }

  // Low utilization overall
  const totalPrepaid = paid.reduce((s, l) => s + l.prepaidUnits, 0);
  const totalConsumed = paid.reduce((s, l) => s + l.consumedUnits, 0);
  const utilRate = totalPrepaid > 0 ? (totalConsumed / totalPrepaid) * 100 : 100;
  if (utilRate < 85) {
    insights.push({
      id: "lic-util-low",
      category: "license_waste",
      severity: "warning",
      title: `Overall license utilization at ${utilRate.toFixed(1)}%`,
      description: `Across all paid SKUs, ${totalPrepaid - totalConsumed} licenses are unassigned. Industry benchmark is >90% utilization.`,
      potentialSavings: paid.reduce((s, l) => s + l.wastedCost, 0) * 12,
      action: "Review license assignments quarterly. Consider right-sizing during next renewal.",
      dataSource: "Microsoft Graph — subscribedSkus",
      detectedAt: new Date().toISOString().split("T")[0],
    });
  }

  // License downgrade opportunities (E5 users who might only need E3)
  const e5 = paid.find(l => l.skuPartNumber === "SPE_E5");
  const e3 = paid.find(l => l.skuPartNumber === "SPE_E3");
  if (e5 && e5.consumedUnits > 0 && e3) {
    const savingsPerUser = e5.pricePerUser - e3.pricePerUser;
    // Assume 30% of E5 users could downgrade
    const potentialDowngrades = Math.ceil(e5.consumedUnits * 0.3);
    insights.push({
      id: "lic-downgrade-e5",
      category: "optimization",
      severity: "info",
      title: `Potential E5 → E3 license downgrade for ${potentialDowngrades} users`,
      description: `${e5.consumedUnits} users have E5 licenses (€${e5.pricePerUser}/mo). If 30% only need E3 features (€${e3.pricePerUser}/mo), you'd save €${savingsPerUser.toFixed(2)}/user/month.`,
      potentialSavings: potentialDowngrades * savingsPerUser * 12,
      action: "Audit E5 feature usage: check which users actually use Defender P2, eDiscovery, or advanced compliance features.",
      dataSource: "Microsoft Graph — subscribedSkus + user activity",
      detectedAt: new Date().toISOString().split("T")[0],
    });
  }

  return insights;
}

export function analyzeVendorRisks(vendors: VendorSummary[]): CostInsight[] {
  const insights: CostInsight[] = [];

  // Concentration risk
  for (const v of vendors) {
    if (v.isConcentrationRisk) {
      insights.push({
        id: `vendor-conc-${v.vendorNumber}`,
        category: "vendor_risk",
        severity: "warning",
        title: `${v.vendorName} represents ${v.percentOfTotal.toFixed(1)}% of IT spend`,
        description: `Vendor concentration above 30% creates dependency risk. If ${v.vendorName} increases prices or has service issues, impact is significant.`,
        potentialSavings: 0,
        action: `Evaluate alternative vendors for ${v.categories.join(", ")}. Negotiate multi-year pricing to lock in rates.`,
        dataSource: "Business Central — purchaseInvoices",
        detectedAt: new Date().toISOString().split("T")[0],
      });
    }
  }

  // Vendors with only 1-2 invoices (potential shadow IT)
  const smallVendors = vendors.filter(v => v.invoiceCount <= 2 && v.totalSpend > 500);
  if (smallVendors.length > 0) {
    insights.push({
      id: "vendor-shadow",
      category: "shadow_it",
      severity: "info",
      title: `${smallVendors.length} vendors with only 1-2 invoices detected`,
      description: `Vendors with very few invoices may indicate ad-hoc purchases or shadow IT: ${smallVendors.map(v => v.vendorName).join(", ")}. Total: €${smallVendors.reduce((s, v) => s + v.totalSpend, 0).toFixed(0)}.`,
      potentialSavings: smallVendors.reduce((s, v) => s + v.totalSpend, 0) * 0.3,
      action: "Review each vendor. Consolidate into existing contracts where possible.",
      dataSource: "Business Central — purchaseInvoices",
      detectedAt: new Date().toISOString().split("T")[0],
    });
  }

  return insights;
}

export function analyzeHardwareLifecycle(devices: ManagedDevice[]): CostInsight[] {
  const insights: CostInsight[] = [];

  // Devices past lifecycle (>4 years)
  const aged = devices.filter(d => d.ageYears > 4);
  if (aged.length > 0) {
    const avgReplacementCost = 1200; // EUR per device
    insights.push({
      id: "hw-lifecycle",
      category: "hardware_lifecycle",
      severity: aged.length > 10 ? "critical" : "warning",
      title: `${aged.length} devices past 4-year lifecycle`,
      description: `${aged.length} of ${devices.length} devices are older than 4 years. Older devices have higher failure rates, security risks, and lower productivity. Manufacturers: ${[...new Set(aged.map(d => d.manufacturer))].join(", ")}.`,
      potentialSavings: 0, // This is a cost, not a saving
      action: `Plan hardware refresh: estimated budget €${(aged.length * avgReplacementCost).toLocaleString()} for ${aged.length} replacements. Prioritize devices >5 years old.`,
      dataSource: "Intune — managedDevices",
      detectedAt: new Date().toISOString().split("T")[0],
    });
  }

  // Approaching lifecycle (3-4 years) — plan ahead
  const approaching = devices.filter(d => d.ageYears > 3 && d.ageYears <= 4);
  if (approaching.length > 0) {
    insights.push({
      id: "hw-approaching",
      category: "hardware_lifecycle",
      severity: "info",
      title: `${approaching.length} devices approaching lifecycle end (3-4 years)`,
      description: `These devices will need replacement within the next 12 months. Include in next budget cycle.`,
      potentialSavings: 0,
      action: `Add €${(approaching.length * 1200).toLocaleString()} to next year's hardware budget for planned replacements.`,
      dataSource: "Intune — managedDevices",
      detectedAt: new Date().toISOString().split("T")[0],
    });
  }

  // Non-compliant devices
  const nonCompliant = devices.filter(d => d.complianceState === "noncompliant");
  if (nonCompliant.length > 0) {
    insights.push({
      id: "hw-noncompliant",
      category: "optimization",
      severity: nonCompliant.length > 5 ? "critical" : "warning",
      title: `${nonCompliant.length} non-compliant devices detected`,
      description: `Non-compliant devices may have outdated OS, missing encryption, or disabled security features. This is a security risk and potential NIS2 compliance issue.`,
      potentialSavings: 0,
      action: "Remediate non-compliant devices: update OS, enable BitLocker, verify Defender status.",
      dataSource: "Intune — managedDevices",
      detectedAt: new Date().toISOString().split("T")[0],
    });
  }

  return insights;
}

export function analyzeBudgetOverruns(budget: BudgetEntry[]): CostInsight[] {
  const insights: CostInsight[] = [];

  // Categories consistently over budget
  const categories = [...new Set(budget.map(b => b.category))];
  for (const cat of categories) {
    const entries = budget.filter(b => b.category === cat);
    const overruns = entries.filter(b => b.variancePercent > 5);
    if (overruns.length >= 3) {
      const avgOverrun = overruns.reduce((s, b) => s + b.variance, 0) / overruns.length;
      insights.push({
        id: `budget-overrun-${cat.replace(/[^a-z]/gi, "")}`,
        category: "budget_overrun",
        severity: overruns.length >= 6 ? "critical" : "warning",
        title: `${cat}: over budget ${overruns.length} of ${entries.length} months`,
        description: `Average overrun of €${avgOverrun.toFixed(0)}/month when over budget. This category may need a budget increase or cost reduction initiative.`,
        potentialSavings: Math.abs(avgOverrun) * 12,
        action: `Either increase the ${cat} budget by €${avgOverrun.toFixed(0)}/month or investigate cost reduction opportunities.`,
        dataSource: "Budget tracking — GL entries",
        detectedAt: new Date().toISOString().split("T")[0],
      });
    }
  }

  return insights;
}

export function analyzePersonnelCosts(employees: Employee[]): CostInsight[] {
  const insights: CostInsight[] = [];
  const itTeam = employees.filter(e => e.department === "IT" && e.status === "active");
  const totalEmployees = employees.filter(e => e.status === "active").length;

  // IT ratio
  if (totalEmployees > 0) {
    const itRatio = (itTeam.length / totalEmployees) * 100;
    if (itRatio < 3) {
      insights.push({
        id: "personnel-understaffed",
        category: "optimization",
        severity: "info",
        title: `IT team is ${itRatio.toFixed(1)}% of headcount (${itTeam.length}/${totalEmployees})`,
        description: `Industry benchmark for logistics companies is 3-5% IT staff ratio. Your ratio suggests the IT team may be understaffed, leading to reliance on expensive external services.`,
        potentialSavings: 0,
        action: "Compare internal IT costs vs external IT services spend. Consider whether hiring internally would be more cost-effective than EASI managed services.",
        dataSource: "Officient HR — people",
        detectedAt: new Date().toISOString().split("T")[0],
      });
    }
  }

  return insights;
}

// Master function that runs all analyses
export function generateAllInsights(data: {
  licenses: M365License[];
  vendors: VendorSummary[];
  devices: ManagedDevice[];
  budget: BudgetEntry[];
  employees: Employee[];
}): CostInsight[] {
  return [
    ...analyzeLicenseWaste(data.licenses),
    ...analyzeVendorRisks(data.vendors),
    ...analyzeHardwareLifecycle(data.devices),
    ...analyzeBudgetOverruns(data.budget),
    ...analyzePersonnelCosts(data.employees),
  ].sort((a, b) => {
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
}
