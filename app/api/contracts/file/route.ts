import { NextResponse } from "next/server";
import { saveContractFile, readContractFile, contentTypeFor, MAX_FILE_BYTES } from "@/lib/contract-files";

export const dynamic = "force-dynamic";

// Upload a contract document (multipart form field "file"). Returns {fileId, fileName}
// to attach to a contract record.
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 422 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "File too large (max 20 MB)" }, { status: 413 });
  }
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const ref = await saveContractFile(file.name, bytes);
    return NextResponse.json({ success: true, ...ref });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Upload failed" }, { status: 422 });
  }
}

// Download/view a stored contract document by id.
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const found = await readContractFile(id);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(found.data), {
    headers: {
      "Content-Type": contentTypeFor(found.name),
      "Content-Disposition": `inline; filename="${found.name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
