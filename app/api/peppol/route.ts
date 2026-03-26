import { NextResponse } from "next/server";
import { getPeppolInvoices } from "@/lib/data-source";
import { parsePeppolXML } from "@/lib/peppol-parser";

// GET /api/peppol — list all Peppol invoices (demo: from mock JSON)
export async function GET() {
  const invoices = await getPeppolInvoices();
  return NextResponse.json(invoices);
}

// POST /api/peppol — upload a UBL XML invoice, parse and return it
export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";

    let xml: string;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!file || typeof file === "string") {
        return NextResponse.json(
          { error: "No file provided in form data." },
          { status: 400 }
        );
      }
      xml = await (file as File).text();
    } else {
      // Treat raw body as XML text
      xml = await request.text();
    }

    if (!xml.trim()) {
      return NextResponse.json({ error: "Empty request body." }, { status: 400 });
    }

    const parsed = parsePeppolXML(xml);

    if (!parsed) {
      return NextResponse.json(
        { error: "Failed to parse UBL XML. Ensure the file is a valid Peppol BIS Billing 3.0 invoice." },
        { status: 422 }
      );
    }

    // Strip raw XML from the response to keep the payload lean
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { rawXml: _raw, ...invoice } = parsed;

    return NextResponse.json(invoice, { status: 201 });
  } catch (err) {
    console.error("[peppol] POST error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
