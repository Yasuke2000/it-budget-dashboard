// Jira Cloud REST API v3 client
// Base URL: https://{site}.atlassian.net/rest/api/3/
// Auth: Basic (email + API token)

import type { JiraWorklog } from "./types";

function getJiraAuth(): { baseUrl: string; authHeader: string } | null {
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!baseUrl || !email || !token) return null;

  const authHeader = "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
  return { baseUrl, authHeader };
}

async function fetchJira(endpoint: string): Promise<unknown> {
  const auth = getJiraAuth();
  if (!auth) throw new Error("Jira credentials not configured");

  const response = await fetch(`${auth.baseUrl}/rest/api/3${endpoint}`, {
    headers: {
      Authorization: auth.authHeader,
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`Jira API error: ${response.status}`);
  return response.json();
}

export async function fetchJiraWorklogs(
  projectKeys: string[] = ["ITSUP", "INFRA", "SEC", "PROJ"],
  dateFrom?: string,
  dateTo?: string
): Promise<JiraWorklog[]> {
  const from = dateFrom || new Date(new Date().getFullYear(), 0, 1).toISOString().split("T")[0];
  const to = dateTo || new Date().toISOString().split("T")[0];

  const worklogs: JiraWorklog[] = [];

  for (const projectKey of projectKeys) {
    const jql = encodeURIComponent(
      `project = ${projectKey} AND worklogDate >= "${from}" AND worklogDate <= "${to}"`
    );

    try {
      const searchResult = await fetchJira(
        `/search?jql=${jql}&fields=summary,worklog,project&maxResults=100`
      ) as { issues?: Array<{
        key: string;
        fields?: {
          summary?: string;
          worklog?: {
            worklogs?: Array<{
              started?: string;
              timeSpentSeconds?: number;
              author?: { displayName?: string; emailAddress?: string };
            }>;
          };
        };
      }> };

      for (const issue of searchResult.issues || []) {
        const issueWorklogs = issue.fields?.worklog?.worklogs || [];
        for (const wl of issueWorklogs) {
          const started = wl.started?.split("T")[0] || "";
          if (started >= from && started <= to) {
            worklogs.push({
              issueKey: issue.key,
              issueSummary: issue.fields?.summary || "",
              author: wl.author?.displayName || wl.author?.emailAddress || "Unknown",
              timeSpentSeconds: wl.timeSpentSeconds || 0,
              timeSpentHours: Math.round(((wl.timeSpentSeconds || 0) / 3600) * 10) / 10,
              started,
              project: projectKey,
            });
          }
        }
      }
    } catch (err) {
      console.error(`Failed to fetch worklogs for ${projectKey}:`, err);
    }
  }

  return worklogs;
}
