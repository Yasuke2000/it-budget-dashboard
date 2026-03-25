import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    demoMode: process.env.NEXT_PUBLIC_DEMO_MODE !== "false",
    connections: {
      entraId: !!process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      businessCentral: !!process.env.BC_CLIENT_ID,
      jira: !!process.env.JIRA_BASE_URL,
      officient: !!process.env.OFFICIENT_CLIENT_ID,
      knox: !!process.env.KNOX_CLIENT_ID,
      dell: !!process.env.DELL_CLIENT_ID,
      lenovo: !!process.env.LENOVO_CLIENT_ID,
    },
  });
}
