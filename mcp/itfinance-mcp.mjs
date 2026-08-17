#!/usr/bin/env node
// MCP-server (stdio) voor het IT/Finance-dashboard — cluster D van het ontwerpdossier
// (vraag David 14/08/2026: Claude volledige leestoegang, tot op de individuele
// BC-factuur, zo diep en volledig mogelijk; schrijven alleen als eigen rapporten).
//
// Tools (alleen-lezen op BC, altijd Data-Access-Intent: ReadOnly):
//  1. dashboard            — de gevalideerde dashboard-API's (live, via kubectl → pod).
//  2. bc_query             — ruwe BC-query: ODataV4-webservices én api/v2.0-entiteiten,
//                            met $filter/$select/$expand (factuurLIJNEN!), volledige
//                            paging (nooit $top — de €776k-les).
//  3. bc_link              — BC-deeplink naar de exacte boeking/factuur (zelfde
//                            vindplaats-conventie als de exports).
//  4. bestanden            — projectdocumenten lezen (vragenlijsten, fixplannen, …).
//  5. schrijf_export       — eigen rapporten/dashboards schrijven naar exports/claude/
//                            (nooit naar BC — BC-writes lopen via de dry-run/akkoord-flow).
//  6. emasphere_referentie — de gevalideerde EMAsphere Q1-2026-cijfers als vergelijkingsbasis.
//  7. methodiek            — METHODIEK-FORMULES.md (hoe elk cijfer tot stand komt).
//
// Registreren:  claude mcp add itfinance -- node "<absoluut pad naar dit bestand>"
// Protocol: MCP stdio = JSON-RPC 2.0, newline-delimited. Geen dependencies.

import { execFile } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, statSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NS = "it-finance";
const MAX_CHARS = 80_000;
const PROJECT = path.resolve(__dirname, "..", "..");
const EXPORTS = path.join(PROJECT, "exports");
const READ_DIRS = ["mails", "exports", "it-budget-dashboard"];
const TENANT = "c78ce9f9-94d2-46dd-afcf-c12e881cc810";
const COMPANIES = ["GTR", "GDI", "GTG", "GSS", "GPR", "TFO", "WHS", "TDR", "LMB", "GEX"];

const ALLOWED_DASH = new Set([
  "/api/cfo/units", "/api/cfo/units/drill", "/api/cfo/ic-btw", "/api/cfo/bank",
  "/api/cfo/vat", "/api/cfo/balance", "/api/cfo/receivables", "/api/cfo/assets",
  "/api/cfo/leasing", "/api/cfo/gl", "/api/cfo/snapshots",
]);

