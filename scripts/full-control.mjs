// Full live data-control: pull every endpoint, cross-check, flag anomalies.
const b = "http://localhost:3000";
const q = "company=all&dateFrom=2025-06-24&dateTo=2026-06-24";
const flags = [];
const ok = (c, msg) => { console.log((c ? "OK  " : "FLAG") + " " + msg); if (!c) flags.push(msg); };
const J = async (u) => { try { const r = await fetch(b + u); return { s: r.status, d: await r.json() }; } catch (e) { return { s: 0, d: null, e: String(e) }; } };

// 1. DASHBOARD
const dash = await J("/api/dashboard?" + q); const k = dash.d?.kpis || {};
console.log("\n== DASHBOARD =="); console.log("status", dash.s);
const cats = dash.d?.categories || [], vend = dash.d?.vendors || [], monthly = dash.d?.monthly || [];
const catSum = Math.round(cats.reduce((s, c) => s + c.amount, 0));
ok(Math.abs(catSum - Math.round(k.totalSpendYTD)) <= 2, `categories sum ${catSum} == spend ${Math.round(k.totalSpendYTD)}`);
ok(k.totalCostOfIT === Math.round(k.totalSpendYTD) + k.itPersonnelCost, `totalCostOfIT ${k.totalCostOfIT} == spend+personnel`);
ok(Math.abs((k.opexYTD + k.capexYTD) - Math.round(k.totalSpendYTD)) <= 3, `opex+capex ${k.opexYTD + k.capexYTD} == spend`);
ok(k.itSpendPercentOfRevenue > 0 && k.itSpendPercentOfRevenue < 5, `IT%rev sane: ${k.itSpendPercentOfRevenue?.toFixed(2)}%`);
ok(k.itPersonnelCost > 0, `personnel cost present: ${k.itPersonnelCost}`);
ok(k.overdueAmount <= k.openInvoiceAmount, `overdue ${k.overdueAmount} <= open ${k.openInvoiceAmount}`);
ok(cats.every((c) => c.amount >= 0), "no negative category");
ok(vend.every((v) => v.totalSpend >= 0), "no negative vendor spend");
ok(!cats.some((c) => /unclassified/i.test(c.category)), "no Unclassified leaking into categories");
const topVendorPct = vend[0]?.percentOfTotal || 0;
ok(topVendorPct < 35, `top vendor concentration ${topVendorPct?.toFixed(1)}% (<35 watch)`);
console.log("revenueConsolidated:", k.revenueIsConsolidated, "trendReliable:", k.spendTrendReliable, "months:", monthly.length, "devices:", k.deviceCount, "licUtil:", k.licenseUtilizationPercent?.toFixed(0) + "%");

// 2. INVOICES
const inv = await J("/api/invoices?" + q);
const rows = Array.isArray(inv.d) ? inv.d : [];
const neg = rows.filter((r) => (r.totalAmountExcludingTax || 0) < 0).length;
const unclass = rows.filter((r) => r.costCategory === "Unclassified").length;
const interco = rows.filter((r) => /gheeraert|de rudder|warehouse bv|lamberts|trans-?form/i.test(r.vendorName || "")).length;
console.log("\n== INVOICES =="); console.log("rows", rows.length, "| negative", neg, "| unclassified", unclass, "| intercompany-named", interco);
ok(interco === 0, `no intercompany vendor leaked into IT invoices (found ${interco})`);
ok(rows.length > 0, "invoices present");

// 3. LICENSES + SAVINGS
const lic = await J("/api/licenses"); const lrows = Array.isArray(lic.d) ? lic.d : [];
const badUtil = lrows.filter((l) => l.utilizationRate > 100 || l.utilizationRate < 0).length;
console.log("\n== LICENSES =="); console.log("skus", lrows.length, "| util-out-of-range", badUtil, "| priced", lrows.filter((l) => l.pricePerUser > 0).length);
ok(badUtil === 0, `no util% out of range (found ${badUtil})`);
const sav = await J("/api/savings");
console.log("savings harvest:", JSON.stringify(sav.d?.harvest || sav.d).slice(0, 160));

// 4. DEVELOPERS + ROI + JIRA
const dev = await J("/api/developers?dateFrom=2025-06-24&dateTo=2026-06-24&branch=dev");
console.log("\n== DEVELOPERS =="); console.log("configured", dev.d?.configured, "commits", dev.d?.totalCommits, "issues", dev.d?.totalIssues, "devs", dev.d?.developerCount);
const allphi = vend.find((v) => /allphi/i.test(v.vendorName));
const jonasRoi = (dev.d?.roi || []).find((r) => /jonas/i.test(r.name));
ok(allphi && jonasRoi && Math.round(allphi.totalSpend) === jonasRoi.periodCost, `ALLPHI ${allphi ? Math.round(allphi.totalSpend) : "?"} == Jonas ROI ${jonasRoi?.periodCost}`);
ok(dev.d?.jira?.configured, "jira configured");
console.log("jira team:", JSON.stringify(dev.d?.jira?.team));

// 5. OTHER ENDPOINTS
for (const ep of ["/api/personnel", "/api/devices", "/api/contracts", "/api/budget?" + q, "/api/status", "/api/insights"]) {
  const r = await J(ep);
  const sz = Array.isArray(r.d) ? r.d.length : (r.d ? Object.keys(r.d).length : 0);
  console.log(`  ${ep.split("?")[0]} -> ${r.s} (size ${sz})`);
  if (r.s !== 200) flags.push(`${ep} returned ${r.s}`);
}

// 6. PERIOD RECONCILIATION: year vs sum of 4 quarters (tools spend)
console.log("\n== PERIOD RECONCILIATION ==");
const quarters = [["2025-07-01", "2025-09-30"], ["2025-10-01", "2025-12-31"], ["2026-01-01", "2026-03-31"], ["2026-04-01", "2026-06-30"]];
let qSum = 0;
for (const [f, t] of quarters) { const d = await J(`/api/dashboard?company=all&dateFrom=${f}&dateTo=${t}`); qSum += d.d?.kpis?.totalSpendYTD || 0; }
const yr = await J("/api/dashboard?company=all&dateFrom=2025-07-01&dateTo=2026-06-30");
const yrTot = yr.d?.kpis?.totalSpendYTD || 0;
console.log("sum of 4 quarters:", Math.round(qSum), "| full year:", Math.round(yrTot), "| diff:", Math.round(qSum - yrTot), `(${(Math.abs(qSum - yrTot) / yrTot * 100).toFixed(2)}%)`);
ok(Math.abs(qSum - yrTot) / yrTot < 0.02, "year ≈ sum of quarters (<2%)");

console.log("\n==== FLAGS (" + flags.length + ") ====");
for (const f of flags) console.log(" -", f);
