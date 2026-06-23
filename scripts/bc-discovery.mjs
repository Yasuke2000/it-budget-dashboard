// BC discovery v4 — card transactions + AI/SaaS keyword scan. Read-only.
const T = process.env.BC_TENANT_ID, C = process.env.BC_CLIENT_ID, S = process.env.BC_CLIENT_SECRET;
const ENV = process.env.BC_ENVIRONMENT || "Production";
const BASE = `https://api.businesscentral.dynamics.com/v2.0/${T}/${ENV}/api/v2.0`;
async function token() {
  const r = await fetch(`https://login.microsoftonline.com/${T}/oauth2/v2.0/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: C, client_secret: S, scope: "https://api.businesscentral.dynamics.com/.default" }) });
  const j = await r.json(); if (!j.access_token) throw new Error("token fail"); return j.access_token;
}
async function getAll(url, tok) {
  const out = []; let next = url;
  while (next) { const r = await fetch(next, { headers: { Authorization: `Bearer ${tok}`, "Data-Access-Intent": "ReadOnly", Accept: "application/json" } }); if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0,200)}`); const j = await r.json(); out.push(...(j.value || [])); next = j["@odata.nextLink"] || null; } return out;
}
const tok = await token();
const companies = (await getAll(`${BASE}/companies?$select=id,name,displayName`, tok)).filter((c) => !/^_|TEST|test|INIT|OPSTART|FLEETMATE|2025 test/.test(c.displayName));
const from = "2025-06-01", to = "2026-06-23";

// 1) Every transaction on the prepaid MasterCard / fuel-card suspense accounts — full descriptions
const CARD_ACCTS = ["499002", "499003", "499004"];
const cardTx = [];
for (const co of companies) {
  let headers = [];
  try { headers = await getAll(`${BASE}/companies(${co.id})/purchaseInvoices?$filter=postingDate ge ${from} and postingDate le ${to}&$select=number,vendorName`, tok); } catch {}
  const vmap = new Map(headers.map((h) => [h.number, h.vendorName]));
  for (const acct of CARD_ACCTS) {
    let gl = [];
    try { gl = await getAll(`${BASE}/companies(${co.id})/generalLedgerEntries?$filter=postingDate ge ${from} and postingDate le ${to} and accountNumber eq '${acct}'&$select=postingDate,description,debitAmount,creditAmount,documentNumber`, tok); } catch {}
    for (const e of gl) {
      const debit = Number(e.debitAmount || 0), credit = Number(e.creditAmount || 0);
      cardTx.push({ company: co.displayName, acct, date: e.postingDate, desc: e.description, debit, credit, vendor: vmap.get(e.documentNumber) || "" });
    }
  }
}
// charges = debit (money spent on the card); group identical descriptions
const charges = cardTx.filter((t) => t.debit > 0).sort((a, b) => b.debit - a.debit);
const descRoll = {};
for (const t of cardTx) { const k = (t.desc || "(blank)").replace(/\d{2,}/g, "#").trim().slice(0, 40); const d = (descRoll[k] = descRoll[k] || { net: 0, n: 0 }); d.net += t.debit - t.credit; d.n += 1; }
const cardDescriptions = Object.entries(descRoll).map(([k, v]) => ({ descPattern: k, net: Math.round(v.net), n: v.n })).sort((a, b) => Math.abs(b.net) - Math.abs(a.net)).slice(0, 60);

// 2) AI / SaaS / cloud keyword scan across ALL GL descriptions (and vendor names)
const SAAS = /anthropic|openai|chatgpt|\bclaude\b|cursor|copilot|github|gitlab|adobe|figma|notion|vercel|netlify|cloudflare|\baws\b|amazon web|google\s?(cloud|workspace|ads)|gcp|azure|microsoft|office ?365|m365|dropbox|\bzoom\b|slack|atlassian|jira|confluence|canva|hubspot|mailchimp|stripe|twilio|sendgrid|digitalocean|hetzner|ovh|godaddy|namecheap|wix|squarespace|shopify|datadog|sentry|openrouter|midjourney|elevenlabs|perplexity|grok|gemini|huggingface|replicate|\bapi\b|subscription|abonnement|licen/i;
const STRICT_AI = /anthropic|openai|chatgpt|\bclaude\b|cursor|copilot|midjourney|elevenlabs|perplexity|huggingface|replicate|openrouter|gemini|\bgrok\b/i;
const saasHits = {}; const aiHits = [];
for (const co of companies) {
  let gl = [];
  try {
    // pull only 6xx (expense) + 49xx (card/suspense) to keep it bounded, with descriptions
    gl = await getAll(`${BASE}/companies(${co.id})/generalLedgerEntries?$filter=postingDate ge ${from} and postingDate le ${to} and (startswith(accountNumber,'6') or startswith(accountNumber,'499'))&$select=accountNumber,description,debitAmount,creditAmount,documentNumber`, tok);
  } catch (e) { saasHits["_err_" + co.displayName] = String(e).slice(0, 120); continue; }
  for (const e of gl) {
    const d = e.description || "";
    if (SAAS.test(d)) {
      const m = (d.match(SAAS) || ["?"])[0].toLowerCase();
      const h = (saasHits[m] = saasHits[m] || { net: 0, n: 0, accts: new Set(), sample: d.slice(0, 60) });
      h.net += Number(e.debitAmount || 0) - Number(e.creditAmount || 0); h.n += 1; h.accts.add(e.accountNumber);
    }
    if (STRICT_AI.test(d)) aiHits.push({ company: co.displayName, acct: e.accountNumber, desc: d.slice(0, 80), amt: Math.round(Number(e.debitAmount || 0) - Number(e.creditAmount || 0)) });
  }
}
const saasSummary = Object.entries(saasHits).filter(([k]) => !k.startsWith("_err_")).map(([k, v]) => ({ keyword: k, net: Math.round(v.net), entries: v.n, accounts: [...v.accts], sample: v.sample })).sort((a, b) => b.entries - a.entries);

console.log(JSON.stringify({
  cardChargeCount: charges.length,
  cardTopCharges: charges.slice(0, 30).map((t) => ({ company: t.company, acct: t.acct, date: t.date, desc: (t.desc || "").slice(0, 60), debit: Math.round(t.debit), vendor: t.vendor })),
  cardDescriptionPatterns: cardDescriptions,
  saasKeywordSummary: saasSummary,
  strictAImatches: aiHits.slice(0, 40),
  errors: Object.entries(saasHits).filter(([k]) => k.startsWith("_err_")),
}, null, 2));
