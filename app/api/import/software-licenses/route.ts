import { NextResponse } from "next/server";
import { authorizeImport as authorize } from "@/lib/import-auth";
import { parseCSV, importSoftwareLicenseCSV } from "@/lib/csv-parser";
import {
  saveSoftwareLicenses,
  getSoftwareLicensesStored,
  clearSoftwareLicenses,
} from "@/lib/software-license-store";

// Non-Microsoft software-license ingest. Manual upload (multipart) or automated
// drop (Bearer SYNC_CRON_SECRET). Self-authorizing (excluded from middleware).

async function readCsv(request: Request): Promise<string> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file") || form.get("csv");
    if (file instanceof File) return await file.text();
    if (typeof file === "string") return file;
    return "";
  }
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as { csv?: string };
    return body.csv || "";
  }
  return await request.text();
}

export async function POST(request: Request) {
  if (!(await authorize(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let csv: string;
  try {
    csv = await readCsv(request);
  } catch {
    return NextResponse.json({ error: "Could not read request body" }, { status: 400 });
  }
  if (!csv.trim()) {
    return NextResponse.json({ error: "No CSV content provided" }, { status: 400 });
  }

  const rows = parseCSV(csv);
  const { data, errors, totalRows } = importSoftwareLicenseCSV(rows);
  if (data.length === 0) {
    return NextResponse.json(
      { error: "No valid license rows found — check the vendor/product columns", errors },
      { status: 422 }
    );
  }

  const merged = await saveSoftwareLicenses(data);
  const annual = data.reduce((s, l) => s + l.annualCost, 0);
  const formatted = new Intl.NumberFormat("nl-BE", { style: "currency", currency: "EUR" }).format(annual);
  return NextResponse.json({
    success: true,
    imported: data.length,
    summary: `${data.length} license(s) — ${formatted}/yr`,
    storedEntries: merged.length,
    rowsParsed: totalRows,
    warnings: errors.length ? errors : undefined,
  });
}

export async function GET(request: Request) {
  if (!(await authorize(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ licenses: await getSoftwareLicensesStored() });
}

export async function DELETE(request: Request) {
  if (!(await authorize(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await clearSoftwareLicenses();
  return NextResponse.json({ success: true });
}
