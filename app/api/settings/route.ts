import { NextResponse } from "next/server";
import { getAppSettings, saveAppSettings } from "@/lib/settings-store";

export async function GET() {
  const { glMappings, licensePrices } = await getAppSettings();
  return NextResponse.json({ glMappings, licensePrices });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      glMappings?: Record<string, string>;
      licensePrices?: Record<string, number>;
    };
    const settings = await saveAppSettings({
      glMappings: body.glMappings,
      licensePrices: body.licensePrices,
    });
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
