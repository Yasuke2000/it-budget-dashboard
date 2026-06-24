// Derive CONSOLIDATED (external) revenue: total class-70 turnover minus
// intercompany sales (invoices billed to another Gheeraert-group entity).
const T = process.env.BC_TENANT_ID, C = process.env.BC_CLIENT_ID, S = process.env.BC_CLIENT_SECRET;
const ENV = process.env.BC_ENVIRONMENT || "Production";
const BASE = `https://api.businesscentral.dynamics.com/v2.0/${T}/${ENV}/api/v2.0`;
async function token() { const r = await fetch(`https://login.microsoftonline.com/${T}/oauth2/v2.0/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: C, client_secret: S, scope: "https://api.businesscentral.dynamics.com/.default" }) }); return (await r.json()).access_token; }
async function getAll(url, tok) { const out = []; let n = url; while (n) { const r = await fetch(n, { headers: { Authorization: `Bearer ${tok}`, "Data-Access-Intent": "ReadOnly", Accept: "application/json" } }); if (!r.ok) throw new Error(`${r.status}`); const j = await r.json(); out.push(...(j.value || [])); n = j["@odata.nextLink"] || null; } return out; }
const tok = await token();
const companies = (await getAll(`${BASE}/companies?$select=id,displayName`, tok)).filter((c) => !/^_|TEST|test|INIT|OPSTART|FLEETMATE|2025 test/.test(c.displayName));
const INTERCO = /gheeraert|marcel lamberts|\bde rudder\b|trans-?form|warehouse bv|eralimmo|\bgpr\b|\bgss\b|\bgtg\b|\bgtr\b|\btfo\b/i;
const from = "2025-06-24", to = "2026-06-24";

let totalSales = 0, interco = 0, external = 0;
const byCompany = {};
const topIntercoCustomers = {};
for (const co of companies) {
  let invs = [];
  try { invs = await getAll(`${BASE}/companies(${co.id})/salesInvoices?$filter=postingDate ge ${from} and postingDate le ${to}&$select=customerName,totalAmountExcludingTax`, tok); } catch { continue; }
  let coTotal = 0, coInter = 0;
  for (const inv of invs) {
    const amt = Number(inv.totalAmountExcludingTax || 0);
    coTotal += amt;
    if (INTERCO.test(inv.customerName || "")) {
      coInter += amt;
      topIntercoCustomers[inv.customerName] = (topIntercoCustomers[inv.customerName] || 0) + amt;
    }
  }
  byCompany[co.displayName] = { total: Math.round(coTotal), intercompany: Math.round(coInter), external: Math.round(coTotal - coInter) };
  totalSales += coTotal; interco += coInter; external += coTotal - coInter;
}
const itSpend = 917796;
console.log(JSON.stringify({
  salesInvoiceTotal: Math.round(totalSales),
  intercompanyRevenue: Math.round(interco),
  consolidatedExternalRevenue: Math.round(external),
  itSpendPctOfGross: (itSpend / totalSales * 100).toFixed(2) + "%",
  itSpendPctOfConsolidated: (itSpend / external * 100).toFixed(2) + "%",
  byCompany,
  topIntercompanyCustomers: Object.entries(topIntercoCustomers).map(([c, a]) => ({ customer: c, rev: Math.round(a) })).sort((a, b) => b.rev - a.rev).slice(0, 10),
}, null, 2));
