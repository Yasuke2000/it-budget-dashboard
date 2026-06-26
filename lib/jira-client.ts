// Jira Cloud REST API v3 client
// Base URL: https://{site}.atlassian.net/rest/api/3/
// Auth: Basic (email + API token)
//
// IMPORTANT: the legacy GET /rest/api/3/search endpoint was removed by Atlassian
// (410 Gone since Oct 2025). This client uses the replacement POST /search/jql
// with nextPageToken pagination, then pulls worklogs from the dedicated
// /issue/{key}/worklog endpoint — the worklog field on search returns at most
// 20 entries per issue, which would silently undercount labour costs.

import type { JiraWorklog, JiraDevStat, JiraMetrics } from "./types";
import { fetchWithRetry } from "./http";
import { getCache, setCache } from "./sync-cache";

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
    author?: { displayName?: string; emailAddress?: string; accountId?: string };
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

// ---- Developer KPIs (Peter's request) ----

/** Count issues matching a JQL via the modern approximate-count endpoint. */
// Returns the count, or NULL on any failure — so a transient error is NOT mistaken
// for a genuine zero on a KPI. Callers flag the result as unreliable when null.
async function approximateCount(baseUrl: string, authHeader: string, jql: string): Promise<number | null> {
  try {
    const res = await fetchWithRetry(`${baseUrl}/rest/api/3/search/approximate-count`, {
      method: "POST",
      headers: { Authorization: authHeader, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ jql }),
    });
    if (!res.ok) { console.warn(`Jira approximate-count ${res.status} for: ${jql.slice(0, 80)}`); return null; }
    const d = (await res.json()) as { count?: number };
    return Number(d.count) || 0;
  } catch (e) { console.warn("Jira approximate-count error:", e); return null; }
}

/** Resolve a Jira accountId from an email address (null if not found). */
async function searchUserAccountId(baseUrl: string, authHeader: string, email: string): Promise<string | null> {
  try {
    const res = await fetchWithRetry(`${baseUrl}/rest/api/3/user/search?query=${encodeURIComponent(email)}`, {
      headers: { Authorization: authHeader, Accept: "application/json" },
    });
    if (!res.ok) return null;
    const arr = (await res.json()) as Array<{ accountId?: string }>;
    return (Array.isArray(arr) && arr[0]?.accountId) || null;
  } catch { return null; }
}

const ZERO_STAT: JiraDevStat = { opened: 0, closed: 0, openNow: 0, updated: 0, hours: 0, responseHours: null };

// Earliest "first response" on an issue = min(first comment.created, earliest worklog.started)
// after the issue was created. Returns ms-to-first-response, or null if none yet.
async function fetchFirstResponseMs(baseUrl: string, authHeader: string, issueKey: string, createdMs: number): Promise<number | null> {
  const h = { Authorization: authHeader, Accept: "application/json" };
  let earliest = Infinity;
  try {
    const [cRes, wRes] = await Promise.all([
      fetchWithRetry(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment?orderBy=created&maxResults=1`, { headers: h }),
      fetchWithRetry(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/worklog?maxResults=50`, { headers: h }),
    ]);
    if (cRes.ok) { const j = (await cRes.json()) as { comments?: { created?: string }[] }; const c = j.comments?.[0]?.created; if (c) earliest = Math.min(earliest, Date.parse(c)); }
    if (wRes.ok) { const j = (await wRes.json()) as { worklogs?: { started?: string }[] }; for (const w of j.worklogs ?? []) { if (w.started) earliest = Math.min(earliest, Date.parse(w.started)); } }
  } catch { return null; }
  if (!isFinite(earliest)) return null;
  const ms = earliest - createdMs;
  return ms >= 0 ? ms : null;
}

