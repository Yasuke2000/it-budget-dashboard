// What drove the H1-2026 step-up? Compare per-vendor + per-category IT spend
// H2-2025 (Jul-Dec) vs H1-2026 (Jan-May), monthly-averaged, to see if it's
// recurring growth (run-rate valid) or a one-off project (run-rate overstates).
const b = "http://localhost:3000";
const q = "company=all&dateFrom=2025-06-24&dateTo=2026-06-24";
const inv = await (await fetch(b + "/api/invoices?" + q)).json();
const H2 = ["2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12"]; // 6 mo
const H1 = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"];            // 5 mo
const vend = {}, cat = {};
for (const i of inv) {
  if (i.costCategory === "Unclassified" || i.costCategory === "IT Personnel") continue;
  const mo = (i.postingDate || "").slice(0, 7);
  const amt = i.totalAmountExcludingTax || 0;
  const bucket = H2.includes(mo) ? "h2" : H1.includes(mo) ? "h1" : null;
  if (!bucket) continue;
  const v = i.vendorName || "?";
  vend[v] = vend[v] || { h2: 0, h1: 0 };
  vend[v][bucket] += amt;
  cat[i.costCategory] = cat[i.costCategory] || { h2: 0, h1: 0 };
  cat[i.costCategory][bucket] += amt;
}
// monthly averages
const rows = Object.entries(vend).map(([v, d]) => ({ v, h2mo: d.h2 / 6, h1mo: d.h1 / 5, delta: d.h1 / 5 - d.h2 / 6 }))
  .sort((a, b) => b.delta - a.delta);
console.log("TOP MONTHLY-RATE INCREASES (H1-2026 avg/mo vs H2-2025 avg/mo):");
for (const r of rows.slice(0, 12)) console.log(`${r.v.slice(0, 32).padEnd(33)} H2 €${Math.round(r.h2mo).toString().padStart(6)}/mo -> H1 €${Math.round(r.h1mo).toString().padStart(6)}/mo  (+€${Math.round(r.delta)}/mo)`);
console.log("\nBY CATEGORY (avg/mo):");
for (const [c, d] of Object.entries(cat).sort((a, b) => (b[1].h1 / 5 - b[1].h2 / 6) - (a[1].h1 / 5 - a[1].h2 / 6)))
  console.log(`${c.padEnd(28)} H2 €${Math.round(d.h2 / 6).toString().padStart(6)}/mo -> H1 €${Math.round(d.h1 / 5).toString().padStart(6)}/mo`);
