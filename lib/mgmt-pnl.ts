// Management-P&L in EMAsphere-structuur (cluster A van het ontwerpdossier, gebouwd
// 17/08/2026 nadat de EMAsphere-mapping gereverse-engineerd was — zie
// docs/emasphere/EMASPHERE-DATAMODEL.md en pnl_line_mapping.csv).
//
// Ontwerpkeuzes:
// - Zelfde bucket-structuur als het gevalideerde EMAsphere Operations P&L (de taal
//   van finance), maar dan LIVE uit BC en per maand.
// - Rekening→bucket-mapping op nummerreeks + (waar reeksen dubbelzinnig zijn) op
//   rekeningNAAM — gedocumenteerd per regel hieronder.
// - ALLES wat niet mapt komt zichtbaar in de rij "Niet gemapt" terecht; de
//   Controlelijn (gestructureerd resultaat − brute som 60-77) hoort op €0 te staan.
//   Dat is de les uit EMAsphere zelf, waar de controlelijn op +€1,7M YtD staat en
//   niemand weet waarom.
// - GPR/705200 (gebouwenverkoop) → aparte rij "Niet-recurrent (verkoop gebouwen)",
//   net als op de units-pagina; bij GRE is 705200 doorrekening nutsvoorzieningen en
//   telt hij gewoon mee (geverifieerd tegen EMAsphere op de euro, 14/08/2026).
// - Manuele EMAsphere-adjustments (raming accijns, huur→uitzonderlijk, vakantiegeld-
//   overdracht) zitten hier bewust NIET in: dit toont wat GEBOEKT is. De bekende
//   adjustments staan als noot zodat het verschil met EMAsphere verklaarbaar blijft.

import type { CfoSource } from "./types";
import { fetchBCCompanies, getBCToken } from "./bc-client";
import { ODATA_ROOT, API_ROOT, pageAllOData, makePolledGetter, isOperatingCompany } from "./bc-odata";
import { getCache, setCache } from "./sync-cache";
import { fetchWithRetry } from "./http";
import { glAccountLink } from "./bc-links";

const r0 = (n: number) => Math.round(n);

export interface PnlRow {
  id: string;
  label: string;
  style: "normal" | "subtotal" | "total" | "memo";
  indent: 0 | 1;
  monthly: number[];
  ytd: number;
}
export interface PnlDetailRow { account: string; name: string; company: string; ytd: number; monthly: number[]; bcUrl: string }
export interface CfoMgmtPnl {
  asOf: string; isLive: boolean;
  year: number; company: string;          // "ALL" of firmacode
  months: string[];
  rows: PnlRow[];
  unmapped: { account: string; name: string; company: string; ytd: number }[];
  // "dat + dat + dat": per bucket de rekeningen erachter, per vennootschap (meeting note)
  detail: Record<string, PnlDetailRow[]>;
  // P&L-klok (meeting note: maximaal een week na de maand): per maand of de lonen
  // al geboekt zijn — de gebruikelijke laatste ontbrekende post.
  klok: { month: string; deadline: string; lonenGeboekt: boolean }[];
  controlelijn: number;                    // hoort 0 te zijn
  nonRecurringRev: number;
  sources: CfoSource[]; notes: string[];
  refreshing?: boolean;
}

