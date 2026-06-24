// Grootboek analysis + completeness sweep + savings opportunities.
const B = "http://localhost:3000";
const from = "2025-06-24", to = "2026-06-24";

// ---------- 1. IT SPEND BROKEN DOWN BY GROOTBOEK ACCOUNT ----------
const inv = await (await fetch(`${B}/api/invoices?company=all&dateFrom=${from}&dateTo=${to}`)).json();
const byAccount = {};
const capturedByVendor = {};
let itTotal = 0, opTotal = 0;
for (const i of inv) {
  const cat = i.costCategory;
  const amt = i.totalAmountExcludingTax || 0;
  if (cat === "Unclassified" || cat === "IT Personnel") continue; // not in tool/services IT total
  const acct = i.lines?.[0]?.accountNumber || "?";
  itTotal += amt;
  if (cat === "Operational Software") opTotal += amt;
  byAccount[acct] = byAccount[acct] || { spend: 0, category: cat, vendors: {} };
  byAccount[acct].spend += amt;
  byAccount[acct].vendors[i.vendorName] = (byAccount[acct].vendors[i.vendorName] || 0) + amt;
  capturedByVendor[(i.vendorName || "").toUpperCase()] = (capturedByVendor[(i.vendorName || "").toUpperCase()] || 0) + amt;
}
const accountBreakdown = Object.entries(byAccount)
  .map(([acct, d]) => ({
    account: acct,
    category: d.category,
    spend: Math.round(d.spend),
    topVendors: Object.entries(d.vendors).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([v, a]) => `${v} €${Math.round(a).toLocaleString()}`),
  }))
  .sort((a, b) => b.spend - a.spend);

// ---------- 2. COMPLETENESS SWEEP: IT-like vendors we may UNDER-capture ----------
// Pull ALL purchase-invoice headers across companies, find IT-like vendor names,
// compare their TOTAL purchase spend to what we capture on mapped IT accounts.
const T = process.env.BC_TENANT_ID, C = process.env.BC_CLIENT_ID, S = process.env.BC_CLIENT_SECRET;
const ENV = process.env.BC_ENVIRONMENT || "Production";
const BASE = `https://api.businesscentral.dynamics.com/v2.0/${T}/${ENV}/api/v2.0`;
const tr = await fetch(`https://login.microsoftonline.com/${T}/oauth2/v2.0/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: C, client_secret: S, scope: "https://api.businesscentral.dynamics.com/.default" }) });
const tok = (await tr.json()).access_token;
async function getAll(url) { const out = []; let n = url; while (n) { const r = await fetch(n, { headers: { Authorization: `Bearer ${tok}`, "Data-Access-Intent": "ReadOnly" } }); if (!r.ok) break; const j = await r.json(); out.push(...(j.value || [])); n = j["@odata.nextLink"] || null; } return out; }
const cos = (await getAll(`${BASE}/companies?$select=id,displayName`)).filter((c) => !/^_|TEST|test|INIT|OPSTART|FLEETMATE|2025 test/.test(c.displayName));
const IT_KEYWORDS = /software|\bit\b|cloud|micro\s?soft|google|amazon|aws|azure|hosting|telecom|telenet|proximus|orange|digital|cyber|\bdata\b|\btech|informatica|systeem|system|netwerk|network|server|computer|laptop|webhost|domain|domein|licen|saas|anthropic|openai|adobe|atlassian|sentinel|backup|veeam|fortinet|sophos|vmware|citrix|sap\b/i;
const NON_IT = /transport|vervoer|brandstof|fuel|diesel|tank|truck|trailer|band|tyre|tire|garage|verzeker|insurance|advocaat|accountant|boekhoud|notaris|interim|uitzend|catering|schoonmaak|cleaning|bank\b|leasing|huur|rent|elektric|water|gas\b/i;
const vendorTotals = {};
for (const co of cos) {
  const hs = await getAll(`${BASE}/companies(${co.id})/purchaseInvoices?$filter=postingDate ge ${from} and postingDate le ${to}&$select=vendorName,totalAmountExcludingTax`);
  for (const h of hs) {
    const v = (h.vendorName || "").trim();
    if (!v) continue;
    vendorTotals[v.toUpperCase()] = (vendorTotals[v.toUpperCase()] || 0) + Number(h.totalAmountExcludingTax || 0);
  }
}
const INTERCO = /gheeraert|marcel lamberts|de rudder|trans-?form|warehouse bv|eralimmo/i;
const completenessFlags = Object.entries(vendorTotals)
  .filter(([v, total]) => total > 3000 && IT_KEYWORDS.test(v) && !NON_IT.test(v) && !INTERCO.test(v))
  .map(([v, total]) => {
    const captured = capturedByVendor[v] || 0;
    return { vendor: v, totalPurchaseSpend: Math.round(total), capturedAsIT: Math.round(captured), gap: Math.round(total - captured) };
  })
  .filter((x) => x.gap > 2000) // we capture materially less than the vendor's total
  .sort((a, b) => b.gap - a.gap)
  .slice(0, 25);

// ---------- 3. LICENSE WASTE (post-buffer) ----------
const lic = await (await fetch(`${B}/api/licenses`)).json();
const licWaste = lic.filter((l) => l.wastedCost > 0)
  .map((l) => ({ sku: l.skuPartNumber || l.displayName, unused: l.wastedUnits, prepaid: l.prepaidUnits, used: l.consumedUnits, util: (l.utilizationRate * 100).toFixed(0) + "%", wastedYr: Math.round(l.wastedCost * 12) }))
  .sort((a, b) => b.wastedYr - a.wastedYr);
const totalWasteYr = licWaste.reduce((s, l) => s + l.wastedYr, 0);

// ---------- 4. VENDOR CONCENTRATION ----------
const ven = await (await fetch(`${B}/api/vendors?company=all&dateFrom=${from}&dateTo=${to}`)).json();
const topVendors = ven.slice(0, 8).map((v) => ({ name: v.vendorName, spend: Math.round(v.totalSpend), pct: v.percentOfTotal?.toFixed?.(1) + "%", level: v.concentrationLevel }));

console.log(JSON.stringify({
  itTotal: Math.round(itTotal),
  operationalSoftwareIncluded: Math.round(opTotal),
  accountBreakdown,
  completenessFlags,
  licenseWaste: { totalReclaimablePerYear: totalWasteYr, byLicense: licWaste },
  topVendors,
}, null, 2));