// EMAsphere-referentie: gevalideerde rapporten "Gheeraert Transport Conso", 31/03/2026.
const EMASPHERE = {
  bron: "EMAsphere 'Gheeraert Transport Conso', REPORTING 2026-03 (31/03/2026). Door Bram Van Eenoo gevalideerd: Operations P&L, Page 92, Omzet en Onderaannemers.",
  scope: "9 firma's (GTR GDI GTG GSS GPR TFO WHS TDR GRE) — LMB en GEX vallen buiten hun consolidatie. Omzet = klasse 70 excl. 705200 (gebouwenverkoop GPR).",
  q1_2026_per_firma: {
    omzet: { GTR: 4908675, GDI: 7708368, GTG: 1307007, GSS: 485973, GPR: 97663, TFO: 40129, WHS: 5287589, TDR: 1575194, GRE: 872303, som: 22282901 },
    bedrijfsresultaat: { GTR: -649761, GDI: 468892, GTG: 40789, GSS: -38948, GPR: 87361, TFO: 15757, WHS: -650052, TDR: -161086, GRE: 726349, som: -160700 },
    ebitda: { GTR: -436857, GDI: 496118, GTG: 97066, GSS: -37389, GPR: 94236, TFO: 15757, WHS: -650052, TDR: -161086, GRE: 726349, som: 144141 },
    resultaat_na_belastingen: { GTR: -626352, GDI: -1275885, GTG: 41304, GSS: -42402, GPR: 20830, TFO: 15439, WHS: -721540, TDR: -162848, GRE: 687825, som: -2063629 },
    interco_eliminatie: { omzet: 6224765, kosten: 4037782, geconsolideerde_omzet: 16058136 },
    accijnsrecuperatie: { GTR: 69000, TDR: 37331, opmerking: "TDR sluit exact op BC 740600; GTR's bron in BC onbekend (740600 = 0) — open [PRIO]-vraag." },
    uitzonderlijke_kosten: { GDI: -1594125, WHS: -55712, GRE: -4173, opmerking: "GDI 1.594.125 = BC 610090 Huur Sint-Niklaas (vrijwel volledig Q1) — EMAsphere: uitzonderlijk, dashboard: operationeel. Open [PRIO]: echt eenmalig?" },
  },
  fy_page92: {
    omzet_2025: 52426905, omzet_2026_landing: 89258618,
    ebitdar_2025: 4892917, ebitdar_2026_landing: 8483302,
    ebitda_2025: 2902778, ebitda_2026_landing: 3697088,
    resultaat_na_belastingen_2025: 224933, resultaat_na_belastingen_2026_landing: -568839,
    opmerking: "Page 92 = actuals t/m rapportmaand + budget rest = jaarlanding. Maart-omzet conso (8.287.876) uit BC gereproduceerd tot op EUR 1.",
  },
  cash: { cash_end_2026_03: -3579370, opmerking: "Incl. negatieve factor-/kredietstanden; BC klasse 55 gaf -3.525.296 (delta 1,5%)." },
  bekende_verschillen_met_dashboard: [
    "GDI bedrijfsresultaat delta EUR 1,74M — volledig verklaard: 610090-herclassificatie (zie uitzonderlijke_kosten).",
    "WHS resultaat delta -169k en TDR -140k: EMAsphere-mapping (reclasses/provisies) — mapping opgevraagd.",
    "IC-eliminatie: dashboard 6.454.359 (factuurbasis, bredere naamregel incl. satellieten) vs EMAsphere 6.224.765.",
    "GRE-omzet: 705200 is bij GRE doorrekening nutsvoorzieningen (geen one-off) en telt mee in de omzet.",
    "WHS/LMB/TDR hebben pas sinds 12/2025-01/2026 een P&L in BC (alleen balans gemigreerd) — jaar-op-jaar voor die firma's is onmogelijk.",
  ],
};

function podNode(script, timeout = 300_000) {
  return new Promise((resolve, reject) => {
    execFile("kubectl", ["exec", "-i", "-n", NS, "deploy/it-finance", "--", "node", "--input-type=module", "-e", script],
      { timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout) => {
        if (err && !stdout) return reject(new Error(`kubectl: ${String(err.message).slice(0, 200)}`));
        resolve(String(stdout).trim().split("\n").pop() || "");
      });
  });
}

async function dashboardFetch(urlPath) {
  const script = `const r=await fetch(${JSON.stringify("http://localhost:3000" + urlPath)});const t=await r.text();console.log(JSON.stringify({status:r.status,body:t.slice(0,${MAX_CHARS})}))`;
  const out = await podNode(script, 120_000);
  try { return JSON.parse(out); } catch { throw new Error(`onleesbaar antwoord: ${out.slice(0, 150)}`); }
}

