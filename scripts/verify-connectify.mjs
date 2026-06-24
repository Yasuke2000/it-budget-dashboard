const T = process.env.BC_TENANT_ID, C = process.env.BC_CLIENT_ID, S = process.env.BC_CLIENT_SECRET;
const ENV = process.env.BC_ENVIRONMENT || "Production";
const BASE = `https://api.businesscentral.dynamics.com/v2.0/${T}/${ENV}/api/v2.0`;
const tr = await fetch(`https://login.microsoftonline.com/${T}/oauth2/v2.0/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: C, client_secret: S, scope: "https://api.businesscentral.dynamics.com/.default" }) });
const tok = (await tr.json()).access_token;
async function getAll(url) { const out = []; let n = url; while (n) { const r = await fetch(n, { headers: { Authorization: `Bearer ${tok}`, "Data-Access-Intent": "ReadOnly" } }); if (!r.ok) break; const j = await r.json(); out.push(...(j.value || [])); n = j["@odata.nextLink"] || null; } return out; }
const cos = (await getAll(`${BASE}/companies?$select=id,displayName`)).filter((c) => !/^_|TEST|test|INIT|OPSTART|FLEETMATE|2025 test/.test(c.displayName));
const from = "2025-06-24", to = "2026-06-24";

// ---- A. CONNECTIFY: is it anywhere in purchases? which accounts? ----
const connAcc = {}; let connTotal = 0; const connInvs = [];
// ---- B. TELENET dup/ground-truth check ----
const telNumbers = new Set(); let telRecords = 0; let telHeaderSum = 0;
// ---- C. JUST-FIX-IT exact vendor name strings ----
const jfiNames = {};
for (const co of cos) {
  const invs = await getAll(`${BASE}/companies(${co.id})/purchaseInvoices?$filter=postingDate ge ${from} and postingDate le ${to}&$select=vendorName,number,totalAmountExcludingTax&$expand=purchaseInvoiceLines($select=lineType,lineObjectNumber,description,netAmount)`);
  for (const inv of invs) {
    const vU = (inv.vendorName || "").toUpperCase();
    if (vU.includes("CONNECTIF")) {
      connTotal += Number(inv.totalAmountExcludingTax || 0);
      connInvs.push({ co: co.displayName, name: inv.vendorName, num: inv.number, amt: Math.round(Number(inv.totalAmountExcludingTax || 0)) });
      for (const ln of inv.purchaseInvoiceLines || []) { const a = ln.lineObjectNumber || `(${ln.lineType})`; connAcc[a] = (connAcc[a] || 0) + Number(ln.netAmount || 0); }
    }
    if (vU.includes("TELENET")) { telRecords++; telNumbers.add(inv.number); telHeaderSum += Number(inv.totalAmountExcludingTax || 0); }
    if (vU.includes("FIX IT") || vU.includes("FIX-IT") || vU.includes("JUST -FIX")) { jfiNames[inv.vendorName] = (jfiNames[inv.vendorName] || 0) + Number(inv.totalAmountExcludingTax || 0); }
  }
}
// Telenet GL ground truth: debit-credit on 612400 for Telenet's documentNumbers
let telGL = 0; const telDocs = telNumbers;
for (const co of cos) {
  const gl = await getAll(`${BASE}/companies(${co.id})/generalLedgerEntries?$filter=postingDate ge ${from} and postingDate le ${to} and accountNumber eq '612400'&$select=documentNumber,debitAmount,creditAmount`);
  for (const e of gl) { if (telDocs.has(e.documentNumber)) telGL += (Number(e.debitAmount || 0) - Number(e.creditAmount || 0)); }
}
console.log(JSON.stringify({
  connectify: { foundInPurchases: connInvs.length > 0, totalExclTax: Math.round(connTotal), accounts: Object.entries(connAcc).map(([a, v]) => ({ account: a, spend: Math.round(v) })), invoices: connInvs.slice(0, 12) },
  telenetCheck: { distinctInvoiceNumbers: telNumbers.size, recordsReturned: telRecords, headerSumExclTax: Math.round(telHeaderSum), glDebitMinusCredit_612400: Math.round(telGL), note: "if records==distinct and glDebitMinusCredit==headerSum, dashboard's lower figure is the artifact; if gl==dashboard, my line-sweep doubled" },
  justFixItExactNames: jfiNames,
}, null, 2));
