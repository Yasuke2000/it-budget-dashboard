// Group revenue (turnover) for the IT-spend-as-%-of-revenue benchmark.
// Belgian PCMN: class 70 = "Omzet / Turnover" (revenue), posted as credits.
const T = process.env.BC_TENANT_ID, C = process.env.BC_CLIENT_ID, S = process.env.BC_CLIENT_SECRET;
const ENV = process.env.BC_ENVIRONMENT || "Production";
const BASE = `https://api.businesscentral.dynamics.com/v2.0/${T}/${ENV}/api/v2.0`;
async function token() {
  const r = await fetch(`https://login.microsoftonline.com/${T}/oauth2/v2.0/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: C, client_secret: S, scope: "https://api.businesscentral.dynamics.com/.default" }) });
  return (await r.json()).access_token;
}
async function getAll(url, tok) { const out = []; let n = url; while (n) { const r = await fetch(n, { headers: { Authorization: `Bearer ${tok}`, "Data-Access-Intent": "ReadOnly", Accept: "application/json" } }); if (!r.ok) throw new Error(r.status); const j = await r.json(); out.push(...(j.value || [])); n = j["@odata.nextLink"] || null; } return out; }
const tok = await token();
const companies = (await getAll(`${BASE}/companies?$select=id,displayName`, tok)).filter((c) => !/^_|TEST|test|INIT|OPSTART|FLEETMATE|2025 test/.test(c.displayName));
const from = "2025-06-23", to = "2026-06-23";
let revenue = 0; const byCo = {};
for (const co of companies) {
  let gl = [];
  try { gl = await getAll(`${BASE}/companies(${co.id})/generalLedgerEntries?$filter=postingDate ge ${from} and postingDate le ${to} and startswith(accountNumber,'70')&$select=debitAmount,creditAmount`, tok); } catch {}
  // Revenue = credits − debits on class 70 (credit-normal).
  const rev = gl.reduce((s, e) => s + (Number(e.creditAmount || 0) - Number(e.debitAmount || 0)), 0);
  byCo[co.displayName] = Math.round(rev); revenue += rev;
}
console.log(JSON.stringify({ groupRevenue12mo: Math.round(revenue), byCompany: byCo, itSpend: 797669, itAsPctOfRevenue: Math.round(797669 / revenue * 10000) / 100 }, null, 2));
