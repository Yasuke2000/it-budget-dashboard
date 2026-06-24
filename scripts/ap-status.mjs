// Feasibility probe: do BC purchase-invoice headers carry a usable paid/open
// status + due date we can surface for IT invoices (accounts payable)?
const T = process.env.BC_TENANT_ID, C = process.env.BC_CLIENT_ID, S = process.env.BC_CLIENT_SECRET;
const ENV = process.env.BC_ENVIRONMENT || "Production";
const BASE = `https://api.businesscentral.dynamics.com/v2.0/${T}/${ENV}/api/v2.0`;
const tr = await fetch(`https://login.microsoftonline.com/${T}/oauth2/v2.0/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: C, client_secret: S, scope: "https://api.businesscentral.dynamics.com/.default" }) });
const tok = (await tr.json()).access_token;
async function getAll(url) { const out = []; let n = url; while (n) { const r = await fetch(n, { headers: { Authorization: `Bearer ${tok}`, "Data-Access-Intent": "ReadOnly" } }); if (!r.ok) { console.error("ERR", r.status, (await r.text()).slice(0, 200)); break; } const j = await r.json(); out.push(...(j.value || [])); n = j["@odata.nextLink"] || null; } return out; }
const cos = (await getAll(`${BASE}/companies?$select=id,displayName`)).filter((c) => !/^_|TEST|test|INIT|OPSTART|FLEETMATE|2025 test/.test(c.displayName));
const from = "2025-06-24", to = "2026-06-24";
const IT = /easi|allphi|gmi|idocta|canon|micro\s?soft|connectif|just .?fix|eurotracs|telenet|proximus|orange|transics|\bptv\b|fleetmate|doo-?it|csw|nts comput|tradeshift|bright analytic|citymesh|destiny/i;

// 1. Confirm the status field exists + its value distribution (one company sample).
const sample = await getAll(`${BASE}/companies(${cos[0].id})/purchaseInvoices?$top=5&$select=number,vendorName,status,dueDate,totalAmountIncludingTax,remainingAmount`).catch(() => null);
console.log("SAMPLE FIELDS (first company, 5 rows):");
console.log(JSON.stringify(sample, null, 2));

// 2. IT-vendor AP summary across all companies: open vs paid, with overdue.
const today = "2026-06-24";
let openCount = 0, openAmt = 0, paidCount = 0, paidAmt = 0, overdueAmt = 0;
const statusValues = {};
const openList = [];
for (const co of cos) {
  const invs = await getAll(`${BASE}/companies(${co.id})/purchaseInvoices?$filter=postingDate ge ${from} and postingDate le ${to}&$select=number,vendorName,status,dueDate,totalAmountIncludingTax`).catch(() => []);
  for (const inv of invs) {
    if (!IT.test(inv.vendorName || "")) continue;
    const st = inv.status || "?";
    statusValues[st] = (statusValues[st] || 0) + 1;
    const amt = Number(inv.totalAmountIncludingTax || 0);
    if (st === "Paid") { paidCount++; paidAmt += amt; }
    else { openCount++; openAmt += amt; if (inv.dueDate && inv.dueDate < today) overdueAmt += amt; openList.push({ co: co.displayName, vendor: inv.vendorName, num: inv.number, due: inv.dueDate, amt: Math.round(amt), st }); }
  }
}
console.log("\nIT-VENDOR AP SUMMARY:");
console.log(JSON.stringify({ statusValuesSeen: statusValues, open: { count: openCount, amountInclTax: Math.round(openAmt), overdueInclTax: Math.round(overdueAmt) }, paid: { count: paidCount, amountInclTax: Math.round(paidAmt) }, openTop: openList.sort((a, b) => b.amt - a.amt).slice(0, 15) }, null, 2));
