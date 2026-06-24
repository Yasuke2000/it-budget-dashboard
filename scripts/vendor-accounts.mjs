// For flagged vendors, find EXACTLY which G/L accounts their invoices post to,
// so we can tell real missed IT spend from non-IT / probe artifacts.
const T = process.env.BC_TENANT_ID, C = process.env.BC_CLIENT_ID, S = process.env.BC_CLIENT_SECRET;
const ENV = process.env.BC_ENVIRONMENT || "Production";
const BASE = `https://api.businesscentral.dynamics.com/v2.0/${T}/${ENV}/api/v2.0`;
const tr = await fetch(`https://login.microsoftonline.com/${T}/oauth2/v2.0/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: C, client_secret: S, scope: "https://api.businesscentral.dynamics.com/.default" }) });
const tok = (await tr.json()).access_token;
async function getAll(url) { const out = []; let n = url; while (n) { const r = await fetch(n, { headers: { Authorization: `Bearer ${tok}`, "Data-Access-Intent": "ReadOnly" } }); if (!r.ok) { console.error("ERR", r.status, await r.text()); break; } const j = await r.json(); out.push(...(j.value || [])); n = j["@odata.nextLink"] || null; } return out; }
const cos = (await getAll(`${BASE}/companies?$select=id,displayName`)).filter((c) => !/^_|TEST|test|INIT|OPSTART|FLEETMATE|2025 test/.test(c.displayName));
const from = "2025-06-24", to = "2026-06-24";

// vendor label -> match function on UPPER(vendorName)
const TARGETS = [
  ["Just-Fix-IT", (v) => v.includes("FIX IT") || v.includes("FIX-IT") || v.includes("JUST -FIX")],
  ["Winlock", (v) => v.includes("WINLOCK")],
  ["CyberContract", (v) => v.includes("CYBERCONTRACT")],
  ["Telenet", (v) => v.includes("TELENET")],
  ["NTS Computers", (v) => v.includes("NTS COMPUT") || v.includes("N.T.S")],
  ["DOO-IT", (v) => v.includes("DOO-IT") || v.includes("DOO IT")],
  ["CSW Software", (v) => v.includes("CSW SOFTWARE")],
  ["Mixam Computers", (v) => v.includes("MIXAM")],
  ["Orange", (v) => v.includes("ORANGE BELGIUM")],
  ["M Car Tech", (v) => v.includes("M CAR TECH")],
  ["Technolit", (v) => v.includes("TECHNOLIT")],
  ["JDS Technics", (v) => v.includes("JDS TECHNICS")],
];
const acc = {}; // label -> { accountNumber -> {spend, desc} }
for (const co of cos) {
  let invs = [];
  try {
    invs = await getAll(`${BASE}/companies(${co.id})/purchaseInvoices?$filter=postingDate ge ${from} and postingDate le ${to}&$select=vendorName,number&$expand=purchaseInvoiceLines($select=lineType,lineObjectNumber,description,netAmount)`);
  } catch { continue; }
  for (const inv of invs) {
    const vU = (inv.vendorName || "").toUpperCase();
    const hit = TARGETS.find(([, fn]) => fn(vU));
    if (!hit) continue;
    const label = hit[0];
    acc[label] = acc[label] || {};
    for (const ln of inv.purchaseInvoiceLines || []) {
      const a = ln.lineObjectNumber || `(${ln.lineType})`;
      const amt = Number(ln.netAmount || 0);
      if (!amt) continue;
      acc[label][a] = acc[label][a] || { spend: 0, desc: ln.description || "" };
      acc[label][a].spend += amt;
    }
  }
}
const out = {};
for (const [label, accts] of Object.entries(acc)) {
  out[label] = Object.entries(accts)
    .map(([a, d]) => ({ account: a, spend: Math.round(d.spend), egDesc: d.desc.slice(0, 40) }))
    .sort((x, y) => y.spend - x.spend);
}
// Note which accounts are currently mapped/scanned as IT
const IT_ACCOUNTS = ["611120", "611130", "612350", "612400", "613320", "240200", "240500", "215000", "211000"];
const SCAN = ["613300", "612300", "615800"];
console.log("IT-mapped:", IT_ACCOUNTS.join(","), "| scan:", SCAN.join(","));
console.log(JSON.stringify(out, null, 2));
