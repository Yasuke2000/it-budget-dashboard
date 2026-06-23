import { NextResponse } from "next/server";
import { getAppSettings, saveAppSettings } from "@/lib/settings-store";
import { clearCache } from "@/lib/sync-cache";

export async function GET() {
  const { glMappings, licensePrices, itVendorRules } = await getAppSettings();
  return NextResponse.json({ glMappings, licensePrices, itVendorRules });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      glMappings?: Record<string, string>;
      licensePrices?: Record<string, number>;
      itVendorRules?: Record<string, string>;
    };
    const settings = await saveAppSettings({
      glMappings: body.glMappings,
      licensePrices: body.licensePrices,
      itVendorRules: body.itVendorRules,
    });
    // Invalidate cached spend/licenses so the new mapping/prices take effect now
    // (instead of after the 2–4h TTL).
    clearCache();
    return NextResponse.json({
      status: "ok",
      message: "Settings saved",
      settings,
    });
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid JSON body" },
      { status: 400 }
    );
  }
}