// Issues CREATED in the window, with created date + assignee accountId (for the
// response-time KPI). Paginated, capped.
async function searchCreatedIssues(baseUrl: string, authHeader: string, jql: string, cap: number): Promise<{ key: string; created: string; assignee: string | null }[]> {
  const out: { key: string; created: string; assignee: string | null }[] = [];
  let nextPageToken: string | undefined;
  for (let page = 0; page < 50 && out.length < cap; page++) {
    const res = await fetchWithRetry(`${baseUrl}/rest/api/3/search/jql`, {
      method: "POST",
      headers: { Authorization: authHeader, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ jql, fields: ["created", "assignee"], maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}) }),
    });
    if (!res.ok) break;
    const data = (await res.json()) as { issues?: { key: string; fields?: { created?: string; assignee?: { accountId?: string } } }[]; nextPageToken?: string; isLast?: boolean };
    for (const i of data.issues ?? []) out.push({ key: i.key, created: i.fields?.created ?? "", assignee: i.fields?.assignee?.accountId ?? null });
    if (data.isLast || !data.nextPageToken || data.nextPageToken === nextPageToken) break;
    nextPageToken = data.nextPageToken;
  }
  return out.slice(0, cap);
}

// Hours logged per accountId in the window (bounded: only issues with worklogs in
// the period, capped, fetched with concurrency). Returns hours by accountId + total.
async function worklogHoursByAccount(
  baseUrl: string, authHeader: string, projectKeys: string[], from: string, to: string
): Promise<{ byAccount: Record<string, number>; total: number; partial: boolean }> {
  const projList = projectKeys.map((p) => `"${p}"`).join(", ");
  const issues = await searchIssueKeys(baseUrl, authHeader, `project in (${projList}) AND worklogDate >= "${from}" AND worklogDate <= "${to}"`);
  const CAP = 250;
  const partial = issues.length > CAP;
  const slice = issues.slice(0, CAP);
  const secByAccount: Record<string, number> = {};
  let totalSec = 0;
  const CONC = 8;
  for (let i = 0; i < slice.length; i += CONC) {
    const batch = slice.slice(i, i + CONC);
    const results = await Promise.all(batch.map((iss) => fetchIssueWorklogs(baseUrl, authHeader, iss.key, from, to).catch(() => [])));
    for (const wls of results) {
      for (const wl of wls ?? []) {
        const sec = wl.timeSpentSeconds || 0;
        totalSec += sec;
        const acc = wl.author?.accountId;
        if (acc) secByAccount[acc] = (secByAccount[acc] || 0) + sec;
      }
    }
  }
  const byAccount: Record<string, number> = {};
  for (const k of Object.keys(secByAccount)) byAccount[k] = Math.round((secByAccount[k] / 3600) * 10) / 10;
  return { byAccount, total: Math.round((totalSec / 3600) * 10) / 10, partial };
}

// Avg hours from issue creation to first response (oldest comment OR earliest
// worklog), team-wide and per assignee accountId. Scans issues CREATED in the
// window (capped, newest first) and probes each for its first response.
async function firstResponseByAccount(
  baseUrl: string, authHeader: string, projectKeys: string[], from: string, to: string
): Promise<{ byAccount: Record<string, number>; team: number | null; partial: boolean }> {
  const projList = projectKeys.map((p) => `"${p}"`).join(", ");
  const CAP = 100;
  const issues = await searchCreatedIssues(
    baseUrl, authHeader,
    `project in (${projList}) AND created >= "${from}" AND created <= "${to}" ORDER BY created DESC`,
    CAP,
  );
  const partial = issues.length >= CAP;
  const msByAccount: Record<string, number[]> = {};
  const allMs: number[] = [];
  const CONC = 8;
  for (let i = 0; i < issues.length; i += CONC) {
    const batch = issues.slice(i, i + CONC);
    const results = await Promise.all(batch.map(async (iss) => {
      const createdMs = iss.created ? Date.parse(iss.created) : NaN;
      if (!isFinite(createdMs)) return null;
      const ms = await fetchFirstResponseMs(baseUrl, authHeader, iss.key, createdMs).catch(() => null);
      return ms == null ? null : { ms, assignee: iss.assignee };
    }));
    for (const r of results) {
      if (!r) continue;
      allMs.push(r.ms);
      if (r.assignee) { (msByAccount[r.assignee] = msByAccount[r.assignee] || []).push(r.ms); }
    }
  }
  const HOUR = 3600000;
  const avg = (arr: number[]) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length / HOUR) * 10) / 10 : null);
  const byAccount: Record<string, number> = {};
  for (const k of Object.keys(msByAccount)) { const a = avg(msByAccount[k]); if (a != null) byAccount[k] = a; }
  return { byAccount, team: avg(allMs), partial };
}

