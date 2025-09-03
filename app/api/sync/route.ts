import { NextResponse } from "next/server";

function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE !== "false";
}

export async function POST(request: Request) {
  // Check authorization if SYNC_CRON_SECRET is configured
  const cronSecret = process.env.SYNC_CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (isDemoMode()) {
    return NextResponse.json({
      status: "ok",
      message: "Demo mode — no sync performed",
      timestamp: new Date().toISOString(),
    });
  }

  // Live mode: stub — wire up real sync logic here
  try {
    // TODO: call live BC/Graph sync functions once implemented
    // e.g. await syncAllCompanies();

    return NextResponse.json({
      status: "ok",
      message: "Sync completed",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { status: "error", message, timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