// ---- bucketdefinities in rapportvolgorde (spiegelt pnl_line_mapping.csv) ----
const BUCKETS: { id: string; label: string; style: PnlRow["style"]; indent: 0 | 1 }[] = [
  { id: "omzet", label: "Omzet", style: "subtotal", indent: 0 },
  { id: "verkoop_transport", label: "Verkoop Transport", style: "normal", indent: 1 },
  { id: "verkoop_magazijn", label: "Verkoop Magazijn", style: "normal", indent: 1 },
  { id: "verkoop_garage", label: "Verkoop Garage", style: "normal", indent: 1 },
  { id: "verkoop_andere", label: "Verkoop Andere", style: "normal", indent: 1 },
  { id: "diverse", label: "Diverse Bedrijfsopbrengsten", style: "subtotal", indent: 0 },
  { id: "accijns", label: "Accijnsrecuperatie", style: "normal", indent: 1 },
  // "Meerwaarden" verwijderd (finance 20/08): 741000 telt als niet-recurrent,
  // niet als bedrijfsopbrengst — zit dus niet meer in diverse/brutomarge.
  { id: "andere_opbr", label: "Andere Opbrengsten", style: "normal", indent: 1 },
  { id: "variabel", label: "Variabele Kosten", style: "subtotal", indent: 0 },
  { id: "onderaanneming", label: "Onderaanneming & aankopen", style: "normal", indent: 1 },
  { id: "voorraadwijziging", label: "Voorraadwijziging", style: "normal", indent: 1 },
  { id: "ddg_var", label: "Diensten & diverse goederen variabel", style: "normal", indent: 1 },
  { id: "personeel_var", label: "Personeelskosten variabel", style: "normal", indent: 1 },
  { id: "brutomarge", label: "Brutomarge", style: "total", indent: 0 },
  { id: "brutomarge_pct", label: "Brutomarge %", style: "memo", indent: 0 },
  { id: "vast", label: "Vaste kosten", style: "subtotal", indent: 0 },
  { id: "huur_gebouwen", label: "Huur gebouwen", style: "normal", indent: 1 },
  { id: "lease_rollend", label: "Huur & afschrijving rollend materieel", style: "normal", indent: 1 },
  { id: "onderhoud_gebouwen", label: "Onderhoud gebouwen & terreinen", style: "normal", indent: 1 },
  { id: "onderhoud_materieel", label: "Onderhoud machines & materieel (vast)", style: "normal", indent: 1 },
  { id: "software_it", label: "Software en IT", style: "normal", indent: 1 },
  { id: "nutsvoorzieningen", label: "Nutsvoorzieningen", style: "normal", indent: 1 },
  { id: "kantoor", label: "Kantoorkosten", style: "normal", indent: 1 },
  { id: "vergoeding_derden", label: "Vergoeding aan derden", style: "normal", indent: 1 },
  { id: "verzekeringen", label: "Verzekeringen", style: "normal", indent: 1 },
  { id: "personeel_vast", label: "Personeelskosten vast", style: "normal", indent: 1 },
  { id: "afschrijvingen", label: "Afschrijvingen & earn-out", style: "normal", indent: 1 },
  { id: "voorzieningen", label: "Voorzieningen & waardeverminderingen", style: "normal", indent: 1 },
  { id: "andere_kosten", label: "Andere bedrijfskosten", style: "normal", indent: 1 },
  { id: "bedrijfsresultaat", label: "Bedrijfsresultaat", style: "total", indent: 0 },
  { id: "fin_opbr", label: "Financiële opbrengsten", style: "normal", indent: 1 },
  { id: "fin_kosten", label: "Financiële kosten", style: "normal", indent: 1 },
  { id: "uitz_opbr", label: "Uitzonderlijke opbrengsten", style: "normal", indent: 1 },
  { id: "uitz_kosten", label: "Uitzonderlijke kosten", style: "normal", indent: 1 },
  { id: "res_voor_bel", label: "Resultaat vóór belastingen", style: "total", indent: 0 },
  { id: "belastingen", label: "Belastingen", style: "normal", indent: 1 },
  { id: "res_na_bel", label: "Resultaat ná belastingen", style: "total", indent: 0 },
  { id: "ebitda", label: "EBITDA", style: "total", indent: 0 },
  { id: "niet_gemapt", label: "Niet gemapt (hoort €0 te zijn)", style: "memo", indent: 0 },
  { id: "niet_recurrent", label: "Niet-recurrent apart: verkoop gebouwen (GPR 705200)", style: "memo", indent: 0 },
];