/**
 * Per-developer + team Jira KPIs (tickets opened/closed/open/updated + hours
 * logged) for the given developer emails. Cached 2h (worklog scan is heavy).
 */
export async function getJiraDevMetrics(
  emails: string[], projectKeys: string[] = ["GP", "IT"], dateFrom?: string, dateTo?: string
): Promise<JiraMetrics | null> {
  const auth = getJiraAuth();
  if (!auth) return null;
  const from = dateFrom || new Date(new Date().getFullYear(), 0, 1).toISOString().split("T")[0];
  const to = dateTo || new Date().toISOString().split("T")[0];
  const { baseUrl, authHeader } = auth;
  const cacheKey = `jira-devmetrics-${projectKeys.join("+")}-${from}-${to}-${[...emails].sort().join(",")}`;
  const cached = getCache<JiraMetrics>(cacheKey);
  if (cached) return cached;

  const projList = projectKeys.map((p) => `"${p}"`).join(", ");
  const proj = `project in (${projList})`;
  // Treat a failed count as 0 for display BUT flag the whole result unreliable, so
  // the UI can warn instead of presenting a transient error as a real zero.
  let countsReliable = true;
  const cnt = async (jql: string): Promise<number> => {
    const c = await approximateCount(baseUrl, authHeader, jql);
    if (c === null) { countsReliable = false; return 0; }
    return c;
  };

  const team: JiraDevStat = {
    opened: await cnt(`${proj} AND created >= "${from}" AND created <= "${to}"`),
    closed: await cnt(`${proj} AND statusCategory = Done AND resolved >= "${from}" AND resolved <= "${to}"`),
    openNow: await cnt(`${proj} AND statusCategory != Done`),
    updated: await cnt(`${proj} AND updated >= "${from}" AND updated <= "${to}"`),
    hours: 0,
    responseHours: null,
  };

  const accByEmail: Record<string, string | null> = {};
  for (const e of emails) accByEmail[e] = await searchUserAccountId(baseUrl, authHeader, e);

  const perDev: Record<string, JiraDevStat> = {};
  for (const e of emails) {
    const acc = accByEmail[e];
    if (!acc) { perDev[e] = { ...ZERO_STAT }; continue; }
    perDev[e] = {
      opened: await cnt(`reporter = "${acc}" AND ${proj} AND created >= "${from}" AND created <= "${to}"`),
      closed: await cnt(`assignee = "${acc}" AND statusCategory = Done AND resolved >= "${from}" AND resolved <= "${to}"`),
      openNow: await cnt(`assignee = "${acc}" AND statusCategory != Done`),
      updated: await cnt(`assignee = "${acc}" AND updated >= "${from}" AND updated <= "${to}"`),
      hours: 0,
      responseHours: null,
    };
  }

  let partial = false;
  try {
    const { byAccount, total, partial: p } = await worklogHoursByAccount(baseUrl, authHeader, projectKeys, from, to);
    partial = p;
    team.hours = total;
    for (const e of emails) {
      const acc = accByEmail[e];
      if (acc && byAccount[acc] != null) perDev[e].hours = byAccount[acc];
    }
  } catch (err) {
    console.error("Jira worklog-hours aggregation failed:", err);
  }

  // Avg time-to-first-response (creation → first comment/worklog), team + per dev.
  try {
    const { byAccount, team: teamResp, partial: rp } = await firstResponseByAccount(baseUrl, authHeader, projectKeys, from, to);
    partial = partial || rp;
    team.responseHours = teamResp;
    for (const e of emails) {
      const acc = accByEmail[e];
      if (acc && byAccount[acc] != null) perDev[e].responseHours = byAccount[acc];
    }
  } catch (err) {
    console.error("Jira first-response aggregation failed:", err);
  }

  const result: JiraMetrics = { configured: true, partial, countsReliable, team, perDev };
  // Only cache when counts were reliable — don't pin a degraded (error→0) result for 2h.
  if (countsReliable) setCache(cacheKey, result, 120);
  return result;
}
