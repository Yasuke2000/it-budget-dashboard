// Test Jira endpoints for the dev KPIs: user lookup by email + approximate-count. Uses pod env.
const base = (process.env.JIRA_BASE_URL || "").replace(/\/$/, "");
const auth = "Basic " + Buffer.from((process.env.JIRA_EMAIL || "") + ":" + (process.env.JIRA_API_TOKEN || "")).toString("base64");
const H = { Authorization: auth, Accept: "application/json", "Content-Type": "application/json" };
async function get(url) { const r = await fetch(base + url, { headers: H }); return { s: r.status, t: await r.text() }; }
async function count(jql) { const r = await fetch(base + "/rest/api/3/search/approximate-count", { method: "POST", headers: H, body: JSON.stringify({ jql }) }); return { s: r.status, t: await r.text() }; }

// 1. user lookup by email (the 3 commit-author devs)
for (const email of ["peter.gheeraert@gheeraert.be", "jonas.willaeys@gheeraert.be", "stijn.vandamme@gheeraert.be"]) {
  const u = await get("/rest/api/3/user/search?query=" + encodeURIComponent(email));
  let acc = "?"; try { const j = JSON.parse(u.t); acc = (j[0] && (j[0].accountId)) || "(none)"; } catch {}
  console.log("user", email, "->", u.s, "accountId:", acc);
}
// 2. approximate-count for team + a dev sample
const from = "2025-06-24", to = "2026-06-24";
console.log("\napprox-count tests:");
console.log("opened GP+IT:", JSON.stringify(await count(`project in (GP, IT) AND created >= "${from}" AND created <= "${to}"`)));
console.log("open now GP+IT:", JSON.stringify(await count(`project in (GP, IT) AND statusCategory != Done`)));
console.log("closed GP+IT:", JSON.stringify(await count(`project in (GP, IT) AND statusCategory = Done AND resolved >= "${from}" AND resolved <= "${to}"`)));
console.log("updated GP+IT:", JSON.stringify(await count(`project in (GP, IT) AND updated >= "${from}" AND updated <= "${to}"`)));