// Somrijen: uit welke detailrijen bestaat elk (sub)totaal.
const SUMS: Record<string, string[]> = {
  omzet: ["verkoop_transport", "verkoop_magazijn", "verkoop_garage", "verkoop_andere"],
  diverse: ["accijns", "andere_opbr"],
  variabel: ["onderaanneming", "voorraadwijziging", "ddg_var", "personeel_var"],
  brutomarge: ["omzet", "diverse", "variabel"],
  vast: ["huur_gebouwen", "lease_rollend", "onderhoud_gebouwen", "onderhoud_materieel", "software_it", "nutsvoorzieningen", "kantoor", "vergoeding_derden", "verzekeringen", "personeel_vast", "afschrijvingen", "voorzieningen", "andere_kosten"],
  bedrijfsresultaat: ["brutomarge", "vast"],
  res_voor_bel: ["bedrijfsresultaat", "fin_opbr", "fin_kosten", "uitz_opbr", "uitz_kosten"],
  res_na_bel: ["res_voor_bel", "belastingen"],
};

const LEASE_ACCTS = new Set(["610100", "610200", "610250", "610260", "610500"]);
// Interne mapping-doelen die in het rapport samenvloeien in één rij:
// huur_rollend + afschr_rollend → lease_rollend (EMAsphere: "Huur en afschrijving
// rollend materieel"); hun EBITDA telt de rollend-afschrijvingen wél terug — wij ook.
const MERGE: Record<string, string> = { huur_rollend: "lease_rollend", afschr_rollend: "lease_rollend" };

