const b = "http://localhost:3000";
// 1. core totals unchanged
const k = (await (await fetch(b + "/api/dashboard?company=all&dateFrom=2025-06-24&dateTo=2026-06-24")).json()).kpis;
console.log("spend", Math.round(k.totalSpendYTD), "personnel", k.itPersonnelCost, "totalCostOfIT", k.totalCostOfIT, "%rev", k.itSpendPercentOfRevenue.toFixed(2));
// 2. forecast default + scenario
const f0 = await (await fetch(b + "/api/forecast?company=all")).json();
const f1 = await (await fetch(b + "/api/forecast?company=all&growthPct=10&extraMonthly=2000")).json();
console.log("forecast default annual:", f0.annualForecast, "budget:", f0.annualBudget, "points:", f0.points.length);
console.log("forecast +10%/+2k annual:", f1.annualForecast, "(delta", f1.annualForecast - f0.annualForecast, ")");
// 3. status: jira/ado probed, officient honest
const s = (await (await fetch(b + "/api/status")).json()).services;
console.log("status jira:", JSON.stringify(s.jira), "ado:", JSON.stringify(s.azureDevops), "officient:", JSON.stringify(s.officient));
// 4. insights respects company (group vs single)
const iAll = await (await fetch(b + "/api/insights?company=all")).json();
console.log("insights(all):", Array.isArray(iAll) ? iAll.length : "n/a");
// 5. dev dashboard flags present
const d = await (await fetch(b + "/api/developers?dateFrom=2025-06-24&dateTo=2026-06-24&branch=dev")).json();
console.log("dev commitsTruncated:", d.commitsTruncated, "churnSampled:", d.churnSampled, "jira.countsReliable:", d.jira?.countsReliable);
