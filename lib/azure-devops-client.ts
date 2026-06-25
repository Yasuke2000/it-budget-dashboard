// Azure DevOps client — developer-productivity metrics for the Portal repo.
// Auth: Personal Access Token via Basic auth (base64 of ":" + PAT). Verified
// 2026-06-24 against org "petergheeraert", project/repo "my.gheeraert.be".
//
// IMPORTANT data limitation (confirmed live): the Git Commits API exposes
// changeCounts at FILE level (Add/Edit/Delete) only — there is NO line-added/
// deleted figure. Exact lines would require diffing every commit's blobs
// (hundreds of calls), so this client reports accurate FILE-level churn and the
// dashboard labels lines as unavailable rather than guessing.

import { fetchWithRetry } from "./http";
import { getCache, setCache } from "./sync-cache";
import type {
  DeveloperDashboard,
  DeveloperStat,
  BranchStat,
  DevCommit,
  FileChurn,
} from "./types";

const ORG = process.env.AZURE_DEVOPS_ORG;
const PAT = process.env.AZURE_DEVOPS_PAT;
const PROJECT = process.env.AZURE_DEVOPS_PROJECT || "my.gheeraert.be";
const REPO = process.env.AZURE_DEVOPS_REPO || "my.gheeraert.be";
// Integration branch the team commits to (used for totals/per-dev/churn). master
// is tracked separately for branch stats. Override via env if the repo differs.
const PRIMARY_BRANCH = process.env.AZURE_DEVOPS_PRIMARY_BRANCH || "develop";
const TRACKED_BRANCHES = (process.env.AZURE_DEVOPS_BRANCHES || "develop,master").split(",").map((s) => s.trim()).filter(Boolean);
const API = "api-version=7.1";

export function isDevOpsConfigured(): boolean {
  return Boolean(ORG && PAT);
}

function authHeaders(): Record<string, string> {
  return { Authorization: "Basic " + Buffer.from(":" + (PAT || "")).toString("base64"), Accept: "application/json" };
}

async function ado<T>(path: string): Promise<T | null> {
  if (!isDevOpsConfigured()) return null;
  const url = `https://dev.azure.com/${ORG}${path}`;
  try {
    const res = await fetchWithRetry(url, { headers: authHeaders() }, { timeoutMs: 30_000, maxAttempts: 2 });
    if (!res.ok) { console.warn(`Azure DevOps ${res.status} on ${path}`); return null; }
    return (await res.json()) as T;
  } catch (e) {
    console.warn("Azure DevOps fetch error:", e);
    return null;
  }
}

interface RawCommit {
  commitId: string;
  author?: { name?: string; email?: string; date?: string };
  comment?: string;
  changeCounts?: { Add?: number; Edit?: number; Delete?: number };
}

// Resolve the repository id (cached) from the configured project + repo name.
async function getRepoId(): Promise<string | null> {
  const cacheKey = `ado-repoid-${PROJECT}-${REPO}`;
  const cached = getCache<string>(cacheKey);
  if (cached) return cached;
  const data = await ado<{ value?: { id: string; name: string }[] }>(`/${encodeURIComponent(PROJECT)}/_apis/git/repositories?${API}`);
  const repo = data?.value?.find((r) => r.name.toLowerCase() === REPO.toLowerCase()) || data?.value?.[0];
  if (repo) setCache(cacheKey, repo.id, 1440); // 24h
  return repo?.id ?? null;
}

// All commits on a branch within [from,to], paginated.
async function fetchCommits(repoId: string, branch: string, from: string, to: string): Promise<RawCommit[]> {
  const out: RawCommit[] = [];
  const TOP = 100;
  for (let skip = 0; skip < 5000; skip += TOP) {
    const qs = `searchCriteria.itemVersion.version=${encodeURIComponent(branch)}` +
      `&searchCriteria.fromDate=${encodeURIComponent(from)}&searchCriteria.toDate=${encodeURIComponent(to)}` +
      `&searchCriteria.$top=${TOP}&searchCriteria.$skip=${skip}&${API}`;
    const data = await ado<{ value?: RawCommit[] }>(`/${encodeURIComponent(PROJECT)}/_apis/git/repositories/${repoId}/commits?${qs}`);
    const rows = data?.value || [];
    out.push(...rows);
    if (rows.length < TOP) break;
  }
  return out;
}

const filesIn = (c: RawCommit) => (c.changeCounts?.Add || 0) + (c.changeCounts?.Edit || 0) + (c.changeCounts?.Delete || 0);