/** Rekening → bucket. Nummerreeks eerst; naam alleen waar reeksen dubbelzinnig zijn. */
export function mapAccount(acct: string, name: string, company: string): string {
  const n = (name || "").toLowerCase();
  const c2 = acct.slice(0, 2), c3 = acct.slice(0, 3);
  // ---- opbrengsten ----
  if (c2 === "70") {
    if (acct === "705200") return company === "GPR" ? "niet_recurrent" : "verkoop_andere";
    if (c3 === "700" || c3 === "701") return "verkoop_transport";
    if (c3 === "702") return "verkoop_magazijn";
    // 706-reeks = garagewerking (onderhoud & herstel, truckwash, wax, diesel,
    // AdBlue, recuperatie, verkoop rollend materieel) — vraag David 19/08:
    // 706000 stond onder "Verkoop Andere" terwijl het garage-omzet is (GTG/TDR).
    if (c3 === "704" || c3 === "706") return "verkoop_garage";
    return "verkoop_andere"; // 703 shared services, 705-709 verhuur/kortingen/verschillen
  }
  if (c2 === "71" || c2 === "72") return "verkoop_andere"; // voorraad-/eigen productie (klein)
  if (c2 === "74") {
    if (acct === "740600") return "accijns";
    // Finance 20/08/2026 (via Micheline/boekhouding): meerwaarden op courante
    // realisatie (741000) zijn GEEN bedrijfsopbrengst — eerder uitzonderlijk.
    // Uit de brutomarge, bij de niet-recurrente posten (zoals de GPR-verkoop).
    if (c3 === "741" || /meerwaarde/.test(n)) return "niet_recurrent";
    // David 20/08 ("de brutomarge moet de echte core business tonen"): de
    // personeels- en verzekeringsrecuperaties zijn KOSTENVERMINDERINGEN, geen
    // opbrengsten — gesaldeerd op de kostenlijn waar ze bijhoren (recurrent,
    // dus NIET bij niet_recurrent; bedrijfsresultaat blijft identiek).
    // 743000 vermindering BV, 7441xx recup. gewaarborgd loon/opleiding,
    // 7443xx maaltijdcheques/bedrijfswagen eigen aandeel, 7444xx VAA,
    // 7445xx recup. boetes → personeelskost.
    if (c3 === "743" || acct.startsWith("7441") || acct.startsWith("7443") || acct.startsWith("7444") || acct.startsWith("7445")) return "personeel_vast";
    // 7454xx-7456xx vergoedingen verzekeringen/schadegevallen/arbeidsongevallen
    // → saldering op de verzekeringskost.
    if (acct.startsWith("7454") || acct.startsWith("7455") || acct.startsWith("7456")) return "verzekeringen";
    return "andere_opbr"; // o.a. 749000 blijft wél een echte bedrijfsopbrengst
  }
  if (c2 === "75") return "fin_opbr";
  if (c2 === "76") return "uitz_opbr";
  if (c2 === "77") return "belastingen";
  // ---- kosten ----
  if (c2 === "60") return c3 === "609" || /voorraadwijziging/.test(n) ? "voorraadwijziging" : "onderaanneming";
  if (c2 === "61") {
    if (c3 === "610") {
      // EMAsphere-lijn "Huur & afschrijving rollend materieel": machines/voertuigen/getrokken/logistiek/personenwagens
      if (LEASE_ACCTS.has(acct) || /machine|motorvoertuig|getrokken|logistiek|personenwagen|rollend|trailer|trekker|oplegger|vrachtwagen|heftruck/.test(n)) return "huur_rollend";
      if (/elektriciteit|water|gas|nutsvoorzien|verwarming|stookolie/.test(n)) return "nutsvoorzieningen";
      return "huur_gebouwen";
    }
    if (/software|computer|hardware|informatica/.test(n)) return "software_it";
    if (/motorvoertuig|getrokken|logistiek materiaal|banden/.test(n) && /onderhoud/.test(n)) return "ddg_var";
    if (/onderhoud|ruimdienst/.test(n) && /(gebouw|terrein|parking|kantoor)/.test(n)) return "onderhoud_gebouwen";
    if (/onderhoud/.test(n)) return "onderhoud_materieel"; // machines, installaties, personenwagens
    if (c3 === "612") {
      if (/elektriciteit|aardgas|^gas$|\bgas\b|^water$|verwarming|stookolie/.test(n)) return "nutsvoorzieningen"; // 612100/612150/612160
      return /brandstof|adblue/.test(n) ? "ddg_var" : "kantoor"; // port/leveringen → kantoor
    }
    if (c3 === "613") return /dkv|as24/.test(n) ? "ddg_var" : "vergoeding_derden";
    if (c3 === "614") return "verzekeringen";
    if (c3 === "615") return /verplaatsingskosten zaakvoerder|vervoer/.test(n) ? "vergoeding_derden" : "ddg_var"; // km-heffing/tol/eurovignet/door te rekenen
    if (c3 === "616" || c3 === "617") return "personeel_var"; // uitzendkrachten/interim
    if (/huur/.test(n)) return /voertuig|trekker|trailer|materieel|machine|personenwagen/.test(n) ? "huur_rollend" : "huur_gebouwen";
    if (/telefonie|internet|kantoor|documentatie|port/.test(n)) return "kantoor";
    if (/nutsvoorziening|elektriciteit|water|gas\b/.test(n)) return "nutsvoorzieningen";
    return "vergoeding_derden";
  }
  if (c2 === "62") {
    // arbeiders/chauffeurs = variabel, bedienden = vast (EMAsphere-conventie 62-VAR/62-VAST)
    if (/arbeider|chauffeur|interim/.test(n)) return "personeel_var";
    if (acct === "623710") return "personeel_var"; // maaltijdcheques (detail-grid: variabel)
    return "personeel_vast";
  }
  if (c2 === "63") {
    if (/voorziening|waardeverm/.test(n)) return "voorzieningen";
    if (/motorvoertuig|getrokken|logistiek|rollend|personenwagen/.test(n)) return "afschr_rollend";
    return "afschrijvingen";
  }
  if (c2 === "64") return "andere_kosten";
  if (c2 === "65") return "fin_kosten";
  if (c2 === "66") return "uitz_kosten";
  if (c2 === "67") return "belastingen";
  return "niet_gemapt";
}

