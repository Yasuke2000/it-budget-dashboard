// Verify the Jira response-time KPI (creation → first comment/worklog) is live.
// Run inside the pod: Get-Content scripts/verify-jira-response.mjs -Raw | kubectl exec -i POD -- node --input-type=module -
const b = "http://localhost:3000";
const d = await (await fetch(b + "/api/developers?dateFrom=2025-06-26&dateTo=2026-06-26&branch=dev")).json();
const j = d.jira;
if (!j?.configured) { console.log("jira not configured"); process.exit(0); }
console.log("countsReliable:", j.countsReliable, "partial:", j.partial);
console.log("team.responseHours:", j.team.responseHours, "(team.hours:", j.team.hours + ")");
for (const dev of d.developers) {
  const s = j.perDev[dev.email];
  if (!s) continue;
  console.log(`  ${dev.name}: response=${s.responseHours == null ? "—" : s.responseHours + "h"}  opened=${s.opened} closed=${s.closed} hours=${s.hours}h`);
}
