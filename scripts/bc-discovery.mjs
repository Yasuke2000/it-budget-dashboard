// BC discovery v5 — ALLPHI breakdown + group-wide hunt for MISSED IT vendors. Read-only.
const T = process.env.BC_TENANT_ID, C = process.env.BC_CLIENT_ID, S = process.env.BC_CLIENT_SECRET;
const ENV = process.env.BC_ENVIRONMENT || "Production";
const BASE = `https://api.businesscentral.dynamics.com/v2.0/${T}/${ENV}/api/v2.0`;
async function token() {
  const r = await fetch(`https://login.microsoftonline.com/${T}/oauth2/v2.0/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: C, client_secret: S, scope: "https://api.businesscentral.dynamics.com/.default" }) });
  const j = await r.json(); if (!j.access_token) throw new Error("token fail"); return j.access_token;
}
async function getAll(url, tok) {
  const out = []; let next = url;
  while (next) { const r = await fetch(next, { headers: { Authorization: `Bearer ${tok}`, "Data-Access-Intent": "ReadOnly", Accept: "application/json" } }); if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0,150)}`); const j = await r.json(); out.push(...(j.value || [])); next = j["@odata.nextLink"] || null; } return out;
}
const tok = await token();
const companies = (await getAll(`${BASE}/companies?$select=id,name,displayName`, tok)).filter((c) => !/^_|TEST|test|INIT|OPSTART|FLEETMATE|2025 test/.test(c.displayName));
const names = new Map();
for (const co of companies) { try { for (const a of await getAll(`${BASE}/companies(${co.id})/accounts?$select=number,displayName`, tok)) if (!names.has(a.number)) names.set(a.number, a.displayName); } catch {} }
const nm = (n) => names.get(n) || "(n/a)";

const MAPPED = new Set(["611120","611130","612350","612400","613320","240200","240500","215000","211000"]);
const ALLOWLIST = ["idocta","canon","allphi","just-fix-it","gmi group"];
const INTERCOMPANY = ["gheeraert","marcel lamberts","de rudder","trans-form","warehouse bv"];
const isInter = (v) => INTERCOMPANY.some((p) => (v||"").toLowerCase().includes(p));
const isAllow = (v) => ALLOWLIST.some((p) => (v||"").toLowerCase().includes(p));
// IT-looking vendor name patterns (broad; agents will judge)
const ITNAME = /\b(it|ict|software|hardware|cloud|host|server|data ?cent|cyber|secur|network|telecom|digit|syste|techno|comput|informatic|develop|\bdev\b|consult|saas|webdesign|web ?dev|microsoft|google|aws|azure|cisco|fortinet|sophos|veeam|backup|domain|hosting)\b/i;

const from = "2025-06-01", to = "2026-06-23";

// Pull all 61x + 64x expense GL group-wide, join to PI vendor, aggregate by vendor.
const vendorAgg = {}; // vendorLower -> {display, mappedNet, unmappedNet, accts:{acct:net}, months:Set}
const allphi = {}; // company -> {total, byMonth:{}}
for (const co of companies) {
  let headers = [];
  try { headers = await getAll(`${BASE}/companies(${co.id})/purchaseInvoices?$filter=postingDate ge ${from} and postingDate le ${to}&$select=number,vendorName`, tok); } catch {}
  const vmap = new Map(headers.map((h) => [h.number, h.vendorName]));
  let gl = [];
  try { gl = await getAll(`${BASE}/companies(${co.id})/generalLedgerEntries?$filter=postingDate ge ${from} and postingDate le ${to} and (startswith(accountNumber,'61') or startswith(accountNumber,'64'))&$select=accountNumber,documentNumber,description,debitAmount,creditAmount,postingDate`, tok); } catch {}
  for (const e of gl) {
    const amt = Number(e.debitAmount || 0) - Number(e.creditAmount || 0);
    if (!amt) continue;
    const acct = e.accountNumber;
    const vRaw = vmap.get(e.documentNumber) || e.description || "(journal)";
    if (isInter(vRaw)) continue;
    const vk = vRaw.toLowerCase();
    const a = (vendorAgg[vk] = vendorAgg[vk] || { display: vRaw, mappedNet: 0, unmappedNet: 0, accts: {}, months: new Set() });
    if (MAPPED.has(acct)) a.mappedNet += amt; else a.unmappedNet += amt;
    a.accts[acct] = (a.accts[acct] || 0) + amt;
    if (e.postingDate) a.months.add(e.postingDate.slice(0, 7));
    if (/allphi/i.test(vRaw)) {
      const c2 = (allphi[co.displayName] = allphi[co.displayName] || { total: 0, byMonth: {} });
      c2.total += amt; const m = (e.postingDate || "").slice(0, 7); c2.byMonth[m] = (c2.byMonth[m] || 0) + amt;
    }
  }
}

// MISSED IT vendors: IT-looking name, spend mostly on UNMAPPED accounts, NOT allowlisted, NOT intercompany.
const missed = Object.values(vendorAgg)
  .filter((a) => ITNAME.test(a.display) && !isAllow(a.display) && a.unmappedNet > 1000 && a.unmappedNet > a.mappedNet)
  .map((a) => ({ vendor: a.display, unmappedNet: Math.round(a.unmappedNet), mappedNet: Math.round(a.mappedNet), months: a.months.size,
    topAccounts: Object.entries(a.accts).sort((x,y)=>Math.abs(y[1])-Math.abs(x[1])).slice(0,3).map(([ac,v])=>`${ac} ${nm(ac)}: ${Math.round(v)}`) }))
  .sort((a, b) => b.unmappedNet - a.unmappedNet).slice(0, 40);

// What's now CAPTURED via allowlist (sanity): allowlisted vendors total
const allowCaptured = Object.values(vendorAgg).filter((a) => isAllow(a.display))
  .map((a) => ({ vendor: a.display, total: Math.round(a.mappedNet + a.unmappedNet), months: a.months.size,
    accounts: Object.keys(a.accts).map((ac)=>`${ac}`).slice(0,5) }))
  .sort((a,b)=>b.total-a.total);

console.log(JSON.stringify({
  allphiByCompany: Object.entries(allphi).map(([co, v]) => ({ company: co, total: Math.round(v.total), monthsBilled: Object.keys(v.byMonth).length, avgPerMonth: Math.round(v.total / Math.max(1, Object.keys(v.byMonth).length)), byMonth: Object.fromEntries(Object.entries(v.byMonth).map(([m, x]) => [m, Math.round(x)])) })),
  allphiGroupTotal: Math.round(Object.values(allphi).reduce((s, v) => s + v.total, 0)),
  allowlistCaptured: allowCaptured,
  potentiallyMissedITVendors: missed,
}, null, 2));
