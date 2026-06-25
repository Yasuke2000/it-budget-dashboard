const b = "http://localhost:3000";
const d = await (await fetch(b + "/api/developers?dateFrom=2026-06-17&dateTo=2026-06-24")).json();
console.log("configured:", d.configured, "| commits:", d.totalCommits, "| devs:", d.developerCount, "| filesChanged:", d.totalFilesChanged, "| avgFiles/commit:", d.avgFilesPerCommit);
console.log("developers:", JSON.stringify((d.developers || []).map((x) => ({ n: x.name, c: x.commits, pct: x.contributionPercent, files: x.filesChanged }))));
console.log("branches:", JSON.stringify((d.branches || []).map((x) => ({ b: x.name, c: x.commits }))));
console.log("recent[0..2]:", JSON.stringify((d.recentCommits || []).slice(0, 3).map((x) => ({ a: x.author, m: x.message.slice(0, 30) }))));
console.log("churn top3:", JSON.stringify((d.churn || []).slice(0, 3).map((x) => ({ f: x.path.split("/").slice(-1)[0], ch: x.changes }))));