// Most-changed files (churn) across a bounded set of commits (caps the per-commit
// /changes calls). Returns top files by change frequency + contributors.
async function computeChurn(repoId: string, commits: RawCommit[], cap: number): Promise<FileChurn[]> {
  const slice = commits.slice(0, cap);
  const byFile = new Map<string, { changes: number; contributors: Set<string> }>();
  const CONCURRENCY = 5;
  for (let i = 0; i < slice.length; i += CONCURRENCY) {
    const batch = slice.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((c) => ado<{ changes?: { item?: { path?: string; isFolder?: boolean }; changeType?: string }[] }>(
        `/${encodeURIComponent(PROJECT)}/_apis/git/repositories/${repoId}/commits/${c.commitId}/changes?${API}`
      ).then((d) => ({ commit: c, changes: d?.changes || [] })))
    );
    for (const { commit, changes } of results) {
      const who = commit.author?.name || commit.author?.email || "?";
      for (const ch of changes) {
        const path = ch.item?.path;
        if (!path || ch.item?.isFolder) continue;
        const e = byFile.get(path) || { changes: 0, contributors: new Set<string>() };
        e.changes += 1; e.contributors.add(who);
        byFile.set(path, e);
      }
    }
  }
  return [...byFile.entries()]
    .map(([path, e]) => ({ path: path.replace(/^\//, ""), changes: e.changes, contributors: [...e.contributors] }))
    .sort((a, b) => b.changes - a.changes)
    .slice(0, 10);
}

export async function getDeveloperDashboard(dateFrom: string, dateTo: string, primaryBranch: string = PRIMARY_BRANCH): Promise<DeveloperDashboard> {
  const empty: DeveloperDashboard = {
    configured: isDevOpsConfigured(), org: ORG, project: PROJECT, repo: REPO,
    rangeFrom: dateFrom, rangeTo: dateTo, totalCommits: 0, developerCount: 0,
    totalFilesChanged: 0, filesAdded: 0, filesEdited: 0, filesDeleted: 0,
    developers: [], branches: [], recentCommits: [], churn: [],
    avgFilesPerCommit: 0, smallCommits: 0, largeCommits: 0,
    notes: ["Lines added/deleted are not exposed by the Azure DevOps API — metrics are file-level (accurate)."],
  };
  if (!isDevOpsConfigured()) return empty;
  const cacheKey = `ado-dashboard-${primaryBranch}-${dateFrom}-${dateTo}`;
  const cached = getCache<DeveloperDashboard>(cacheKey);
  if (cached) return cached;

  const repoId = await getRepoId();
  if (!repoId) return { ...empty, notes: [...empty.notes, "Repository not found / not accessible."] };

  // Primary branch (dev=develop / production=master) drives totals/per-dev/churn;
  // other tracked branches → counts only.
  const primary = await fetchCommits(repoId, primaryBranch, dateFrom, dateTo);

  // Per-developer aggregation.
  const devMap = new Map<string, DeveloperStat & { _addedFiles: number }>();
  let filesAdded = 0, filesEdited = 0, filesDeleted = 0, smallCommits = 0, largeCommits = 0;
  for (const c of primary) {
    const email = c.author?.email || c.author?.name || "?";
    const name = c.author?.name || email;
    const add = c.changeCounts?.Add || 0, edit = c.changeCounts?.Edit || 0, del = c.changeCounts?.Delete || 0;
    filesAdded += add; filesEdited += edit; filesDeleted += del;
    const f = add + edit + del;
    if (f <= 3) smallCommits++; if (f >= 20) largeCommits++;
    const d = devMap.get(email) || { name, email, commits: 0, filesAdded: 0, filesEdited: 0, filesDeleted: 0, filesChanged: 0, avgFilesPerCommit: 0, contributionPercent: 0, _addedFiles: 0 };
    d.commits += 1; d.filesAdded += add; d.filesEdited += edit; d.filesDeleted += del; d.filesChanged += f;
    devMap.set(email, d);
  }
  const totalCommits = primary.length;
  const developers: DeveloperStat[] = [...devMap.values()].map((d) => ({
    name: d.name, email: d.email, commits: d.commits,
    filesAdded: d.filesAdded, filesEdited: d.filesEdited, filesDeleted: d.filesDeleted, filesChanged: d.filesChanged,
    avgFilesPerCommit: d.commits ? Math.round((d.filesChanged / d.commits) * 10) / 10 : 0,
    contributionPercent: totalCommits ? Math.round((d.commits / totalCommits) * 1000) / 10 : 0,
  })).sort((a, b) => b.commits - a.commits);

  // Branch stats (commit count + last activity in window) for each tracked branch.
  const branches: BranchStat[] = [];
  for (const b of TRACKED_BRANCHES) {
    const commits = b === primaryBranch ? primary : await fetchCommits(repoId, b, dateFrom, dateTo);
    const dates = commits.map((c) => c.author?.date).filter(Boolean) as string[];
    branches.push({ name: b, commits: commits.length, lastActivity: dates.length ? dates.sort().slice(-1)[0] : null });
  }

  // Recent commits (primary branch, newest first).
  const recentCommits: DevCommit[] = [...primary]
    .sort((a, b) => (b.author?.date || "").localeCompare(a.author?.date || ""))
    .slice(0, 15)
    .map((c) => ({
      id: c.commitId.slice(0, 8), author: c.author?.name || "?", email: c.author?.email || "",
      branch: primaryBranch, message: (c.comment || "").split("\n")[0].slice(0, 90), date: c.author?.date || "",
      filesChanged: filesIn(c),
    }));

  // Churn (bounded).
  const churn = await computeChurn(repoId, [...primary].sort((a, b) => (b.author?.date || "").localeCompare(a.author?.date || "")), 80);

  const totalFiles = filesAdded + filesEdited + filesDeleted;
  const result: DeveloperDashboard = {
    configured: true, org: ORG, project: PROJECT, repo: REPO, rangeFrom: dateFrom, rangeTo: dateTo,
    totalCommits, developerCount: developers.length, totalFilesChanged: totalFiles,
    filesAdded, filesEdited, filesDeleted, developers, branches, recentCommits, churn,
    avgFilesPerCommit: totalCommits ? Math.round((totalFiles / totalCommits) * 10) / 10 : 0,
    smallCommits, largeCommits,
    notes: [
      `Commits counted on the "${primaryBranch}" branch; commits on other branches not merged into it are excluded.`,
      "Lines added/deleted are not exposed by the Azure DevOps API — metrics are file-level (accurate). Churn sampled from the 80 most recent commits.",
    ],
  };
  setCache(cacheKey, result, 60); // 1h
  return result;
}