interface CoPnl { agg: Record<string, number[]>; unmapped: Record<string, { name: string; ytd: number }>; nonRec: number; acct: Record<string, { bucket: string; name: string; ytd: number; monthly: number[] }>; loon: number[] }

async function accountNames(companyId: string, code: string, token: string): Promise<Record<string, string>> {
  const key = `pnl-acctnames-${code}`;
  const cached = getCache<Record<string, string>>(key);
  if (cached) return cached;
  const names: Record<string, string> = {};
  let url: string | null = `${API_ROOT}/companies(${companyId})/accounts?$select=number,displayName`;
  while (url) {
    const res: Response = await fetchWithRetry(url, {
      headers: { Authorization: `Bearer ${token}`, "Data-Access-Intent": "ReadOnly", Accept: "application/json" },
    }, { timeoutMs: 60_000, maxAttempts: 2 });
    if (!res.ok) break;
    const j: { value?: { number?: string; displayName?: string }[]; "@odata.nextLink"?: string } = await res.json();
    for (const a of j.value || []) if (a.number) names[a.number] = a.displayName || "";
    url = j["@odata.nextLink"] || null;
  }
  setCache(key, names, 720);
  return names;
}

async function buildCompanyPnl(co: { id: string; code: string }, year: number, toIso: string, token: string): Promise<CoPnl> {
  // co6: per rekening ook het maandprofiel (detail moet de gekozen periode
  // volgen, vraag David 19/08 — "detail moet overeenkomen met gekozen periode").
  // co7: meerwaarden→niet_recurrent (bucket zit in de gecachete rij gebakken).
  // co8: personeels-/verzekeringsrecuperaties (743x/744x/7454-7456) gesaldeerd
  // op de kostenlijn i.p.v. Andere Opbrengsten.
  const key = `pnl-co8-${co.code}-${year}-${toIso}`;
  const cached = getCache<CoPnl>(key);
  if (cached) return cached;
  const names = await accountNames(co.id, co.code, token);
  const agg: CoPnl["agg"] = {};
  const unmapped: CoPnl["unmapped"] = {};
  let nonRec = 0;
  const perAcct = new Map<string, number[]>();
  const filter = encodeURIComponent(
    `Posting_Date ge ${year}-01-01 and Posting_Date le ${toIso} and G_L_Account_No ge '600000' and G_L_Account_No le '799999'`
  );
  await pageAllOData(
    `${ODATA_ROOT}/ODataV4/Company('${encodeURIComponent(co.code)}')/Grootboekposten_Excel?$filter=${filter}&$select=Posting_Date,G_L_Account_No,Amount`,
    (e) => {
      const acct = String(e.G_L_Account_No || "");
      const mi = Number(String(e.Posting_Date || "").slice(5, 7)) - 1;
      if (mi < 0 || mi > 11) return;
      // tekenconventie: alles resultaat-positief maken (credit-normaal → −Amount);
      // kosten worden dan vanzelf negatief — zoals in het EMAsphere-grid.
      const v = -((e.Amount as number) || 0);
      const arr = perAcct.get(acct) ?? new Array(12).fill(0);
      arr[mi] += v;
      perAcct.set(acct, arr);
    },
    token
  );
  const acctOut: CoPnl["acct"] = {};
  const loon = new Array(12).fill(0);
  for (const [acct, arr] of perAcct) {
    const bucket = mapAccount(acct, names[acct] || "", co.code);
    const ytdA = arr.reduce((s, x) => s + x, 0);
    if (Math.abs(ytdA) >= 0.5) acctOut[acct] = { bucket, name: names[acct] || "", ytd: r0(ytdA), monthly: arr.map(r0) };
    if (acct.startsWith("6202")) for (let m = 0; m < 12; m++) loon[m] += arr[m];
    if (bucket === "niet_recurrent") { nonRec += arr.reduce((s, x) => s + x, 0); }
    if (bucket === "niet_gemapt") {
      const ytd = arr.reduce((s, x) => s + x, 0);
      if (Math.abs(ytd) >= 0.5) unmapped[acct] = { name: names[acct] || "", ytd: r0(ytd) };
    }
    const dst = (agg[bucket] ??= new Array(12).fill(0));
    for (let m = 0; m < 12; m++) dst[m] += arr[m];
  }
  const bundle: CoPnl = { agg, unmapped, nonRec: r0(nonRec), acct: acctOut, loon };
  setCache(key, bundle, 720);
  return bundle;
}

