// Verify Jira connectivity from the pod's own env (no creds written anywhere).
const base = process.env.JIRA_BASE_URL || "";
const email = process.env.JIRA_EMAIL || "";
const token = process.env.JIRA_API_TOKEN || "";
console.log("env present -> base:", !!base, "email:", !!email, "token:", !!token);
if (base && email && token) {
  const auth = "Basic " + Buffer.from(email + ":" + token).toString("base64");
  const me = await fetch(base + "/rest/api/3/myself", { headers: { Authorization: auth, Accept: "application/json" } });
  const mj = await me.json().catch(() => ({}));
  console.log("/myself ->", me.status, "displayName:", mj.displayName, "accountId:", (mj.accountId || "").slice(0, 16));
  const pr = await fetch(base + "/rest/api/3/project/search?maxResults=10", { headers: { Authorization: auth, Accept: "application/json" } });
  const pj = await pr.json().catch(() => ({}));
  console.log("/project/search ->", pr.status, "total:", pj.total, "projects:", JSON.stringify((pj.values || []).map((p) => `${p.key}:${p.name}`)));
} else {
  console.log("Jira env not fully set in pod");
}