async function bcQuery(args) {
  const co = String(args.company || "").toUpperCase();
  if (!COMPANIES.includes(co)) throw new Error(`company moet een van ${COMPANIES.join("/")} zijn`);
  const svc = String(args.service || "");
  if (!/^[A-Za-z0-9_]{2,64}$/.test(svc)) throw new Error("service: alfanumeriek + underscore");
  const useApi = Boolean(args.api);
  const q = [];
  if (args.filter) q.push("$filter=" + encodeURIComponent(String(args.filter)));
  if (args.select) q.push("$select=" + encodeURIComponent(String(args.select)));
  if (args.expand) q.push("$expand=" + encodeURIComponent(String(args.expand)));
  const qs = q.length ? "?" + q.join("&") : "";
  const urlExpr = useApi
    ? `ROOT+"/api/v2.0/companies("+cid2+")/"+${JSON.stringify(svc + qs)}`
    : `ROOT+"/ODataV4/Company('${co}')/"+${JSON.stringify(svc + qs)}`;
  const script = `
const tenant=process.env.BC_TENANT_ID, cid=process.env.BC_CLIENT_ID, sec=process.env.BC_CLIENT_SECRET, env=process.env.BC_ENVIRONMENT||"production";
const tok=await (await fetch("https://login.microsoftonline.com/"+tenant+"/oauth2/v2.0/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"client_credentials",client_id:cid,client_secret:sec,scope:"https://api.businesscentral.dynamics.com/.default"})})).json();
const H={Authorization:"Bearer "+tok.access_token,Accept:"application/json","Data-Access-Intent":"ReadOnly"};
const ROOT="https://api.businesscentral.dynamics.com/v2.0/"+tenant+"/"+env;
let cid2="";
${useApi ? `{const comps=(await (await fetch(ROOT+"/api/v2.0/companies",{headers:H})).json()).value||[];const c=comps.find(x=>x.name===${JSON.stringify(co)});if(!c){console.log(JSON.stringify({error:"firma niet gevonden"}));process.exit(0)}cid2=c.id;}` : ""}
let url=${urlExpr};
const rows=[];let pages=0;let clipped=false;
while(url&&pages<200){
  const r=await fetch(url,{headers:H});
  if(!r.ok){console.log(JSON.stringify({error:"BC "+r.status,detail:(await r.text()).slice(0,300)}));process.exit(0)}
  const j=await r.json();
  for(const v of j.value||[]) rows.push(v);
  url=j["@odata.nextLink"]||null;pages++;
  if(JSON.stringify(rows).length>${MAX_CHARS}){clipped=Boolean(url);url=null;}
}
const payload={count:rows.length,afgekapt:clipped,rows};
console.log(JSON.stringify(payload).slice(0,${MAX_CHARS}));`;
  const out = await podNode(script);
  return out;
}

// BC-deeplinks — zelfde vindplaats-conventie als lib/bc-links.ts (tenant+env in het pad).
const BC_PAGES = {
  grootboekpost: [20, "Document No."],
  grootboekrekening: [20, "G/L Account No."],
  klantpost: [25, "Document No."],
  klant_alle_posten: [25, "Customer No."],
  klantkaart: [21, "No."],
  leverancierspost: [29, "Document No."],
  verkoopfactuur: [132, "No."],
};
function bcLink(args) {
  const t = String(args.type || "");
  const co = String(args.company || "").toUpperCase();
  const v = String(args.value || "");
  if (!BC_PAGES[t]) throw new Error(`type moet een van ${Object.keys(BC_PAAGES_SAFE()).join("/")} zijn`);
  if (!COMPANIES.includes(co)) throw new Error(`company moet een van ${COMPANIES.join("/")} zijn`);
  if (!/^[\w./-]{1,40}$/.test(v)) throw new Error("value: document-/rekening-/klantnummer");
  const [page, field] = BC_PAGES[t];
  const filt = encodeURIComponent(`'${field}' IS '${v}'`);
  return `https://businesscentral.dynamics.com/${TENANT}/Production/?company=${encodeURIComponent(co)}&page=${page}&filter=${filt}`;
}
function BC_PAAGES_SAFE() { return BC_PAGES; }

function veiligPad(rel) {
  const clean = String(rel || "").replace(/\\/g, "/");
  if (clean.includes("..")) throw new Error("pad mag geen .. bevatten");
  const abs = path.join(PROJECT, clean);
  if (!READ_DIRS.some((d) => abs.startsWith(path.join(PROJECT, d)))) throw new Error(`alleen paden onder: ${READ_DIRS.join(", ")}`);
  return abs;
}