async function buildMgmtPnl(exclude: string[], extra?: string): Promise<CfoMgmtPnl> {
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const m2 = /^(\d{4})\|([A-Z]{2,5}|ALL)$/.exec(extra || "");
  const year = m2 ? Number(m2[1]) : today.getUTCFullYear();
  const company = m2 ? m2[2] : "ALL";
  const toIso = year === today.getUTCFullYear() ? todayIso : `${year}-12-31`;
  const monthCount = year === today.getUTCFullYear() ? today.getUTCMonth() + 1 : 12;
  const months = Array.from({ length: monthCount }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);

  const token = await getBCToken();
  const raw = await fetchBCCompanies();
  const companies = raw.map((c) => ({ id: String(c.id), code: String(c.name) }))
    .filter((c) => isOperatingCompany(c.code) && !exclude.includes(c.code))
    .filter((c) => company === "ALL" || c.code === company);

  const agg: Record<string, number[]> = {};
  const unmappedAll: CfoMgmtPnl["unmapped"] = [];
  const detailAll: Record<string, PnlDetailRow[]> = {};
  const loonAll = new Array(12).fill(0);
  let nonRec = 0, oldest = "";
  for (let i = 0; i < companies.length; i += 2) {
    const part = await Promise.all(companies.slice(i, i + 2).map(async (c) => ({ code: c.code, b: await buildCompanyPnl(c, year, toIso, token) })));
    for (const { code, b } of part) {
      for (const [k, arr] of Object.entries(b.agg)) {
        const key = MERGE[k] || k;
        const dst = (agg[key] ??= new Array(12).fill(0));
        for (let m = 0; m < 12; m++) dst[m] += arr[m];
        if (k === "afschr_rollend") {
          const d2 = (agg["_afschr_rollend"] ??= new Array(12).fill(0));
          for (let m = 0; m < 12; m++) d2[m] += arr[m];
        }
      }
      for (const [acct, u] of Object.entries(b.unmapped)) unmappedAll.push({ account: acct, name: u.name, company: code, ytd: u.ytd });
      for (const [acct, d] of Object.entries(b.acct)) {
        (detailAll[MERGE[d.bucket] || d.bucket] ??= []).push({ account: acct, name: d.name, company: code, ytd: d.ytd, monthly: (d.monthly || []).slice(0, monthCount), bcUrl: glAccountLink(code, acct) });
      }
      for (let m = 0; m < 12; m++) loonAll[m] += b.loon[m];
      nonRec += b.nonRec;
      if (!oldest) oldest = new Date().toISOString();
    }
  }

  const val = (id: string): number[] => agg[id] ?? new Array(12).fill(0);
  const sumOf = (id: string): number[] => {
    if (!SUMS[id]) return val(id);
    const out = new Array(12).fill(0);
    for (const part of SUMS[id]) {
      const arr = sumOf(part);
      for (let m = 0; m < 12; m++) out[m] += arr[m];
    }
    return out;
  };
  const rows: PnlRow[] = BUCKETS.map((b) => {
    let monthly: number[];
    if (b.id === "brutomarge_pct") {
      const bm = sumOf("brutomarge"), om = sumOf("omzet");
      monthly = bm.map((v, i) => (om[i] ? Math.round((v / om[i]) * 1000) / 10 : 0));
      const ytdOm = om.slice(0, monthCount).reduce((s, x) => s + x, 0);
      const ytdBm = bm.slice(0, monthCount).reduce((s, x) => s + x, 0);
      return { id: b.id, label: b.label, style: b.style, indent: b.indent, monthly: monthly.slice(0, monthCount), ytd: ytdOm ? Math.round((ytdBm / ytdOm) * 1000) / 10 : 0 };
    } else if (b.id === "ebitda") {
      // EMAsphere-conventie: óók de afschrijvingen rollend materieel (die in de
      // huur&afschrijving-rij zitten) terugtellen — geverifieerd tegen GTR Q1.
      const br = sumOf("bedrijfsresultaat"), af = val("afschrijvingen"), vz = val("voorzieningen"), ar = val("_afschr_rollend");
      monthly = br.map((v, i) => v - af[i] - vz[i] - ar[i]);
    } else if (b.id === "niet_gemapt") {
      monthly = val("niet_gemapt");
    } else if (b.id === "niet_recurrent") {
      monthly = val("niet_recurrent");
    } else {
      monthly = sumOf(b.id);
    }
    const cut = monthly.slice(0, monthCount).map(r0);
    return { id: b.id, label: b.label, style: b.style, indent: b.indent, monthly: cut, ytd: r0(cut.reduce((s, x) => s + x, 0)) };
  });

  const resNaBel = rows.find((r) => r.id === "res_na_bel")?.ytd || 0;
  const bruto = Object.entries(agg).filter(([k]) => k !== "niet_recurrent" && k !== "_afschr_rollend").reduce((s, [, arr]) => s + arr.slice(0, monthCount).reduce((a, x) => a + x, 0), 0);
  // Hoort 0 te zijn: alle 60-77 gemapt. Tolerantie €2: per-maand-afronding van de
  // bucketbedragen kan €1 verschil geven (GTG 19/08) — dat is geen mappinggat.
  const controleRuw = resNaBel - r0(bruto);
  const controlelijn = Math.abs(controleRuw) <= 2 ? 0 : r0(controleRuw);

  // Cap 40→150 (20/08): David pivoteert op het detailblad — met 40 viel per
  // bucket een staart kleine firma-regels weg (±€228k op Vergoeding aan derden)
  // en telde de pivot systematisch te weinig. 150 dekt alle buckets volledig
  // (9 firma's × ~15 rekeningen); de somregel blijft de wachter.
  for (const k of Object.keys(detailAll)) {
    detailAll[k].sort((a, b) => Math.abs(b.ytd) - Math.abs(a.ytd));
    detailAll[k] = detailAll[k].slice(0, 150);
  }
  // P&L-klok: D+7-doel per afgesloten maand; "lonen geboekt" = arbeidersbezoldiging
  // (6202xx) aanwezig — de gebruikelijke laatste ontbrekende post van een maand.
  const klok = months.map((m, i) => {
    const end = new Date(Date.UTC(year, i + 1, 0));
    const dl = new Date(end.getTime() + 7 * 864e5);
    return { month: m, deadline: dl.toISOString().slice(0, 10), lonenGeboekt: Math.abs(loonAll[i]) > 1000 };
  });
  unmappedAll.sort((a, b) => Math.abs(b.ytd) - Math.abs(a.ytd));
  return {
    asOf: oldest || new Date().toISOString(), isLive: true, year, company, months,
    rows, unmapped: unmappedAll.slice(0, 40), detail: detailAll, klok, controlelijn, nonRecurringRev: r0(nonRec),
    sources: [
      { label: "Management-P&L (EMAsphere-structuur)", detail: "Grootboekposten_Excel per vennootschap, klassen 60–77, per boekingsmaand. Bucket-indeling = het gevalideerde EMAsphere Operations P&L (mapping gereverse-engineerd 17/08/2026, zie docs/emasphere/). Rekening→bucket op nummerreeks, met naam-regels waar reeksen dubbelzinnig zijn (61x/62x). Bedragen resultaat-conventie: opbrengsten +, kosten −." },
    ],
    notes: [
      "CONTROLELIJN hoort €0 te zijn (gestructureerd resultaat = brute som 60–77). EMAsphere's eigen controlelijn staat op +€1,7M YtD zonder verklaring — hier is elke niet-gemapte rekening zichtbaar in de rij en lijst 'Niet gemapt'.",
      "Verschillen met EMAsphere zijn verklaard en bewust: (1) manuele EMAsphere-adjustments zitten hier niet in (raming accijnsrecuperatie GTR, huur-naar-uitzonderlijk GDI, vakantiegeld-overdracht) — dit toont wat geboekt is; (2) GPR's gebouwenverkoop staat apart als niet-recurrent; (3) scope is alle 11 firma's (EMAsphere: 9, zonder LMB/GEX) tenzij je een firma kiest.",
      "CREDITNOTA'S: dit is grootboek-basis — creditnota's tellen automatisch mee in de maand waarin ze geboekt zijn en salderen dus per periode met de omzet/kosten (meeting-eis). Wordt een CN laat geboekt voor een oude prestatie, dan zit hij in de boekmaand — dat is een boekhoud-, geen rapportagekeuze.",
      "De lopende maand is onvolledig (facturen van maand M worden tot in M+1 geboekt); afschrijvingen/belastingen volgen grotendeels op 31/12 — de laatste kolom is dus structureel te positief.",
      "Provisies (afschrijvingen ÷ 12, vakantiegeld, 13e maand) volgen zodra de accountant de parameters bevestigt — ontwerp goedgekeurd in het ontwerpdossier, cluster A.",
    ],
  };
}

