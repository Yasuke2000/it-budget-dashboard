import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getContracts } from "@/lib/data-source";
import { upsertContract, deleteContract, getContractsStored, type StoredContract } from "@/lib/contract-store";
import { deleteContractFile } from "@/lib/contract-files";

export const dynamic = "force-dynamic";

export async function GET() {
  const contracts = await getContracts();
  return NextResponse.json(contracts);
}

const CATEGORIES = ["license", "domain", "ssl", "support", "saas", "infrastructure"];
const BILLING = ["monthly", "quarterly", "annual", "multi-year"];

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const vendor = String(body.vendor || "").trim();
  if (!vendor) return NextResponse.json({ error: "Vendor is required" }, { status: 422 });

  // Cost normalisation: accept annual or monthly, keep both consistent.
  const billingCycle = (BILLING.includes(String(body.billingCycle)) ? body.billingCycle : "annual") as StoredContract["billingCycle"];
  let annualCost = Number(body.annualCost) || 0;
  let monthlyCost = Number(body.monthlyCost) || 0;
  if (annualCost && !monthlyCost) monthlyCost = annualCost / 12;
  else if (monthlyCost && !annualCost) annualCost = monthlyCost * 12;

  const contract: StoredContract = {
    id: String(body.id || "").trim() || randomUUID(),
    vendor,
    description: String(body.description || "").trim(),
    category: (CATEGORIES.includes(String(body.category)) ? body.category : "saas") as StoredContract["category"],
    startDate: String(body.startDate || "").trim(),
    endDate: String(body.endDate || "").trim(),
    renewalType: body.autoRenew ? "auto" : "manual",
    autoRenew: Boolean(body.autoRenew),
    noticePeriodDays: Math.max(0, Number(body.noticePeriodDays) || 0),
    monthlyCost: Math.round(monthlyCost * 100) / 100,
    annualCost: Math.round(annualCost * 100) / 100,
    billingCycle,
    owner: String(body.owner || "").trim(),
    notes: String(body.notes || "").trim(),
    tags: Array.isArray(body.tags) ? (body.tags as string[]).map(String) : [],
    fileId: body.fileId ? String(body.fileId) : undefined,
    fileName: body.fileName ? String(body.fileName) : undefined,
  };

  await upsertContract(contract);
  return NextResponse.json({ success: true, contract });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  // Remove the attached file too, if any.
  const existing = (await getContractsStored()).find((c) => c.id === id);
  if (existing?.fileId) await deleteContractFile(existing.fileId);
  await deleteContract(id);
  return NextResponse.json({ success: true });
}