const TOOLS = [
  {
    name: "dashboard",
    description: "Live data uit het Gheeraert CFO-dashboard (gevalideerde berekeningen op Business Central). Endpoints: /api/cfo/units (P&L per vennootschap; params from/to/exclude), /api/cfo/units/drill (per grootboekrekening; company of cls + from/to), /api/cfo/ic-btw (IC-btw & omzetsplit per maand), /api/cfo/bank, /api/cfo/vat, /api/cfo/balance, /api/cfo/receivables (DSO, cashpotentieel, bellijst), /api/cfo/assets, /api/cfo/leasing, /api/cfo/gl (account+from+to = boekingen achter een rekening), /api/cfo/snapshots. Status 202 = data bouwt nog op; probeer later opnieuw.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Endpoint-pad, bv. /api/cfo/units" },
        params: { type: "object", additionalProperties: { type: "string" }, description: 'Query-params, bv. {"from":"2026-01-01","to":"2026-03-31"}' },
      },
      required: ["path"],
    },
  },
  {
    name: "bc_query",
    description: "Ruwe ALLEEN-LEZEN query op Business Central, tot op de individuele factuur en factuurlijn. Volledige paging (nooit $top). Vorm (a) ODataV4-webservice: service bv. Grootboekposten_Excel, Cust_LedgerEntries, VendorLedgerEntries, BankAccountLedgerEntries, FALedgerEntries — velden Pascal_Snake (Posting_Date, Document_No, Amount, Remaining_Amt_LCY). Vorm (b) api:true voor api/v2.0: service bv. salesInvoices, purchaseInvoices, customers, vendors, accounts, generalLedgerEntries — velden camelCase; met expand haal je FACTUURLIJNEN op (salesInvoices + expand=salesInvoiceLines, purchaseInvoices + expand=purchaseInvoiceLines). Firmacodes: GTR GDI GTG GSS GPR TFO WHS TDR LMB GEX. Gebruik ALTIJD filter én select — anders wordt het antwoord afgekapt (veld 'afgekapt': true).",
    inputSchema: {
      type: "object",
      properties: {
        company: { type: "string" },
        service: { type: "string" },
        filter: { type: "string", description: "OData $filter, bv. postingDate ge 2026-05-01 and number eq 'AF26050531'" },
        select: { type: "string", description: "OData $select" },
        expand: { type: "string", description: "OData $expand, bv. salesInvoiceLines" },
        api: { type: "boolean", description: "true = api/v2.0-entiteit; false/weg = ODataV4-webservice" },
      },
      required: ["company", "service"],
    },
  },
  {
    name: "bc_link",
    description: "Maak een klikbare Business Central-deeplink naar de exacte vindplaats (vereist BC-login van de lezer). Types: grootboekpost (documentnr → boekingen), grootboekrekening (rekeningnr → alle posten), klantpost (documentnr), klant_alle_posten (klantnr), klantkaart (klantnr), leverancierspost (documentnr), verkoopfactuur (factuurnr). Geef deze link altijd mee wanneer je een specifieke boeking of factuur noemt.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["grootboekpost", "grootboekrekening", "klantpost", "klant_alle_posten", "klantkaart", "leverancierspost", "verkoopfactuur"] },
        company: { type: "string" },
        value: { type: "string" },
      },
      required: ["type", "company", "value"],
    },
  },
  {
    name: "bestanden",
    description: "Projectdocumenten lezen: vragenlijsten, verificatierapporten, fixplannen, methodiek, export-leeswijzers. actie=list toont een map (bv. mails), actie=read leest een bestand (bv. mails/2026-08-14-verliesdiagnose-fixplan.md). Alleen-lezen, alleen onder mails/, exports/ en it-budget-dashboard/.",
    inputSchema: {
      type: "object",
      properties: { actie: { type: "string", enum: ["list", "read"] }, pad: { type: "string" } },
      required: ["actie", "pad"],
    },
  },
  {
    name: "schrijf_export",
    description: "Schrijf een door jou gemaakt rapport of dashboard (markdown/html) naar exports/claude/ zodat David het kan delen. Uitsluitend NIEUWE bestanden daar; al het andere (incl. Business Central) is niet schrijfbaar — BC-schrijfacties lopen via een aparte dry-run/akkoord-flow met David.",
    inputSchema: {
      type: "object",
      properties: {
        bestandsnaam: { type: "string", description: "Naam met .md of .html, bv. vergelijking-emasphere.md" },
        inhoud: { type: "string" },
      },
      required: ["bestandsnaam", "inhoud"],
    },
  },
  { name: "emasphere_referentie", description: "De gevalideerde EMAsphere-cijfers (Gheeraert Transport Conso Q1-2026 + Page 92-jaarlanding) als vaste vergelijkingsbasis, inclusief de bekende en verklaarde verschillen met het dashboard.", inputSchema: { type: "object", properties: {} } },
  { name: "methodiek", description: "METHODIEK-FORMULES.md — hoe elk dashboardcijfer tot stand komt (formules, aannameregister A1-A8, beperkingen). Optioneel: sectie-filter op kopwoord.", inputSchema: { type: "object", properties: { sectie: { type: "string" } } } },
];