function demoMgmtPnl(): CfoMgmtPnl {
  const today = new Date();
  const year = today.getUTCFullYear();
  const monthCount = today.getUTCMonth() + 1;
  const months = Array.from({ length: monthCount }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const mk = (base: number) => months.map((_, i) => r0(base * (0.92 + 0.03 * (i % 4))));
  const rows: PnlRow[] = BUCKETS.map((b) => {
    const sign = ["variabel", "vast", "onderaanneming", "ddg_var", "personeel_var", "huur_gebouwen", "lease_rollend", "onderhoud_gebouwen", "onderhoud_materieel", "software_it", "nutsvoorzieningen", "kantoor", "vergoeding_derden", "verzekeringen", "personeel_vast", "afschrijvingen", "voorzieningen", "andere_kosten", "fin_kosten", "uitz_kosten", "belastingen"].includes(b.id) ? -1 : 1;
    const monthly = b.id === "brutomarge_pct" ? months.map(() => 28.4) : mk(sign * 900_000);
    return { id: b.id, label: b.label, style: b.style, indent: b.indent, monthly, ytd: r0(monthly.reduce((s, x) => s + x, 0)) };
  });
  return {
    asOf: new Date(0).toISOString(), isLive: false, year, company: "ALL", months, rows,
    unmapped: [], detail: {}, klok: [], controlelijn: 0, nonRecurringRev: 0,
    sources: [{ label: "Management-P&L", detail: "Demomodus." }], notes: ["Voorbeelddata (demomodus)."],
  };
}

// v7: detailrijen dragen het maandprofiel — periode-filter werkt door tot in het detail.
// v8: detailcap 40→150 per bucket (pivot-volledigheid).
// v9: meerwaarden (741000) uit de brutomarge → niet-recurrent (finance 20/08).
// v10: personeels-/verzekeringsrecuperaties uit de brutomarge → saldering op de kostenlijn.
export const getMgmtPnl = makePolledGetter<CfoMgmtPnl>("mgmtpnl-v10", buildMgmtPnl, demoMgmtPnl);
