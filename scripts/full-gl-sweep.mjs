// EXHAUSTIVE completeness sweep: account x vendor matrix from ALL purchase-invoice
// lines (12mo, all companies). Surfaces every vendor on an account we do NOT yet
// capture, with sample line descriptions, so each can be classified IT/non-IT.
const T = process.env.BC_TENANT_ID, C = process.env.BC_CLIENT_ID, S = process.env.BC_CLIENT_SECRET;
const ENV = process.env.BC_ENVIRONMENT || "Production";
const BASE = `https://api.businesscentral.dynamics.com/v2.0/${T}/${ENV}/api/v2.0`;
const tr = await fetch(`https://login.microsoftonline.com/${T}/oauth2/v2.0/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: C, client_secret: S, scope: "https://api.businesscentral.dynamics.com/.default" }) });
const tok = (await tr.json()).access_token;
async function getAll(url) { const out = []; let n = url; while (n) { const r = await fetch(n, { headers: { Authorization: `Bearer ${tok}`, "Data-Access-Intent": "ReadOnly" } }); if (!r.ok) break; const j = await r.json(); out.push(...(j.value || [])); n = j["@odata.nextLink"] || null; } return out; }
const cos = (await getAll(`${BASE}/companies?$select=id,displayName`)).filter((c) => !/^_|TEST|test|INIT|OPSTART|FLEETMATE|2025 test/.test(c.displayName));
const from = "2025-06-24", to = "2026-06-24";

const CAPTURED = new Set(["611120", "611130", "612350", "612400", "613320", "240200", "240500", "215000", "211000", "613300", "612300", "615800", "611110"]);
// Structurally non-IT accounts (the expense type IS the account): transport
// subcontracting, fuel, vehicle parts/maintenance, rent, interim staff, all
// payroll/social (class 62), interest, vehicle insurance/claims, km-charge,
// construction-in-progress, utilities, waste. Dropped so the classifier only
// sees accounts that could plausibly hold IT. 614400 (cyber) is KEPT.
function isStructuralNonIT(a) {
  if (/^(603|604|610|617|62|65)/.test(a)) return true;
  return ["601300", "612000", "612100", "612250", "604300", "611100", "611200", "613301", "614000", "614800", "615100", "270000"].includes(a);
}
const INTERCO = /gheeraert|marcel lamberts|de rudder|trans-?form|warehouse bv|eralimmo/i;

// account -> name
const acctName = {};
// "account|vendor" -> {spend, descs:Set}
const cell = {};
const acctTotal = {};
for (const co of cos) {
  // chart of accounts (names)
  for (const a of await getAll(`${BASE}/companies(${co.id})/accounts?$select=number,displayName`)) {
    if (a.number && (!acctName[a.number] || a.displayName?.length > acctName[a.number].length)) acctName[a.number] = a.displayName || "";
  }
  const invs = await getAll(`${BASE}/companies(${co.id})/purchaseInvoices?$filter=postingDate ge ${from} and postingDate le ${to}&$select=vendorName,number&$expand=purchaseInvoiceLines($select=lineType,lineObjectNumber,description,netAmount)`);
  for (const inv of invs) {
    const v = (inv.vendorName || "").trim();
    if (!v || INTERCO.test(v.toUpperCase())) continue;
    for (const ln of inv.purchaseInvoiceLines || []) {
      const acct = ln.lineObjectNumber || "";
      if (!acct || !/^[26]/.test(acct)) continue; // class 2 (assets) + class 6 (opex) only
      const amt = Number(ln.netAmount || 0);
      if (!amt) continue;
      acctTotal[acct] = (acctTotal[acct] || 0) + amt;
      const k = `${acct}|${v}`;
      if (!cell[k]) cell[k] = { spend: 0, descs: new Set() };
      cell[k].spend += amt;
      if (cell[k].descs.size < 3 && ln.description) cell[k].descs.add(ln.description.slice(0, 50));
    }
  }
}

// Build candidate list: vendors on NON-captured accounts, >= €1500/yr
const candidates = [];
for (const [k, d] of Object.entries(cell)) {
  const [acct, vendor] = k.split("|");
  if (CAPTURED.has(acct) || isStructuralNonIT(acct)) continue;
  if (d.spend < 1000) continue;
  candidates.push({ account: acct, accountName: acctName[acct] || "?", vendor, spend: Math.round(d.spend), samples: [...d.descs].slice(0, 2) });
}
candidates.sort((a, b) => b.spend - a.spend);

// Account-level overview (non-captured accounts with material spend)
const acctOverview = Object.entries(acctTotal)
  .filter(([a]) => !CAPTURED.has(a))
  .map(([a, t]) => ({ account: a, name: acctName[a] || "?", total: Math.round(t) }))
  .sort((a, b) => b.total - a.total).slice(0, 40);

const acctOverview2 = Object.entries(acctTotal)
  .filter(([a]) => !CAPTURED.has(a) && !isStructuralNonIT(a))
  .map(([a, t]) => ({ account: a, name: acctName[a] || "?", total: Math.round(t) }))
  .sort((a, b) => b.total - a.total).slice(0, 40);
console.log("CANDIDATE_COUNT", candidates.length);
console.log("CANDIDATES_JSON_START");
console.log(JSON.stringify(candidates));
console.log("CANDIDATES_JSON_END");
console.log("NONCAPTURED_NONSTRUCTURAL_ACCOUNTS");
console.log(JSON.stringify(acctOverview2, null, 2));
