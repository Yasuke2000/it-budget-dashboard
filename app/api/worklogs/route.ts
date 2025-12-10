import { NextResponse } from "next/server";
import { getJiraWorklogs, getJiraProjectCosts } from "@/lib/data-source";

export async function GET() {
  const [worklogs, projectCosts] = await Promise.all([
    getJiraWorklogs(),
    getJiraProjectCosts(),
  ]);

  return NextResponse.json({ worklogs, projectCosts });
}
