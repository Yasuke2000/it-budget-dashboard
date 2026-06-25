const b = "http://localhost:3000";
const d = await (await fetch(b + "/api/developers?dateFrom=2025-06-24&dateTo=2026-06-24&branch=dev")).json();
const j = d.jira;
if (!j) { console.log("NO jira section in response"); }
else {
  console.log("jira.configured:", j.configured, "| partial:", j.partial);
  console.log("TEAM:", JSON.stringify(j.team));
  for (const dev of d.developers) {
    const s = j.perDev[dev.email] || {};
    console.log(`  ${dev.name}: opened ${s.opened} closed ${s.closed} open ${s.openNow} updated ${s.updated} hours ${s.hours}`);
  }
}
