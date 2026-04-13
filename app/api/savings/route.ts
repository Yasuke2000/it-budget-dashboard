import { NextResponse } from "next/server";
import { getLicenses } from "@/lib/data-source";
import type { SavingsOpportunity } from "@/lib/types";

export async function GET() {
  try {
    const licenses = await getLicenses();

    const opportunities: SavingsOpportunity[] = licenses
      .filter((l) => l.wastedUnits > 0 && l.pricePerUser > 0)
      .map((l) => ({
        id: `sav-${l.skuPartNumber}`,
        sku: l.skuPartNumber,
        displayName: l.displayName,
        unusedCount: l.wastedUnits,
        pricePerUser: l.pricePerUser,
        monthlyWaste: l.wastedCost,
        annualSavings: l.wastedCost * 12,
        status: "identified" as const,
        utilization: l.utilizationRate,
        totalLicenses: l.prepaidUnits,
        assignedLicenses: l.consumedUnits,
      }))
      .sort((a, b) => b.annualSavings - a.annualSavings);

    return NextResponse.json(opportunities);
  } catch (error) {
    console.error("Failed to generate savings opportunities:", error);
    return NextResponse.json(
      { error: "Failed to generate savings opportunities" },
      { status: 500 }
    );
  }
}
