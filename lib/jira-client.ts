// Jira Cloud REST API v3 client
// Base URL: https://{site}.atlassian.net/rest/api/3/
// Auth: Basic (email + API token)
//
// IMPORTANT: the legacy GET /rest/api/3/search endpoint was removed by Atlassian
// (410 Gone since Oct 2025). This client uses the replacement POST /search/jql
// with nextPageToken pagination, then pulls worklogs from the dedicated
// /issue/{key}/worklog endpoint — the worklog field on search returns at most
// 20 entries per issue, which would silently undercount labour costs.

import type { JiraWorklog } from "./types";
import { fetchWithRetry } from "./http";

function getJiraAuth(): { baseUrl: string; authHeader: string } | null {
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!baseUrl || !email || !token) return null;

  const authHeader = "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
  // Strip any trailing slash so we can safely concatenate paths.
  return { baseUrl: baseUrl.replace(/\/$/, ""), authHeader };
}

/** Blended hourly cost used to value worklog time. Override with JIRA_HOURLY_COST. */
function hourlyCost(): number {
  const raw = Number(process.env.JIRA_HOURLY_COST);
  return Number.isFinite(raw) && raw > 0 ? raw : 75;
}

interface JqlSearchPage {
  issues?: Array<{ key: string; fields?: { summary?: string } }>;
  nextPageToken?: string;
  isLast?: boolean;
}

/** Return all issue keys (+ summaries) matching a JQL query, paginating via nextPageToken. */
async function searchIssueKeys(
  baseUrl: string,
  authHeader: string,
  jql: string
): Promise<Array<{ key: string; summary: string }>> {
  const out: Array<{ key: string; summary: string }> = [];
  let nextPageToken: string | undefined;
  // Guard against the known nextPageToken infinite-loop bug: cap total pages.
  for (let page = 0; page < 50; page++) {
    const res = await fetchWithRetry(`${baseUrl}/rest/api/3/search/jql`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jql,
        fields: ["summary"],
        maxResults: 100,
        ...(nextPageToken ? { nextPageToken } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Jira search/jql ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as JqlSearchPage;

    for (const issue of data.issues ?? []) {
      out.push({ key: issue.key, summary: issue.fields?.summary ?? "" });
    }

    if (data.isLast || !data.nextPageToken) break;
    // Defensive: a repeated token means the page isn't advancing — stop.
    if (data.nextPageToken === nextPageToken) break;
    nextPageToken = data.nextPageToken;
  }
  return out;
}

interface IssueWorklogPage {
  worklogs?: Array<{
    started?: string;
    timeSpentSeconds?: number;
    author?: { displayName?: string; emailAddress?: string };
  }>;
  total?: number;
  maxResults?: number;
  startAt?: number;
}

/** Fetch every worklog for one issue, paginating via startAt (1000/page max). */
async function fetchIssueWorklogs(
  baseUrl: string,
  authHeader: string,
  issueKey: string,
  from: string,
  to: string
): Promise<IssueWorklogPage["worklogs"]> {
  const all: NonNullable<IssueWorklogPage["worklogs"]> = [];
  let startAt = 0;
  for (let page = 0; page < 100; page++) {
    const res = await fetchWithRetry(
      `${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/worklog?startAt=${startAt}&maxResults=1000`,
      { headers: { Authorization: authHeader, Accept: "application/json" } }
    );
    if (!res.ok) throw new Error(`Jira worklog ${res.status} for ${issueKey}`);
    const data = (await res.json()) as IssueWorklogPage;
    const batch = data.worklogs ?? [];
    all.push(...batch);

    const total = data.total ?? all.length;
    startAt += batch.length;
    if (batch.length === 0 || startAt >= total) break;
  }
  // Filter by worklog start date (the JQL only narrows issues, not individual logs).
  return all.filter((wl) => {
    const started = wl.started?.split("T")[0] ?? "";
    return started >= from && started <= to;
  });
}

export async function fetchJiraWorklogs(
  projectKeys: string[] = ["IT", "GP"],
  dateFrom?: string,
  dateTo?: string
): Promise<JiraWorklog[]> {
  const auth = getJiraAuth();
  if (!auth) throw new Error("Jira credentials not configured");

  const from = dateFrom || new Date(new Date().getFullYear(), 0, 1).toISOString().split("T")[0];
  const to = dateTo || new Date().toISOString().split("T")[0];
  const rate = hourlyCost();

  const worklogs: JiraWorklog[] = [];

  for (const projectKey of projectKeys) {
    const jql = `project = "${projectKey}" AND worklogDate >= "${from}" AND worklogDate <= "${to}"`;
    try {
      const issues = await searchIssueKeys(auth.baseUrl, auth.authHeader, jql);
      for (const issue of issues) {
        const issueWorklogs = await fetchIssueWorklogs(
          auth.baseUrl,
          auth.authHeader,
          issue.key,
          from,
          to
        );
        for (const wl of issueWorklogs ?? []) {
          const seconds = wl.timeSpentSeconds || 0;
          const hours = Math.round((seconds / 3600) * 10) / 10;
          worklogs.push({
            issueKey: issue.key,
            issueSummary: issue.summary,
            author: wl.author?.displayName || wl.author?.emailAddress || "Unknown",
            timeSpentSeconds: seconds,
            timeSpentHours: hours,
            started: wl.started?.split("T")[0] || "",
            project: projectKey,
            hourlyCost: rate,
            totalCost: Math.round(hours * rate * 100) / 100,
          });
        }
      }
    } catch (err) {
      console.error(`Failed to fetch worklogs for ${projectKey}:`, err);
    }
  }

  return worklogs;
}
