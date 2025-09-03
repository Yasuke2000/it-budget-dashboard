import { NextResponse } from "next/server";
import { DEFAULT_GL_MAPPING, DEFAULT_LICENSE_PRICES } from "@/lib/constants";

export async function GET() {
  return NextResponse.json({
    glMappings: DEFAULT_GL_MAPPING,
    licensePrices: DEFAULT_LICENSE_PRICES,
  });
}

export async function POST(request: Request) {
  // In a production app these settings would be validated and persisted
  // (e.g. to a database or a config file). For now we just echo them back.
  try {
    const body = await request.json();
    const { glMappings, licensePrices } = body as {
      glMappings?: Record<string, string>;
      licensePrices?: Record<string, number>;
    };

    return NextResponse.json({
      status: "ok",
      message: "Settings received (persistence not yet implemented)",
      settings: {
        glMappings: glMappings ?? DEFAULT_GL_MAPPING,
        licensePrices: licensePrices ?? DEFAULT_LICENSE_PRICES,
      },
    });
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid JSON body" },
      { status: 400 }
    );
  }
}
