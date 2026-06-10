import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { parseCSV, importEasyPayCSV } from "@/lib/csv-parser";
import { savePayrollEntries, getPayrollEntries, clearPayrollEntries } from "@/lib/payroll-store";

// EasyPay payroll ingest — serves BOTH integration paths:
//   • Manual:    the Import page POSTs the uploaded file here (multipart/form-data).
//   • Automated: a cron job / SFTP-drop watcher POSTs the CSV text with the
//                `Authorization: Bearer <SYNC_CRON_SECRET>` header.
//
// This route is excluded from the auth middleware and authorizes itself.

async function authorize(request: Request): Promise<boolean> {
  const secret = process.env.SYNC_CRON_SECRET;
  const header = request.headers.get("authorization");
  if (secret && header === `Bearer ${secret}`) return true; // automated path
  if (!process.env.AUTH_MICROSOFT_ENTRA_ID_ID) return true; // auth disabled (internal/homelab)
  const session = await auth(); // manual path — require a signed-in user
  return !!session;
}

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
  return await request.text(); // raw text/csv
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
  const { data, errors, totalRows } = importEasyPayCSV(rows);
  if (data.length === 0) {
    return NextResponse.json(
      { error: "No valid payroll rows found — check the month and employer-cost columns", errors },
      { status: 422 }
    );
  }

  const merged = await savePayrollEntries(data);
  const total = data.reduce((s, e) => s + e.amount, 0);
  return NextResponse.json({
    success: true,
    imported: data.length,
    months: data.map((e) => e.month),
    totalImportedCost: Math.round(total * 100) / 100,
    storedEntries: merged.length,
    rowsParsed: totalRows,
    warnings: errors.length ? errors : undefined,
  });
}

export async function GET(request: Request) {
  if (!(await authorize(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const entries = await getPayrollEntries();
  return NextResponse.json({ entries });
}

export async function DELETE(request: Request) {
  if (!(await authorize(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await clearPayrollEntries("EasyPay");
  return NextResponse.json({ success: true });
}
