const b = "http://localhost:3000";
const d = await (await fetch(b + "/api/developers?dateFrom=2025-06-24&dateTo=2026-06-24&branch=dev")).json();
console.log("totalIssues:", d.totalIssues, "| itDeptPayroll(period):", d.itDeptPayrollPeriod);
console.log("ROI rows:");
for (const r of (d.roi || [])) {
  console.log(`  ${r.name} | commits ${r.commits} issues ${r.issues} | cost ${r.periodCost} | /commit ${r.costPerCommit} | /issue ${r.costPerIssue} | ${r.costLabel}`);
}
