// Is there usable prior-year IT data in BC to support a seasonality-proof
// year-over-year trend? Compare current 12-mo IT spend to the prior 12 months.
const b = "http://localhost:3000";
async function itTotal(from, to) {
  const inv = await (await fetch(`${b}/api/invoices?company=all&dateFrom=${from}&dateTo=${to}`)).json();
  let t = 0, n = 0;
  const byMonth = {};
  for (const i of inv) {
    if (i.costCategory === "Unclassified" || i.costCategory === "IT Personnel") continue;
    t += i.totalAmountExcludingTax || 0; n++;
    const m = (i.postingDate || "").slice(0, 7);
    byMonth[m] = (byMonth[m] || 0) + (i.totalAmountExcludingTax || 0);
  }
  return { total: Math.round(t), count: n, months: Object.keys(byMonth).sort().map((m) => `${m}:${Math.round(byMonth[m] / 1000)}k`) };
}
const cur = await itTotal("2025-06-24", "2026-06-24");
const prev = await itTotal("2024-06-24", "2025-06-24");
console.log("CURRENT (2025-06-24..2026-06-24): total", cur.total, "invoices", cur.count);
console.log("PRIOR   (2024-06-24..2025-06-24): total", prev.total, "invoices", prev.count);
console.log("YoY change:", prev.total > 0 ? (((cur.total - prev.total) / prev.total) * 100).toFixed(1) + "%" : "n/a (no prior data)");
console.log("\nprior-year months:", prev.months.join(" "));
