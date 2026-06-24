// True GL debit-credit per vendor on candidate "leak" accounts, to size the
// coverage gap and decide what to allowlist. Joins GL doc -> purchase-invoice header.
const T = process.env.BC_TENANT_ID, C = process.env.BC_CLIENT_ID, S = process.env.BC_CLIENT_SECRET;
const ENV = process.env.BC_ENVIRONMENT || "Production";
const BASE = `https://api.businesscentral.dynamics.com/v2.0/${T}/${ENV}/api/v2.0`;
const tr = await fetch(`https://login.microsoftonline.com/${T}/oauth2/v2.0/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: C, client_secret: S, scope: "https://api.businesscentral.dynamics.com/.default" }) });
const tok = (await tr.json()).access_token;
async function getAll(url) { const out = []; let n = url; while (n) { const r = await fetch(n, { headers: { Authorization: `Bearer ${tok}`, "Data-Access-Intent": "ReadOnly" } }); if (!r.ok) break; const j = await r.json(); out.push(...(j.value || [])); n = j["@odata.nextLink"] || null; } return out; }
const cos = (await getAll(`${BASE}/companies?$select=id,displayName`)).filter((c) => !/^_|TEST|test|INIT|OPSTART|FLEETMATE|2025 test/.test(c.displayName));
const from = "2025-06-24", to = "2026-06-24";
const ACCTS = ["611110", "614400", "613300", "611200"]; // candidates + 611200 (vehicle, expect non-IT)
const result = {};
for (const acct of ACCTS) result[acct] = {};
const headerPad = "2025-04-01"; // pad for boundary docs
for (const co of cos) {
  const headers = await getAll(`${BASE}/companies(${co.id})/purchaseInvoices?$filter=postingDate ge ${headerPad} and postingDate le 2026-08-31&$select=number,vendorName`);
  const byDoc = new Map();
  for (const h of headers) byDoc.set(h.number, h.vendorName || "");
  for (const acct of ACCTS) {
    const gl = await getAll(`${BASE}/companies(${co.id})/generalLedgerEntries?$filter=postingDate ge ${from} and postingDate le ${to} and accountNumber eq '${acct}'&$select=documentNumber,description,debitAmount,creditAmount`);
    for (const e of gl) {
      const amt = Number(e.debitAmount || 0) - Number(e.creditAmount || 0);
      if (!amt) continue;
      const v = byDoc.get(e.documentNumber) || `[no-header: ${e.description || ""}]`;
      result[acct][v] = (result[acct][v] || 0) + amt;
    }
  }
}
const INTERCO = /gheeraert|marcel lamberts|de rudder|trans-?form|warehouse bv|eralimmo/i;
const out = {};
for (const acct of ACCTS) {
  const rows = Object.entries(result[acct]).filter(([v]) => !INTERCO.test(v)).map(([v, a]) => ({ vendor: v.slice(0, 45), net: Math.round(a) })).sort((a, b) => b.net - a.net);
  out[acct] = { accountTotalNonInterco: Math.round(rows.reduce((s, r) => s + r.net, 0)), top: rows.slice(0, 12) };
}
console.log(JSON.stringify(out, null, 2));