async function callTool(name, args) {
  if (name === "emasphere_referentie") return JSON.stringify(EMASPHERE, null, 1);
  if (name === "methodiek") {
    const p = path.join(PROJECT, "METHODIEK-FORMULES.md");
    let txt = existsSync(p) ? readFileSync(p, "utf-8") : "METHODIEK-FORMULES.md niet gevonden";
    if (args?.sectie) {
      const woord = String(args.sectie).toLowerCase();
      const parts = txt.split(/\n(?=#{1,3} )/);
      txt = parts.filter((s) => s.split("\n")[0].toLowerCase().includes(woord)).join("\n") || `Geen sectie met "${args.sectie}".`;
    }
    return txt.slice(0, MAX_CHARS);
  }
  if (name === "bc_query") return await bcQuery(args || {});
  if (name === "bc_link") return bcLink(args || {});
  if (name === "bestanden") {
    const abs = veiligPad(args?.pad);
    if (args?.actie === "list") {
      return readdirSync(abs).map((n) => {
        try { return (statSync(path.join(abs, n)).isDirectory() ? "[map] " : "") + n; } catch { return n; }
      }).join("\n") || "(leeg)";
    }
    return readFileSync(abs, "utf-8").slice(0, MAX_CHARS);
  }
  if (name === "schrijf_export") {
    const naam = String(args?.bestandsnaam || "");
    if (!/^[\w][\w .()-]{0,80}\.(md|html)$/.test(naam)) throw new Error("bestandsnaam: letters/cijfers, eindigend op .md of .html");
    const dir = path.join(EXPORTS, "claude");
    mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, naam);
    if (existsSync(dest)) throw new Error("bestand bestaat al — kies een andere naam");
    writeFileSync(dest, String(args?.inhoud || ""), "utf-8");
    return `geschreven: exports/claude/${naam} (${String(args?.inhoud || "").length} tekens)`;
  }
  if (name === "dashboard") {
    const p = String(args?.path || "");
    if (!ALLOWED_DASH.has(p)) throw new Error(`pad niet toegestaan; kies uit: ${[...ALLOWED_DASH].join(", ")}`);
    const qs = args?.params ? "?" + new URLSearchParams(args.params).toString() : "";
    const { status, body } = await dashboardFetch(p + qs);
    if (status === 202) return "STATUS 202: de data wordt nog opgebouwd uit Business Central (2-5 min bij een koud venster). Stel dezelfde vraag zo opnieuw.";
    if (status !== 200) throw new Error(`HTTP ${status}: ${String(body).slice(0, 200)}`);
    return body;
  }
  throw new Error(`onbekende tool: ${name}`);
}

// ---- MCP stdio (JSON-RPC 2.0, newline-delimited) ----
const out = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let req; try { req = JSON.parse(line); } catch { return; }
  const { id, method, params } = req;
  const reply = (result) => id !== undefined && out({ jsonrpc: "2.0", id, result });
  const fail = (message, code = -32000) => id !== undefined && out({ jsonrpc: "2.0", id, error: { code, message } });
  try {
    if (method === "initialize") {
      reply({
        protocolVersion: params?.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "itfinance", version: "1.1.0" },
        instructions: "Volledige leestoegang tot het Gheeraert CFO-dashboard (live), ruwe Business Central-data tot op factuurlijn-niveau (bc_query, altijd met filter+select), projectdocumenten (bestanden) en de gevalideerde EMAsphere-referentie (emasphere_referentie). Geef bij elke specifieke boeking/factuur een bc_link mee. Schrijven kan uitsluitend als nieuw rapport onder exports/claude/ (schrijf_export) — nooit naar Business Central. Vermeld bij elk cijfer de bron; zet bij vergelijkingen de bekende classificatieverschillen ernaast.",
      });
    } else if (method?.startsWith("notifications/")) {
      // notifications krijgen geen antwoord
    } else if (method === "tools/list") {
      reply({ tools: TOOLS });
    } else if (method === "tools/call") {
      const text = await callTool(params?.name, params?.arguments || {});
      reply({ content: [{ type: "text", text: String(text) }] });
    } else if (method === "ping") {
      reply({});
    } else {
      fail(`methode niet ondersteund: ${method}`, -32601);
    }
  } catch (e) {
    if (method === "tools/call" && id !== undefined) {
      out({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `FOUT: ${String(e.message || e)}` }], isError: true } });
    } else {
      fail(String(e.message || e));
    }
  }
});
