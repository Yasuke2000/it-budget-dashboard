// ============================================================
// Klanten & cash — DSO per categorie, betaalgedrag, factoring
// ============================================================
// De deep-dive die de CFO vroeg (meeting 08/2026): hoe snel betalen klanten ECHT,
// wat loopt via factoring (KBC/Belfius/BNP), DSO opgesplitst in categorieën
// (extern-factoring / extern-niet-factoring / intercompany), facturatie per week,
// terugboekingen (recourse) en een inningsverwachting op basis van betaalgedrag.
//
// Bronnen (alle live BC, geen $top — pagineren via @odata.nextLink):
//  - Cust_LedgerEntries (ODataV4): alle klantposten → AR-saldi per maandeinde,
//    facturen, open posten. Bedragen INCL. btw (ledger = te ontvangen bedrag).
//  - Gedetailleerde_klantenposten_Excel (ODataV4): Entry_Type='Application' →
//    de ECHTE betaaldatum per factuur (validatie 22/07: enige route naar betaaldata).
//  - VendorLedgerEntries (ODataV4): AP-saldi → DPO ter vergelijking.
//  - generalLedgerEntries 613340: factoringkosten per maand.
//
// Factoring-herkenning: de afwikkeling loopt via herkenbare dagboek-documenten
// (bv. "KBCF-26165/9" = KBC Commercial Finance) en factor-bankrekeningen
// ("Belfius Factor", "KBC FACTORING"). Een klant telt als factoring-klant zodra
// het merendeel van zijn betaald volume via zo'n factor-dagboek liep.

import type {
  CfoReceivables, CfoSource, RcvCustomerRow, RcvDsoSeries, RcvFactorRow,
  RcvInvoiceItem, RcvSpeedBucket, RcvWeekFlow, RcvCashWeekExpectation, RcvCategory,
  CfoBehaviour, RcvPayRow, RcvCustomerRisk, RcvFactorTiming,
} from "./types";
import { getBCToken, fetchBCCompanies } from "./bc-client";
import { fetchWithRetry } from "./http";
import { getCache, setCache } from "./sync-cache";
import { isIcName } from "./cfo";
import { custLedgerDocLink } from "./bc-links";

const ODATA_ROOT = `https://api.businesscentral.dynamics.com/v2.0/${process.env.BC_TENANT_ID}/${process.env.BC_ENVIRONMENT || "production"}`;

function isDemoMode(): boolean { return process.env.NEXT_PUBLIC_DEMO_MODE !== "false"; }
function isOperatingCompany(name: string): boolean { return !/^_/.test(name) && !/test|copie|fleetmate/i.test(name); }
const r0 = (n: number) => Math.round(n);
const r2 = (n: number) => Math.round(n * 100) / 100;

// ---- factor-dagboeken: documentprefix van de afwikkelings-applicatie → factor ----
// Gevalideerd op live data (probes 03/08/2026, jan–jul applicaties):
//   GTR:  KBCF €5,78M + BNPF €2,28M   (KBC CF én BNP Fortis Factor naast elkaar)
//   GDI:  BELF €18,5M                  (bankrekening F01 heet letterlijk "Belfius Factor")
//   WHS:  KBCC €12,5M                  (bankrekening F02 = "KBC FACTORING")
//   TDR:  KBC  €4,6M in slechts 162 lump-afwikkelingen (gem. €28,6k) — afgeleid als
//         KBC CF: enige bankrekening zit in de KBC-CF-reeks (7360…) én GL 499200 bestaat.
// De prefix-betekenis verschilt per firma (bij GTG/GRE/LMB is "KBC" de gewone bank),
// dus de mapping is PER VENNOOTSCHAP. Onbekende prefixen tellen NIET als factoring.
const FACTOR_LABELS: Record<string, string> = {
  KBC: "KBC Commercial Finance",
  Belfius: "Belfius Commercial Finance",
  BNP: "BNP Paribas Fortis Factor",
};
const FACTOR_JOURNALS: Record<string, Record<string, string>> = {
  GTR: { KBCF: "KBC", BNPF: "BNP" },
  GDI: { BELF: "Belfius" },
  WHS: { KBCC: "KBC" },
  TDR: { KBC: "KBC" },
};
// Factoringkosten-herkenning op rekening 650000 (waar de factor-rente bij Gheeraert
// staat, náást gewone financieringsrente). Match op de tegenpartij/omschrijving:
// "BNP Paribas Fortis Factor", "BELFIUS COMMERCIAL FINANCE", "KBC COMM.FIN.FACTORING".
// LET OP: "ES FINANCE", "KBC BANK LEASING" en "VFS FINANCIAL SERVICES" mogen NIET
// matchen — dat zijn leasing/vastgoed, geen factoring.
const FACTORING_COST_RX = /factoring|comm\.?\s*fin\b|commercial\s*finance|\bfactor\b/i;
// Per firma bekende factoringcontract-referenties die als reclass-boeking op 650000
// terechtkomen zonder de naam van de factor (GTR: BNP-contract 0003946/001).
const FACTORING_COST_REFS: Record<string, RegExp> = { GTR: /0003946/ };

// Eenmalige, niet-operationele verkopen die de DSO-noemer zouden vertekenen.
// GPR/ES Finance = de sale-and-leaseback van de gebouwen (maart 2026, €10,6M).
const DSO_SALES_EXCLUDE: { co: string; custRx: RegExp; minAmt: number }[] = [
  { co: "GPR", custRx: /\bES[\s-]?FINANCE\b/i, minAmt: 1_000_000 },
];

const factorKeyOf = (company: string, docNo: string): string | null => {
  const map = FACTOR_JOURNALS[company];
  if (!map) return null;
  const m = (docNo || "").match(/^[A-Za-z]+/);
  return m ? map[m[0].toUpperCase()] || null : null;
};

// Naamnormalisatie voor klant-merge over firma's heen (zelfde als aging-export).
// Geëxporteerd: ook de geconsolideerde P&L (lib/units.ts) groepeert er tegenpartijen mee.
const PREFIX_RX = /^(GTR|GTG|GSS|GPR|TFO|GDI|GRE|WHS|TDR|LMB|GEX)\s*-\s*/i;
const LEGAL_RX = /\b(NV\/SA|NV|SA|BVBA|BV|VOF|GMBH|LTD|INC|SPRL|SCRL|CVBA|COMM\.?\s*V|SRL|SARL|GCV)\b\.?/gi;
export function normName(name: string): string {
  let n = (name || "").toUpperCase();
  n = n.replace(PREFIX_RX, "").replace(LEGAL_RX, " ").replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  return n || (name || "").toUpperCase().trim();
}

// ---- datum-helpers (UTC) ----
function iso(d: Date): string { return d.toISOString().slice(0, 10); }
function mondayOf(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
}
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }
function monthEndISO(y: number, m0: number): string { return iso(new Date(Date.UTC(y, m0 + 1, 0))); }
function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86400000);
}
function cleanDate(v: unknown): string {
  const s = String(v || "");
  return s && !s.startsWith("0001") ? s.slice(0, 10) : "";
}

// Maandvenster: laatste N maanden (oudste eerst), inclusief de lopende maand.
const WINDOW_MONTHS = 19; // 19 → YoY-vergelijking in de grafiek mogelijk
interface MonthWindow { keys: string[]; ends: string[]; daysIn: number[] }
function buildWindow(today: Date): MonthWindow {
  const keys: string[] = []; const ends: string[] = []; const daysIn: number[] = [];
  for (let i = WINDOW_MONTHS - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
    keys.push(d.toISOString().slice(0, 7));
    ends.push(monthEndISO(d.getUTCFullYear(), d.getUTCMonth()));
    daysIn.push(Number(monthEndISO(d.getUTCFullYear(), d.getUTCMonth()).slice(8, 10)));
  }
  return { keys, ends, daysIn };
}

// Paginering. De pagina-limiet is een runaway-beveiliging, GEEN stille afkapping:
// bij het bereiken ervan gooien we, want stil afkappen is exact de klasse fout die
// eerder €776k aan openstaande posten liet verdwijnen (de $top-les).
async function pageAll(url: string, token: string, cb: (row: Record<string, unknown>) => void): Promise<void> {
  const MAX_PAGES = 800;
  let next: string | null = url; let page = 0;
  while (next && page < MAX_PAGES) {
    const res: Response = await fetchWithRetry(next, {
      headers: { Authorization: `Bearer ${token}`, "Data-Access-Intent": "ReadOnly", Accept: "application/json" },
    }, { timeoutMs: 90_000, maxAttempts: 3 });
    if (!res.ok) throw new Error(`BC ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const data: { value?: Record<string, unknown>[]; "@odata.nextLink"?: string } = await res.json();
    for (const v of data.value || []) cb(v);
    next = data["@odata.nextLink"] || null;
    page++;
  }
  if (next) throw new Error(`BC-paginering overschreed ${MAX_PAGES} pagina's — data zou stil afgekapt worden: ${url.slice(0, 120)}`);
}

// ============================================================
// Per-vennootschap bundel (individueel gecachet, 12h)
// ============================================================
interface InvoiceRec {
  entryNo: number; co: string; cust: string; rawCust: string; custNo: string; doc: string;
  invDate: string; due: string; amt: number; open: boolean; rem: number; ic: boolean;
  paidAt: string | null; via: string | null; applied: number; bu: string;
}
interface CompanyRcvBundle {
  code: string;
  // compacte klantposten voor AR-saldo per maandeinde: [maandIdx(-1=vóór venster), bedrag, klantKey]
  arRows: [number, number, string][];
  apMonthly: { end: number[]; purch: number[] };   // AP-saldo per maandeinde + inkopen per maand (extern)
  invoices: InvoiceRec[];                           // facturen binnen het venster + ALLE open facturen
  factorVolumeByCust: Record<string, Record<string, number>>; // klantKey → factorKey → betaald volume
  paidVolumeByCust: Record<string, number>;
  unapplied: { date: string; amt: number; entryNo: number }[];
  factoringCost: Record<string, number>;            // maand → factorcommissie (613340, kl. 61)
  factoringInterest: Record<string, number>;        // maand → rente/disconto (653x, kl. 65 — CBN 2011/23)
  creditByCust: Record<string, number>;             // klantKey → som kredietlimieten (klantkaarten)
  contactByCust: Record<string, { phone: string; email: string }>; // voor de sales-bellijst
  dimOk: boolean;                                   // false = dimensiepull mislukte (geen "AFDELING ontbreekt"-claim doen)
  degraded: boolean;                                // true = fallback-veldenset gebruikt (open bedragen bruto benaderd)
  earliestEntry: string;                            // vroegste klantpost (beginbalans-check)
}

async function buildCompanyRcvBundle(
  co: { id: string; code: string }, win: MonthWindow, today: Date
): Promise<CompanyRcvBundle> {
  const key = `rcv-co4-${co.code}-${win.keys[win.keys.length - 1]}`;
  const cached = getCache<CompanyRcvBundle>(key);
  if (cached) return cached;

  const token = await getBCToken();

  // ---- 0a. Dimensiesets → AFDELING (business unit) per Dimension_Set_ID ----
  // `dimOk` onderscheidt "de dimensie is niet ingevuld" van "de query mislukte" —
  // zonder die vlag zou een netwerkfout een onterecht actiepunt naar finance sturen
  // ("AFDELING ontbreekt"). Audit 04/08/2026.
  const buBySet: Record<number, string> = {};
  let dimOk = true;
  try {
    await pageAll(`${ODATA_ROOT}/ODataV4/Company('${encodeURIComponent(co.code)}')/DimensionSetEntries?$filter=${encodeURIComponent("Dimension_Code eq 'AFDELING'")}&$select=Dimension_Set_ID,Dimension_Value_Code`, token, (e) => {
      buBySet[Number(e.Dimension_Set_ID) || 0] = String(e.Dimension_Value_Code || "");
    });
  } catch { dimOk = false; }

  // ---- 0b. Kredietlimieten van de klantkaarten (customersGT) ----
  const creditByNo: Record<string, number> = {};
  const contactByNo: Record<string, { phone: string; email: string }> = {};
  try {
    await pageAll(`${ODATA_ROOT}/api/gmi/CustomersGMI/v2.0/companies(${co.id})/customersGT?$select=number,creditLimit,displayName,phoneNumber,email`, token, (e) => {
      const no = String(e.number || "");
      const lim = (e.creditLimit as number) || 0;
      if (lim > 0) creditByNo[no] = lim;
      const phone = String(e.phoneNumber || "").trim(), email = String(e.email || "").trim();
      if (phone || email) contactByNo[no] = { phone, email };
    });
  } catch { /* gmi-API niet beschikbaar → geen limieten/contactgegevens */ }
  const windowStart = `${win.keys[0]}-01`;
  const todayIso = iso(today);
  const monthIdx = (pd: string): number => {
    const k = pd.slice(0, 7);
    const i = win.keys.indexOf(k);
    return i >= 0 ? i : (pd < windowStart ? -1 : win.keys.length - 1);
  };

  const arRows: [number, number, string][] = [];
  const invoices: InvoiceRec[] = [];
  const invByEntry = new Map<number, InvoiceRec>();
  let earliestEntry = "9999-12-31";

  // ---- 1. Klantposten (volledige historie; GEEN $top) ----
  const cleSel = "$select=Entry_No,Posting_Date,Document_Date,Due_Date,Document_Type,Amount_LCY,Remaining_Amt_LCY,IC_Partner_Code,Open,Customer_Name,Customer_No,Document_No,Dimension_Set_ID";
  const cleUrl = `${ODATA_ROOT}/ODataV4/Company('${encodeURIComponent(co.code)}')/Cust_LedgerEntries?${cleSel}`;
  const handleCle = (e: Record<string, unknown>) => {
    const pd = cleanDate(e.Posting_Date); if (!pd) return;
    if (pd > todayIso) return; // vooruit-gedateerde boekingen tellen niet stil mee (les uit de cockpit)
    if (pd < earliestEntry) earliestEntry = pd;
    const amt = (e.Amount_LCY as number) || 0;
    const rawCust = String(e.Customer_Name || "").trim();
    const cust = normName(rawCust);
    const ic = isIcName(rawCust) || Boolean(String(e.IC_Partner_Code || "").trim());
    arRows.push([monthIdx(pd), amt, ic ? ` IC` : cust]); // IC krijgt een sentinel-key
    // Binnen het venster ÉN altijd wanneer nog open — ook oeroude open posten
    // horen in het open-postenbeeld (anders wijkt het totaal af van BC's aging).
    // Creditnota's tellen mee (negatief): ze netten de maandfacturatie (DSO-noemer =
    // netto verkoop) en open CN's horen in het open-totaal; betaalgedrag-statistieken
    // filteren op amt>0 en blijven dus factuur-zuiver.
    if ((e.Document_Type === "Invoice" || e.Document_Type === "Credit Memo") && (pd >= windowStart || e.Open)) {
      const rec: InvoiceRec = {
        entryNo: Number(e.Entry_No) || 0, co: co.code, cust, rawCust,
        custNo: String(e.Customer_No || ""),
        doc: String(e.Document_No || ""),
        invDate: cleanDate(e.Document_Date) || pd, due: cleanDate(e.Due_Date),
        amt: r2(amt), open: Boolean(e.Open), rem: r2((e.Remaining_Amt_LCY as number) ?? (e.Open ? amt : 0)),
        ic, paidAt: null, via: null, applied: 0,
        bu: buBySet[Number(e.Dimension_Set_ID) || 0] || "",
      };
      invoices.push(rec); invByEntry.set(rec.entryNo, rec);
    }
  };
  let degraded = false;
  try {
    await pageAll(cleUrl, token, handleCle);
  } catch {
    // Val terug op de bewezen veldenset (pull-dso). LET OP: die mist Remaining_Amt_LCY,
    // Customer_No en Dimension_Set_ID → open bedragen worden dan bruto benaderd
    // (deelbetalingen niet verrekend), kredietlimieten en BU vallen weg. Dat mag
    // NIET stil gebeuren: `degraded` zet een zichtbare datakwaliteitsmelding.
    degraded = true;
    arRows.length = 0; invoices.length = 0; invByEntry.clear();
    const sel2 = "$select=Entry_No,Posting_Date,Document_Date,Due_Date,Document_Type,Amount_LCY,IC_Partner_Code,Open,Customer_Name,Document_No";
    await pageAll(`${ODATA_ROOT}/ODataV4/Company('${encodeURIComponent(co.code)}')/Cust_LedgerEntries?${sel2}`, token, handleCle);
  }

  // Kredietlimiet + contactgegevens per genormaliseerde klantnaam.
  const creditByCust: Record<string, number> = {};
  const contactByCust: Record<string, { phone: string; email: string }> = {};
  const seenCustNo = new Set<string>();
  for (const inv of invoices) {
    if (inv.ic || !inv.custNo || seenCustNo.has(inv.custNo)) continue;
    seenCustNo.add(inv.custNo);
    const lim = creditByNo[inv.custNo];
    if (lim) creditByCust[inv.cust] = (creditByCust[inv.cust] || 0) + lim;
    const ct = contactByNo[inv.custNo];
    if (ct && !contactByCust[inv.cust]) contactByCust[inv.cust] = ct;
  }

  // ---- 2. Betalings-applicaties (echte betaaldatum) ----
  const factorVolumeByCust: Record<string, Record<string, number>> = {};
  const paidVolumeByCust: Record<string, number> = {};
  const unapplied: { date: string; amt: number; entryNo: number }[] = [];
  const appSel = "$select=Cust_Ledger_Entry_No,Posting_Date,Amount_LCY,Document_No,Unapplied,Entry_Type";
  const appFilter = encodeURIComponent(`Entry_Type eq 'Application' and Posting_Date ge ${windowStart}`);
  await pageAll(
    `${ODATA_ROOT}/ODataV4/Company('${encodeURIComponent(co.code)}')/Gedetailleerde_klantenposten_Excel?$filter=${appFilter}&${appSel}`,
    token,
    (a) => {
      const amt = (a.Amount_LCY as number) || 0;
      const pd = cleanDate(a.Posting_Date);
      const inv = invByEntry.get(Number(a.Cust_Ledger_Entry_No) || -1);
      if (a.Unapplied) {
        // Teruggeboekte toewijzing (bv. factor neemt een inning terug / correctie).
        if (amt < 0 && pd >= iso(addDays(today, -365))) unapplied.push({ date: pd, amt: r2(-amt), entryNo: Number(a.Cust_Ledger_Entry_No) || 0 });
        return;
      }
      if (!inv || amt >= 0) return; // alleen de factuurzijde (negatief) telt als "betaald"
      const paid = -amt;
      inv.applied = r2(inv.applied + paid);
      if (!inv.paidAt || pd > inv.paidAt) inv.paidAt = pd;
      const fk = factorKeyOf(co.code, String(a.Document_No || ""));
      if (fk) inv.via = fk;
      if (!inv.ic) {
        paidVolumeByCust[inv.cust] = (paidVolumeByCust[inv.cust] || 0) + paid;
        if (fk) {
          (factorVolumeByCust[inv.cust] = factorVolumeByCust[inv.cust] || {})[fk] =
            (factorVolumeByCust[inv.cust][fk] || 0) + paid;
        }
      }
    }
  );

  // ---- 3. Leveranciersposten → DPO (extern) ----
  const apEnd = new Array(win.keys.length).fill(0);
  const apPurch = new Array(win.keys.length).fill(0);
  await pageAll(
    `${ODATA_ROOT}/ODataV4/Company('${encodeURIComponent(co.code)}')/VendorLedgerEntries?$select=Posting_Date,Document_Type,Amount_LCY,IC_Partner_Code,Vendor_Name`,
    token,
    (e) => {
      const nm = String(e.Vendor_Name || "");
      if (isIcName(nm) || String(e.IC_Partner_Code || "").trim()) return;
      const pd = cleanDate(e.Posting_Date); if (!pd || pd > todayIso) return;
      const amt = (e.Amount_LCY as number) || 0;
      const mi = monthIdx(pd);
      // saldo: post telt mee in alle maandeindes vanaf zijn boekmaand
      for (let i = Math.max(mi, 0); i < win.keys.length; i++) if (mi <= i) apEnd[i] += amt;
      if (mi >= 0 && e.Document_Type === "Invoice") apPurch[mi] += Math.abs(amt);
    }
  );

  // ---- 4. Factoringkosten per maand: commissie (613340) + rente (650000) ----
  // Gecorrigeerd 04/08/2026 op aanwijzing van de CFO en geverifieerd tegen de data:
  // de factorCOMMISSIE staat op 613340 (klasse 61 — conform CBN-advies 2011/23), maar de
  // RENTE staat bij Gheeraert niet op 653x (dat is leeg) wél op **650000**, samen met
  // gewone financieringsrente. Rekening 650000 mag dus NOOIT integraal meegeteld worden
  // (daar zit o.a. €123k GPR-straight-loan-rente in) — we nemen enkel de posten waarvan
  // de tegenpartij/omschrijving de factormaatschappij aanwijst. Zo reproduceert de som
  // exact de €119.025 die finance voor H1-2026 verwachtte.
  const factoringCost: Record<string, number> = {};
  const factoringInterest: Record<string, number> = {};
  try {
    const glFilter = encodeURIComponent(
      `Posting_Date ge ${win.keys[0]}-01 and Posting_Date le ${todayIso} and (G_L_Account_No eq '613340' or G_L_Account_No eq '650000')`
    );
    await pageAll(
      `${ODATA_ROOT}/ODataV4/Company('${encodeURIComponent(co.code)}')/Grootboekposten_Excel?$filter=${glFilter}&$select=Posting_Date,G_L_Account_No,Amount,Description,ESCW_Source_Name`,
      token,
      (g) => {
        const m = String(g.Posting_Date || "").slice(0, 7);
        const amt = (g.Amount as number) || 0;
        if (String(g.G_L_Account_No) === "613340") { factoringCost[m] = (factoringCost[m] || 0) + amt; return; }
        const tag = `${String(g.ESCW_Source_Name || "")} ${String(g.Description || "")}`;
        const ref = FACTORING_COST_REFS[co.code];
        if (FACTORING_COST_RX.test(tag) || (ref && ref.test(tag))) {
          factoringInterest[m] = (factoringInterest[m] || 0) + amt;
        }
      }
    );
  } catch { /* geen 613340/650000 in deze firma */ }

  const bundle: CompanyRcvBundle = {
    code: co.code, arRows, apMonthly: { end: apEnd.map(r2), purch: apPurch.map(r2) },
    invoices, factorVolumeByCust, paidVolumeByCust, unapplied, factoringCost, factoringInterest, creditByCust, contactByCust, earliestEntry,
    dimOk, degraded,
  };
  setCache(key, bundle, 720);
  return bundle;
}

// ============================================================
// Combineren tot het CfoReceivables-payload
// ============================================================
function combineRcv(bundles: CompanyRcvBundle[], win: MonthWindow, today: Date, excluded: string[]): CfoReceivables {
  const n = win.keys.length;

  // ---- klantclassificatie: factoring-klant = meerderheid betaald volume via factor ----
  const paidByCust: Record<string, number> = {};
  const factorByCust: Record<string, Record<string, number>> = {};
  for (const b of bundles) {
    for (const [c, v] of Object.entries(b.paidVolumeByCust)) paidByCust[c] = (paidByCust[c] || 0) + v;
    for (const [c, m] of Object.entries(b.factorVolumeByCust)) {
      const dst = (factorByCust[c] = factorByCust[c] || {});
      for (const [f, v] of Object.entries(m)) dst[f] = (dst[f] || 0) + v;
    }
  }
  const custFactorShare: Record<string, number> = {};
  const custDominantFactor: Record<string, string> = {};
  for (const [c, total] of Object.entries(paidByCust)) {
    const fv = Object.entries(factorByCust[c] || {});
    const fSum = fv.reduce((s, [, v]) => s + v, 0);
    custFactorShare[c] = total > 0 ? fSum / total : 0;
    if (fv.length) custDominantFactor[c] = fv.sort((a, b) => b[1] - a[1])[0][0];
  }
  const isFactored = (cust: string): boolean => (custFactorShare[cust] || 0) >= 0.4;
  const catOf = (key: string): RcvCategory => (key === " IC" ? "ic" : isFactored(key) ? "extFactoring" : "extOther");

  // ---- AR-saldo per maandeinde per categorie + verkopen per maand per categorie ----
  const zero = () => new Array(n).fill(0);
  const arEndByCat: Record<RcvCategory, number[]> = { extFactoring: zero(), extOther: zero(), ic: zero() };
  for (const b of bundles) {
    for (const [mi, amt, key] of b.arRows) {
      const cat = catOf(key);
      for (let i = Math.max(mi, 0); i < n; i++) if (mi <= i) arEndByCat[cat][i] += amt;
    }
  }
  // Niet-recurrente verkopen horen NIET in de DSO-noemer: de vastgoedverkoop van GPR
  // aan ES Finance (€10,6M, maart 2026) drukte de maart-DSO naar 20 dagen terwijl er
  // operationeel niets veranderde. Het gevalideerde DSO-Excel van juli haalde die post
  // om precies dezelfde reden uit de noemer; hier doen we dat expliciet en zichtbaar.
  const salesByCat: Record<RcvCategory, number[]> = { extFactoring: zero(), extOther: zero(), ic: zero() };
  const oneOffSales: { month: string; cust: string; amount: number }[] = [];
  for (const b of bundles) {
    for (const inv of b.invoices) {
      const mi = win.keys.indexOf(inv.invDate.slice(0, 7));
      if (mi < 0) continue;
      if (DSO_SALES_EXCLUDE.some((x) => x.co === b.code && x.custRx.test(inv.rawCust) && inv.amt >= x.minAmt)) {
        oneOffSales.push({ month: inv.invDate.slice(0, 7), cust: inv.rawCust, amount: r0(inv.amt) });
        continue;
      }
      salesByCat[inv.ic ? "ic" : isFactored(inv.cust) ? "extFactoring" : "extOther"][mi] += inv.amt;
    }
  }

  // ---- DSO/DPO per maand (balansmethode) ----
  // RIJPHEIDSDREMPEL (CFO-feedback 04/08/2026): een maand waarvan de facturatie nog
  // niet (volledig) geboekt is geeft een absurde DSO — augustus met €2.463 omzet tegen
  // €10M openstaand leverde 127.000 dagen op en blies de grafiekschaal op, waardoor de
  // hele historiek visueel verdween. Een maand telt daarom alleen mee als haar omzet
  // minstens 25% van de mediane maandomzet bedraagt; anders `null` (geen punt).
  // Een maand is pas "rijp" als (a) we minstens 25 dagen ná haar einde zijn — facturen
  // van maand M worden tot ver in M+1 geboekt — én (b) haar omzet niet wegvalt tegen de
  // mediaan (dekt firma's met een onvolledige historie). Zonder (a) gaf juli nog 112
  // dagen omdat pas een derde van de julifacturatie geboekt was.
  const matureIdx = today.getUTCDate() >= 25 ? n - 2 : n - 3;
  const medianOf = (xs: number[]): number => {
    const s = xs.filter((x) => x > 0).sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : 0;
  };
  const dsoOf = (ar: number[], sales: number[]): (number | null)[] => {
    const floor = Math.max(1000, medianOf(sales.slice(0, matureIdx + 1)) * 0.25);
    return win.keys.map((_, i) => (i <= matureIdx && sales[i] >= floor ? r0((ar[i] / sales[i]) * win.daysIn[i]) : null));
  };
  const arExt = win.keys.map((_, i) => arEndByCat.extFactoring[i] + arEndByCat.extOther[i]);
  const salesExt = win.keys.map((_, i) => salesByCat.extFactoring[i] + salesByCat.extOther[i]);
  const apEnd = zero(); const apPurch = zero();
  for (const b of bundles) for (let i = 0; i < n; i++) { apEnd[i] += b.apMonthly.end[i]; apPurch[i] += b.apMonthly.purch[i]; }
  // Countback (best practice bij schommelende omzet): vanaf het AR-eindsaldo maanden
  // terugtellen tegen de werkelijke maandomzetten tot het saldo "op" is.
  const countbackAt = (i: number): number | null => {
    let rem = arExt[i];
    if (rem <= 0) return 0;
    let days = 0;
    for (let m = i; m >= 0; m--) {
      const s = salesExt[m];
      if (s <= 0) continue;
      if (rem >= s) { days += win.daysIn[m]; rem -= s; }
      else { days += (rem / s) * win.daysIn[m]; rem = 0; break; }
    }
    return rem > 0 ? null : r0(days); // null = venster te kort om het saldo af te dekken
  };
  const dso: RcvDsoSeries = {
    months: win.keys,
    dsoTotal: dsoOf(arExt, salesExt),
    dsoExtFactoring: dsoOf(arEndByCat.extFactoring, salesByCat.extFactoring),
    dsoExtOther: dsoOf(arEndByCat.extOther, salesByCat.extOther),
    // Countback alleen op rijpe maanden (zelfde drempel als de balansmethode).
    dsoCountback: win.keys.map((_, i) => (dsoOf(arExt, salesExt)[i] == null ? null : countbackAt(i))),
    dpoTotal: dsoOf(apEnd.map((x) => -x), apPurch),
    arEndByCat: {
      extFactoring: arEndByCat.extFactoring.map(r0), extOther: arEndByCat.extOther.map(r0), ic: arEndByCat.ic.map(r0),
    },
    salesByCat: {
      extFactoring: salesByCat.extFactoring.map(r0), extOther: salesByCat.extOther.map(r0), ic: salesByCat.ic.map(r0),
    },
  };
  // "Nu" = laatste RIJPE maand (zie matureIdx hierboven): facturen van maand M worden
  // tot ver in M+1 geboekt, dus M is pas bruikbaar zodra we ±25 dagen voorbij het
  // maandeinde zijn. Live-check 04/08: juli gaf 112d met slechts een derde van de
  // julifacturatie geboekt — vandaar dezelfde drempel voor KPI én grafiek.
  const nowIdx = matureIdx;
  const dsoNow = {
    total: dso.dsoTotal[nowIdx], extFactoring: dso.dsoExtFactoring[nowIdx],
    extOther: dso.dsoExtOther[nowIdx], countback: dso.dsoCountback[nowIdx],
    dpo: dso.dpoTotal[nowIdx], asOfMonth: win.keys[nowIdx],
  };

  // ---- factuur-niveau betaalgedrag ----
  const paidInvoices: InvoiceRec[] = [];
  for (const b of bundles) for (const inv of b.invoices) {
    if (!inv.ic && !inv.open && inv.paidAt && inv.amt > 0) paidInvoices.push(inv);
  }
  let wSum = 0, wDays = 0, onTimeAmt = 0, dueAmt = 0;
  const daysList: { d: number; amt: number }[] = [];
  const buckets: Record<string, { amount: number; count: number }> = {};
  const BUCKETS: [string, (d: number) => boolean][] = [
    ["Op tijd / te vroeg", (d) => d <= 0],
    ["1–15d te laat", (d) => d >= 1 && d <= 15],
    ["16–30d", (d) => d >= 16 && d <= 30],
    ["31–60d", (d) => d >= 31 && d <= 60],
    ["61–90d", (d) => d >= 61 && d <= 90],
    ["> 90d te laat", (d) => d > 90],
  ];
  for (const inv of paidInvoices) {
    const dtp = daysBetween(inv.invDate, inv.paidAt!);
    if (dtp < -5 || dtp > 500) continue; // datavervuiling
    wSum += inv.amt; wDays += dtp * inv.amt;
    daysList.push({ d: dtp, amt: inv.amt });
    if (inv.due) {
      const vsDue = daysBetween(inv.due, inv.paidAt!);
      dueAmt += inv.amt;
      if (vsDue <= 0) onTimeAmt += inv.amt;
      const bucket = BUCKETS.find(([, fn]) => fn(vsDue));
      if (bucket) {
        (buckets[bucket[0]] = buckets[bucket[0]] || { amount: 0, count: 0 });
        buckets[bucket[0]].amount += inv.amt; buckets[bucket[0]].count++;
      }
    }
  }
  daysList.sort((a, b) => a.d - b.d);
  let cum = 0; let medianDays: number | null = null;
  for (const x of daysList) { cum += x.amt; if (cum >= wSum / 2) { medianDays = x.d; break; } }
  const speedBuckets: RcvSpeedBucket[] = BUCKETS.map(([label]) => ({
    label, amount: r0(buckets[label]?.amount || 0), count: buckets[label]?.count || 0,
  }));
  const dsoInvoiceLevel = {
    avgDays: wSum ? r0(wDays / wSum) : null,
    medianDays,
    onTimePct: dueAmt ? Math.round((onTimeAmt / dueAmt) * 1000) / 10 : null,
    note: "Bedrag-gewogen, alleen VOLLEDIG betaalde externe facturen — recente facturen die nog openstaan tellen niet mee (survivorship): de werkelijke DSO ligt dus iets hoger.",
  };

  // ---- klantentabel (top op gefactureerd 12m) ----
  const floor12m = iso(addDays(today, -365));
  interface CustAgg {
    companies: Set<string>; invoiced12m: number; openNow: number; overdueNow: number;
    paidCount: number; wAmt: number; wDays: number; wDueAmt: number; wDueDays: number; ic: boolean;
  }
  const custAgg = new Map<string, CustAgg>();
  const todayIso = iso(today);
  for (const b of bundles) for (const inv of b.invoices) {
    const a = custAgg.get(inv.cust) || {
      companies: new Set<string>(), invoiced12m: 0, openNow: 0, overdueNow: 0,
      paidCount: 0, wAmt: 0, wDays: 0, wDueAmt: 0, wDueDays: 0, ic: inv.ic,
    };
    a.companies.add(inv.co);
    if (inv.invDate >= floor12m) a.invoiced12m += inv.amt;
    if (inv.open) {
      const openAmt = inv.rem || inv.amt - inv.applied;
      a.openNow += openAmt;
      if (inv.due && inv.due < todayIso) a.overdueNow += openAmt;
    } else if (inv.paidAt) {
      const dtp = daysBetween(inv.invDate, inv.paidAt);
      if (dtp >= -5 && dtp <= 500) {
        a.paidCount++; a.wAmt += inv.amt; a.wDays += dtp * inv.amt;
        if (inv.due) { a.wDueAmt += inv.amt; a.wDueDays += daysBetween(inv.due, inv.paidAt) * inv.amt; }
      }
    }
    custAgg.set(inv.cust, a);
  }
  const creditMerged: Record<string, number> = {};
  for (const b of bundles) for (const [c, v] of Object.entries(b.creditByCust)) creditMerged[c] = (creditMerged[c] || 0) + v;
  const customers: RcvCustomerRow[] = [...custAgg.entries()]
    .filter(([, a]) => a.invoiced12m > 0 || a.openNow > 500)
    .map(([name, a]) => {
      const lim = creditMerged[name] || 0;
      return {
        name, companies: [...a.companies].sort(),
        invoiced12m: r0(a.invoiced12m), openNow: r0(a.openNow), overdueNow: r0(a.overdueNow),
        paidCount: a.paidCount,
        avgDaysToPay: a.wAmt ? r0(a.wDays / a.wAmt) : null,
        avgDaysVsDue: a.wDueAmt ? r0(a.wDueDays / a.wDueAmt) : null,
        factoredSharePct: Math.round((custFactorShare[name] || 0) * 1000) / 10,
        ic: a.ic,
        creditLimit: lim ? r0(lim) : null,
        creditUsedPct: lim > 0 ? Math.round((a.openNow / lim) * 1000) / 10 : null,
      };
    })
    .sort((a, b) => b.invoiced12m - a.invoiced12m)
    .slice(0, 60);

  // ---- business units (dimensie AFDELING op de factuur) ----
  interface BuAgg { invoiced12m: number; openNow: number; wAmt: number; wDays: number; count: number }
  const buAgg = new Map<string, BuAgg>();
  for (const b of bundles) for (const inv of b.invoices) {
    if (inv.ic) continue;
    const code = inv.bu || "(geen)";
    const a = buAgg.get(code) || { invoiced12m: 0, openNow: 0, wAmt: 0, wDays: 0, count: 0 };
    if (inv.invDate >= floor12m) { a.invoiced12m += inv.amt; a.count++; }
    if (inv.open) a.openNow += inv.rem || inv.amt - inv.applied;
    if (!inv.open && inv.paidAt) {
      const dtp = daysBetween(inv.invDate, inv.paidAt);
      if (dtp >= -5 && dtp <= 500) { a.wAmt += inv.amt; a.wDays += dtp * inv.amt; }
    }
    buAgg.set(code, a);
  }
  const businessUnits = [...buAgg.entries()]
    .map(([code, a]) => ({
      code,
      invoiced12m: r0(a.invoiced12m), openNow: r0(a.openNow),
      avgDaysToPay: a.wAmt ? r0(a.wDays / a.wAmt) : null,
      invoiceCount12m: a.count,
    }))
    .sort((a, b) => b.invoiced12m - a.invoiced12m);

  // ---- facturatie per week (26w, excl. IC) ----
  const weekStart0 = mondayOf(addDays(today, -25 * 7));
  const weekFlow: RcvWeekFlow[] = Array.from({ length: 26 }, (_, i) => ({
    weekStart: iso(addDays(weekStart0, i * 7)), factored: 0, other: 0, count: 0,
  }));
  for (const b of bundles) for (const inv of b.invoices) {
    if (inv.ic || inv.amt <= 0) continue;
    const wi = Math.floor(daysBetween(iso(weekStart0), inv.invDate) / 7);
    if (wi < 0 || wi >= 26) continue;
    if (isFactored(inv.cust)) weekFlow[wi].factored += inv.amt; else weekFlow[wi].other += inv.amt;
    weekFlow[wi].count++;
  }
  for (const w of weekFlow) { w.factored = r0(w.factored); w.other = r0(w.other); }

  // ---- per factor: volume, afwikkelsnelheid, open posten ----
  const factorAgg = new Map<string, { cos: Set<string>; settled: number; days: { d: number; amt: number }[]; open: number; open90: number }>();
  for (const key of Object.keys(FACTOR_LABELS)) factorAgg.set(key, { cos: new Set(), settled: 0, days: [], open: 0, open90: 0 });
  for (const b of bundles) for (const inv of b.invoices) {
    if (inv.ic) continue;
    if (inv.via && factorAgg.has(inv.via) && inv.paidAt && inv.paidAt >= floor12m) {
      const f = factorAgg.get(inv.via)!;
      f.cos.add(inv.co); f.settled += inv.applied || inv.amt;
      const d = daysBetween(inv.invDate, inv.paidAt);
      if (d >= 0 && d <= 500) f.days.push({ d, amt: inv.amt });
    }
    if (inv.open && isFactored(inv.cust)) {
      const fk = custDominantFactor[inv.cust];
      const f = fk ? factorAgg.get(fk) : null;
      if (f) {
        const openAmt = inv.rem || inv.amt - inv.applied;
        f.open += openAmt;
        if (inv.due && daysBetween(inv.due, todayIso) > 90) f.open90 += openAmt;
      }
    }
  }
  const factors: RcvFactorRow[] = [...factorAgg.entries()]
    .filter(([, f]) => f.settled > 0 || f.open > 0)
    .map(([key, f]) => {
      f.days.sort((a, b) => a.d - b.d);
      const wTot = f.days.reduce((s, x) => s + x.amt, 0);
      let c = 0; let med: number | null = null;
      for (const x of f.days) { c += x.amt; if (c >= wTot / 2) { med = x.d; break; } }
      return {
        key, label: FACTOR_LABELS[key], companies: [...f.cos].sort(),
        settled12m: r0(f.settled), medianDaysToSettle: med,
        avgDaysToSettle: wTot ? r0(f.days.reduce((s, x) => s + x.d * x.amt, 0) / wTot) : null,
        openFactored: r0(f.open), openFactoredOver90: r0(f.open90),
      };
    })
    .sort((a, b) => b.settled12m - a.settled12m);

  // ---- factoringkosten per maand: fee (61/613340) + rente/disconto (65/653x, CBN 2011/23) ----
  const fcFee = win.keys.map((k) => r0(bundles.reduce((s, b) => s + (b.factoringCost[k] || 0), 0)));
  const fcInterest = win.keys.map((k) => r0(bundles.reduce((s, b) => s + ((b.factoringInterest || {})[k] || 0), 0)));
  const fcAmounts = win.keys.map((_, i) => fcFee[i] + fcInterest[i]);
  // YTD t/m de laatste rijpe maand is wat finance controleert ("t/m eind juni = €119k");
  // het 12-maands rollende cijfer staat er als context bij.
  const ytdIdx = win.keys.map((k, i) => ({ k, i })).filter((x) => x.k.startsWith(win.keys[nowIdx].slice(0, 4)) && x.i <= nowIdx);
  const factoringCost = {
    months: win.keys, amounts: fcAmounts, fee: fcFee, interest: fcInterest,
    total12m: r0(fcAmounts.slice(-12).reduce((s, x) => s + x, 0)),
    totalYtd: r0(ytdIdx.reduce((s, x) => s + fcAmounts[x.i], 0)),
    feeYtd: r0(ytdIdx.reduce((s, x) => s + fcFee[x.i], 0)),
    interestYtd: r0(ytdIdx.reduce((s, x) => s + fcInterest[x.i], 0)),
    ytdThrough: win.keys[nowIdx],
  };

  // ---- terugboekingen (unapplied = teruggenomen inningen/correcties) ----
  const allUnapplied = bundles.flatMap((b) => b.unapplied);
  const bounceBacks = {
    count: allUnapplied.length,
    amount: r0(allUnapplied.reduce((s, x) => s + x.amt, 0)),
    note: "Teruggeboekte betalings-toewijzingen (laatste 12m) — bevat o.a. inningen die de factor terugneemt (niet-financierbaar/recourse) én gewone correcties. Individuele beoordeling nodig.",
    examples: [] as RcvInvoiceItem[],
  };

  // ---- open posten (drill) ----
  // Audit 04/08/2026: `total` was incl. intercompany terwijl de hele pagina extern
  // rekent → de KPI stond ~€4,8M te hoog naast een externe DSO. Nu extern als
  // hoofdcijfer, IC apart, en het grootboek-nettosaldo erbij voor de aansluiting
  // (open FACTUREN zijn bruto: open creditnota's/betalingen-op-rekening netten pas
  // in het saldo — dat verschil verklaarde de €2,9M kloof met de GL-controle).
  let openTotal = 0, openOverdue = 0, openIc = 0;
  const openItems: RcvInvoiceItem[] = [];
  for (const b of bundles) for (const inv of b.invoices) {
    if (!inv.open) continue;
    const openAmt = inv.rem || inv.amt - inv.applied;
    if (Math.abs(openAmt) < 1) continue;
    if (inv.ic) openIc += openAmt; else openTotal += openAmt;
    const overdue = inv.due && inv.due < todayIso;
    if (overdue && !inv.ic) openOverdue += openAmt;
    openItems.push({
      company: inv.co, customer: inv.rawCust, docNo: inv.doc, invDate: inv.invDate, dueDate: inv.due,
      amount: r0(openAmt), open: true, daysToPay: null,
      daysVsDue: inv.due ? daysBetween(inv.due, todayIso) : null,
      via: inv.ic ? "IC" : isFactored(inv.cust) ? (custDominantFactor[inv.cust] || "factor") : "",
      bcUrl: custLedgerDocLink(inv.co, inv.doc),
    });
  }
  openItems.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  // ---- inningsverwachting 13 weken (betaalgedrag per klant) ----
  const custMedianDays: Record<string, number> = {};
  for (const c of customers) if (c.avgDaysToPay != null) custMedianDays[c.name] = c.avgDaysToPay;
  const globalDays = dsoInvoiceLevel.medianDays ?? 45;
  const w0 = mondayOf(today);
  const cashExpectation: RcvCashWeekExpectation[] = Array.from({ length: 13 }, (_, i) => ({
    weekStart: iso(addDays(w0, i * 7)), label: `wk ${String(i + 1).padStart(2, "0")}`, expected: 0, onDueDate: 0,
  }));
  const weekOf = (dateIso: string): number => {
    const wi = Math.floor(daysBetween(iso(w0), dateIso) / 7);
    return wi < 0 ? 0 : wi;
  };
  for (const b of bundles) for (const inv of b.invoices) {
    if (!inv.open || inv.ic) continue;
    const openAmt = inv.rem || inv.amt - inv.applied;
    if (openAmt <= 0) continue;
    const behaveDays = custMedianDays[inv.cust] ?? globalDays;
    const expIso = iso(addDays(new Date(`${inv.invDate}T00:00:00Z`), Math.max(behaveDays, 7)));
    const ei = weekOf(expIso); if (ei < 13) cashExpectation[ei].expected += openAmt;
    const di = weekOf(inv.due || todayIso); if (di < 13) cashExpectation[di].onDueDate += openAmt;
  }
  for (const w of cashExpectation) { w.expected = r0(w.expected); w.onDueDate = r0(w.onDueDate); }

  // ---- CRF-collectie-KPI's: CEI, Best Possible DSO, ADD ----
  // Audit 04/08/2026: de CRF-formule met "kredietverkopen/N" is bedoeld voor een
  // periode-equivalente MAAND. Toegepast op een groeiende YTD-periode (N loopt van 1
  // naar 12) versterkt ze elke AR-drift met factor N en daalt de KPI structureel
  // doorheen het jaar — onvergelijkbaar over de tijd. Daarom rekenen we de CEI nu
  // PER MAAND (N=1) op dezelfde maand als de DSO, plus een 12-maands gemiddelde.
  // Alles extern, incl. btw, en alle standen op HETZELFDE maandeinde als de noemer.
  //
  // "Niet vervallen op datum D" reconstrueren we uit de facturenset: een factuur stond
  // op D open als ze geboekt was en (nog) niet volledig betaald, en was niet vervallen
  // als haar vervaldag ná D lag. Deelbetalingen vóór D zijn niet reconstrueerbaar uit
  // één paidAt — die benadering staat in de noot.
  const notDueAt = (dateIso: string): number => {
    let sum = 0;
    for (const b of bundles) for (const inv of b.invoices) {
      if (inv.ic || inv.amt <= 0) continue;
      if (inv.invDate > dateIso) continue;                    // bestond nog niet
      if (inv.paidAt && inv.paidAt <= dateIso) continue;      // was al betaald
      if (inv.due && inv.due <= dateIso) continue;            // was al vervallen
      sum += inv.amt;
    }
    return sum;
  };
  const ceiAt = (i: number): number | null => {
    if (i < 1 || salesExt[i] <= 1000) return null;
    const beginAR = arExt[i - 1];            // saldo einde vorige maand
    const endTotal = arExt[i];               // saldo einde deze maand
    const endCurrent = notDueAt(win.ends[i]);
    const numer = beginAR + salesExt[i] - endTotal;
    const denom = beginAR + salesExt[i] - endCurrent;
    if (denom <= 0) return null;
    const v = (numer / denom) * 100;
    if (!Number.isFinite(v) || v < -50 || v > 150) return null;  // onzin-uitschieters niet tonen
    return Math.round(v * 10) / 10;
  };
  const ceiSeries = win.keys.map((_, i) => (i <= nowIdx ? ceiAt(i) : null));
  const ceiVals = ceiSeries.filter((x): x is number => x != null).slice(-12);
  const cei = ceiSeries[nowIdx];
  const cei12mAvg = ceiVals.length ? Math.round((ceiVals.reduce((s, x) => s + x, 0) / ceiVals.length) * 10) / 10 : null;
  // BPDSO/ADD als volledige reeks, zodat de KPI-rij elke gekozen maand kan tonen
  // (CFO-feedback: "verandert er iets als ik de periode aanpas?" — nu expliciet ja).
  // Alleen rijpe maanden, dezelfde drempel als de DSO-reeks.
  const bpdsoSeries = win.keys.map((_, i) =>
    dso.dsoTotal[i] == null ? null : r0((notDueAt(win.ends[i]) / salesExt[i]) * win.daysIn[i]));
  const addSeries = win.keys.map((_, i) => {
    const b = bpdsoSeries[i], d = dso.dsoTotal[i];
    return b != null && d != null ? d - b : null;
  });
  const bpdso = bpdsoSeries[nowIdx];
  const add = addSeries[nowIdx];
  const crfKpis = {
    cei, cei12mAvg, bpdso, add, months: win.keys, ceiSeries, bpdsoSeries, addSeries,
    asOfMonth: win.keys[nowIdx],
    note: `CRF-standaard (crfonline.org), alle drie op dezelfde maand als de DSO (${win.keys[nowIdx]}) — niet op de stand van vandaag, zodat teller en noemer dezelfde periode meten. CEI = (AR begin maand + omzet maand − AR eind maand) ÷ (idem − niet-vervallen AR eind maand) × 100, per maand (N=1); ~100% = vrijwel alles wat inbaar was, is geïnd. BPDSO = niet-vervallen AR ÷ maandomzet × dagen = de DSO die je zou halen als élke klant exact op de vervaldag betaalde; ADD = DSO − BPDSO = het zuivere achterstalligheidsdeel. Benadering: de niet-vervallen stand op een historisch maandeinde is gereconstrueerd uit de facturen (deelbetalingen vóór die datum zijn niet reconstrueerbaar en tellen dus nog als open).`,
  };

  // ============================================================
  // Betaalgedrag & cash-timing — de bankvraag "hoe verlagen we onze DSO?"
  // ============================================================
  // Norm = 30 dagen (richtlijn van de groep). Alles daarboven is uitstel dat kapitaal
  // vastzet; dat kwantificeren we per klant in euro's, in kostprijs en in DSO-dagen.
  const NORM = 30;
  const RATE = 5.0;                       // % per jaar; expliciete aanname, staat in de noot
  const salesMature = salesExt[nowIdx] || 0;
  const daysMature = win.daysIn[nowIdx];

  // Volledige tijdlijn per factuur: factuurdatum → vervaldag → betaaldatum.
  const payRows: RcvPayRow[] = [];
  for (const b of bundles) for (const inv of b.invoices) {
    if (inv.ic || inv.amt <= 0) continue;
    const openAmt = inv.open ? (inv.rem || inv.amt - inv.applied) : 0;
    const dtp = inv.paidAt ? daysBetween(inv.invDate, inv.paidAt) : null;
    payRows.push({
      company: inv.co, customer: inv.rawCust, docNo: inv.doc,
      invDate: inv.invDate, dueDate: inv.due, paidAt: inv.paidAt,
      amount: r0(inv.open ? openAmt : inv.amt),
      daysToPay: dtp != null && dtp >= -5 && dtp <= 500 ? dtp : null,
      daysVsDue: inv.due ? daysBetween(inv.due, inv.paidAt || todayIso) : null,
      via: inv.ic ? "IC" : isFactored(inv.cust) ? (custDominantFactor[inv.cust] || "factor") : "bank",
      open: inv.open, bcUrl: custLedgerDocLink(inv.co, inv.doc),
    });
  }

  // Buckets 0–30 / 31–60 / 61–90 / >90 op dagen tot betaling (bedrag-gewogen).
  const BK: [string, (d: number) => boolean][] = [
    ["0–30 dagen (binnen de norm)", (x) => x <= 30],
    ["31–60 dagen", (x) => x > 30 && x <= 60],
    ["61–90 dagen", (x) => x > 60 && x <= 90],
    ["> 90 dagen", (x) => x > 90],
  ];
  const paidRows = payRows.filter((r) => !r.open && r.daysToPay != null);
  const paidTot = paidRows.reduce((s, r) => s + r.amount, 0) || 1;
  const payBuckets = BK.map(([label, fn]) => {
    const rows = paidRows.filter((r) => fn(r.daysToPay as number));
    const amount = r0(rows.reduce((s, r) => s + r.amount, 0));
    return { label, amount, count: rows.length, pct: Math.round((amount / paidTot) * 1000) / 10 };
  });

  // Per factor: hoe snel wordt een factuur geld? Percentielen op de werkelijke historie —
  // dát is het antwoord op "als ik vandaag factureer, wanneer heb ik mijn geld".
  const pct = (xs: number[], q: number): number | null => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(q * s.length))];
  };
  const factorTiming: RcvFactorTiming[] = d0factors().map((f) => {
    const days = paidRows.filter((r) => r.via === f.key).map((r) => r.daysToPay as number);
    return {
      key: f.key, label: f.label, companies: f.companies,
      p50: pct(days, 0.5), p75: pct(days, 0.75), p90: pct(days, 0.9),
      max: days.length ? Math.max(...days) : null, n: days.length, settled12m: f.settled12m,
    };
  });
  function d0factors() { return factors; }

  // Per klant: uitstel boven de norm → vastgezet kapitaal → kost → DSO-dagen.
  const riskOf = (c: RcvCustomerRow): RcvCustomerRisk => {
    const excess = c.avgDaysToPay != null ? Math.max(0, c.avgDaysToPay - NORM) : 0;
    const tiedUp = (c.invoiced12m / 365) * excess;      // gemiddeld vastgezet kapitaal
    return {
      name: c.name, companies: c.companies,
      invoiced12m: c.invoiced12m, openNow: c.openNow, overdueNow: c.overdueNow,
      avgDaysToPay: c.avgDaysToPay, excessDays: excess,
      tiedUp: r0(tiedUp), costAtRate: r0(tiedUp * (RATE / 100)),
      dsoImpactDays: salesMature > 0 ? Math.round((tiedUp / salesMature) * daysMature * 10) / 10 : 0,
      creditLimit: c.creditLimit ?? null,
      aboveLimit: c.creditLimit && c.openNow > c.creditLimit ? r0(c.openNow - c.creditLimit) : 0,
      factoredSharePct: c.factoredSharePct,
    };
  };
  const risks = customers.filter((c) => !c.ic).map(riskOf);
  const topCost = [...risks].filter((r) => r.tiedUp > 0).sort((a, b) => b.tiedUp - a.tiedUp).slice(0, 25);
  const aboveLimit = [...risks].filter((r) => r.aboveLimit > 0).sort((a, b) => b.aboveLimit - a.aboveLimit).slice(0, 25);
  const tiedUpTotal = r0(risks.reduce((s, r) => s + r.tiedUp, 0));
  const overdueWeighted = (() => {
    const od = payRows.filter((r) => r.open && r.dueDate && r.dueDate < todayIso);
    const tot = od.reduce((s, r) => s + r.amount, 0);
    return tot > 0 ? r0(od.reduce((s, r) => s + r.amount * (r.daysVsDue || 0), 0) / tot) : null;
  })();
  // ---- SALES-BELTOOL: openstaand geld in blokken vanaf de norm, met de klanten erachter ----
  // Blokken op OUDERDOM van de factuur (dagen sinds factuurdatum), want dat is wat sales
  // moet weten: hoeveel geld zweeft er hoe lang, en bij wie. Klik een blok → de klanten.
  const contactMerged: Record<string, { phone: string; email: string }> = {};
  for (const b of bundles) for (const [c, v] of Object.entries(b.contactByCust || {})) if (!contactMerged[c]) contactMerged[c] = v;
  // Live-check 04/08: het blok ">90 dagen" bleek €3,8M te bevatten waarvan posten van
  // 1.000+ dagen (Travis Road 1.222d, Mattex 1.069d, Green Vision 1.222d). Iemand laten
  // bellen over een factuur van drie jaar oud is verspilde tijd — daarom staat alles
  // boven 180 dagen apart: dat is dossier- en niet belwerk.
  const AGE: [string, number, number | null][] = [
    ["< 30 dagen (binnen de norm)", 0, 30],
    ["30 – 45 dagen", 30, 45],
    ["45 – 60 dagen", 45, 60],
    ["60 – 90 dagen", 60, 90],
    ["90 – 180 dagen", 90, 180],
    ["> 180 dagen (dossier)", 180, null],
  ];
  const openByCust = new Map<string, { amount: number; inv: number; maxD: number; wD: number; ic: boolean; cos: Set<string>; overdue: number }>();
  const ageing = AGE.map(([label, minD, maxD]) => {
    let amount = 0, invoiceCount = 0;
    const perCust = new Map<string, { amount: number; inv: number; maxD: number; wD: number; cos: Set<string>; overdue: number }>();
    for (const b of bundles) for (const inv of b.invoices) {
      if (inv.ic || !inv.open) continue;
      const openAmt = inv.rem || inv.amt - inv.applied;
      if (openAmt <= 0) continue;
      const age = daysBetween(inv.invDate, todayIso);
      if (age < minD || (maxD != null && age >= maxD)) continue;
      amount += openAmt; invoiceCount++;
      const k = inv.cust;
      const a = perCust.get(k) || { amount: 0, inv: 0, maxD: 0, wD: 0, cos: new Set<string>(), overdue: 0 };
      a.amount += openAmt; a.inv++; a.maxD = Math.max(a.maxD, age); a.wD += age * openAmt; a.cos.add(inv.co);
      if (inv.due && inv.due < todayIso) a.overdue += openAmt;
      perCust.set(k, a);
      const g = openByCust.get(k) || { amount: 0, inv: 0, maxD: 0, wD: 0, ic: false, cos: new Set<string>(), overdue: 0 };
      g.amount += openAmt; g.inv++; g.maxD = Math.max(g.maxD, age); g.wD += age * openAmt; g.cos.add(inv.co);
      if (inv.due && inv.due < todayIso) g.overdue += openAmt;
      openByCust.set(k, g);
    }
    return {
      label, minDays: minD, maxDays: maxD, amount: r0(amount), invoiceCount, customerCount: perCust.size,
      customers: [...perCust.entries()].sort((x, y) => y[1].amount - x[1].amount).slice(0, 40).map(([name, a]) => ({
        name, companies: [...a.cos].sort(), amount: r0(a.amount), invoices: a.inv,
        maxDays: a.maxD, avgDays: a.amount ? r0(a.wD / a.amount) : 0,
        phone: contactMerged[name]?.phone || "", email: contactMerged[name]?.email || "",
        factored: isFactored(name), overdue: r0(a.overdue),
      })),
    };
  });
  const monthlyFloating = win.keys.slice(Math.max(0, nowIdx - 11), nowIdx + 1).map((m) => ({
    month: m, open: r0(arExt[win.keys.indexOf(m)]),
  }));

  const behaviour: CfoBehaviour = {
    ageing, ageingTotal: r0(ageing.reduce((s, a) => s + a.amount, 0)), monthlyFloating,
    norm: NORM, ratePct: RATE, buckets: payBuckets, factorTiming, topCost, aboveLimit,
    // De 200 grootste/laatste facturen met volledige tijdlijn (rest via de Excel-export).
    invoices: payRows.sort((a, b) => b.amount - a.amount).slice(0, 200),
    overdueNow: r0(openOverdue),
    overdueWeightedDays: overdueWeighted,
    monthlyOpenAvg: r0(arExt.slice(Math.max(0, nowIdx - 11), nowIdx + 1).reduce((s, x) => s + x, 0) / Math.min(12, nowIdx + 1)),
    tiedUpTotal, costTotal: r0(tiedUpTotal * (RATE / 100)),
    dsoIfNorm: salesMature > 0 && dsoNow.total != null
      ? Math.round((dsoNow.total - (tiedUpTotal / salesMature) * daysMature) * 10) / 10 : null,
    notes: [
      `Norm = ${NORM} dagen. "Vastgezet kapitaal" = gefactureerd 12m ÷ 365 × dagen boven de norm: het bedrag dat gemiddeld extra uitstaat doordat een klant later betaalt dan afgesproken. De kostprijs erbij rekent aan ${RATE.toFixed(1)}% per jaar — een expliciete aanname, geen gemeten rente; pas ze aan zodra de werkelijke financieringsrente per factor bekend is.`,
      "DSO-impact per klant = het vastgezette kapitaal omgerekend naar groeps-DSO-dagen (÷ maandomzet × dagen in de maand). Samen tellen die op tot het verschil tussen de huidige DSO en de DSO die je zou halen als iedereen binnen de norm betaalde.",
      "DE 85/15-SPLIT ZIT NIET IN BUSINESS CENTRAL — live gecontroleerd 04/08/2026: de factor wikkelt elke factuur in BC in één keer op 100% af (WHS 492/492, GDI 749/753, GTR 339/340 meifacturen) en rekening 499200 heeft geen beweging. Het 85%-voorschot, de 15%-retentie en de terugname bij niet-betaling leven volledig binnen de factorrelatie. De kolom 'dagen tot geld' hieronder is dus de dag waarop de factuur in BC afgewikkeld werd; wanneer de éindklant aan de factor betaalde en wanneer de 15% vrijkomt, kan alleen uit de maandrapporten van KBC/Belfius/BNP komen (openstaande vraag aan finance).",
      "Bedragen incl. btw (klantposten). 'Dagen te laat' bij open posten is gerekend t.o.v. vandaag.",
    ],
  };

  // ---- IC-aandeel + datakwaliteit ----
  const arIcNow = arEndByCat.ic[n - 1];
  const arAllNow = arIcNow + arEndByCat.extFactoring[n - 1] + arEndByCat.extOther[n - 1];
  const sales12Ic = salesByCat.ic.slice(-12).reduce((s, x) => s + x, 0);
  const sales12All = sales12Ic + salesByCat.extFactoring.slice(-12).reduce((s, x) => s + x, 0) + salesByCat.extOther.slice(-12).reduce((s, x) => s + x, 0);
  const icShare = {
    arOpenIcPct: arAllNow ? Math.round((arIcNow / arAllNow) * 1000) / 10 : 0,
    salesIcPct: sales12All ? Math.round((sales12Ic / sales12All) * 1000) / 10 : 0,
  };
  const dataQuality: string[] = [
    "INTERCO-dimensie in BC kent géén waarden voor WHS/TDR/LMB/GEX (overname-entiteiten) — IC wordt daarom herkend op naam + IC-partnercode, niet op het dimensie-vlagje. Actiepunt finance: dimensiewaarden aanvullen.",
  ];
  const buAbsTotal = businessUnits.reduce((s, b) => s + Math.abs(b.invoiced12m), 0);
  const buNone = businessUnits.find((b) => b.code === "(geen)");
  const dimFailed = bundles.filter((b) => b.dimOk === false).map((b) => b.code);
  const degradedCos = bundles.filter((b) => b.degraded).map((b) => b.code);
  if (dimFailed.length) {
    // Geen "dimensie ontbreekt"-verwijt aan finance als de pull zélf mislukte.
    dataQuality.push(`LET OP: de dimensie-pull (AFDELING) mislukte voor ${dimFailed.join(", ")} — de business-unit-verdeling van de facturatie is voor die firma('s) onbekend, niet leeg. Vernieuwen kan het verhelpen.`);
  } else if (buNone && buAbsTotal && Math.abs(buNone.invoiced12m) / buAbsTotal > 0.9) {
    dataQuality.push("Klantfacturen dragen (vrijwel) geen AFDELING-dimensie op de klantpost — facturatie/DSO per business unit is daarom nog niet meetbaar. Omzet per unit komt wél correct uit het grootboek (pagina Business Units). Actiepunt finance: AFDELING op de verkoopboeking laten overerven.");
  }
  if (degradedCos.length) {
    dataQuality.push(`LET OP: voor ${degradedCos.join(", ")} moest een beperkte veldenset gebruikt worden (BC gaf de volledige projectie niet). Open bedragen zijn daar bruto benaderd — deelbetalingen zijn niet verrekend — en kredietlimieten ontbreken. Behandel de open-postenkolommen voor die firma('s) als indicatief tot een verse pull lukt.`);
  }
  for (const b of bundles) {
    if (b.earliestEntry > "2025-06-30" && b.earliestEntry < "9999") {
      dataQuality.push(`${b.code}: klantposten beginnen pas op ${b.earliestEntry} — beginbalans/historiek vóór die datum ontbreekt (DSO-historiek van vóór die maand is voor ${b.code} onvolledig).`);
    }
  }

  const sources: CfoSource[] = [
    { label: "Klantposten (AR)", detail: "BC ODataV4 Cust_LedgerEntries, volledige historie, alle vennootschappen. AR-saldo per maandeinde = som van alle posten t/m die datum. Bedragen incl. btw." },
    { label: "Echte betaaldata", detail: "Gedetailleerde_klantenposten_Excel, Entry_Type='Application' — de boekingsdatum van de toewijzing betaling↔factuur. Dit is de dag dat het geld binnenkwam (of de factor afrekende)." },
    { label: "Factoring-herkenning", detail: "Afwikkelings-dagboeken per vennootschap: GTR KBCF→KBC CF + BNPF→BNP Fortis Factor; GDI BELF→Belfius CF; WHS KBCC→KBC CF; TDR KBC→KBC CF (afgeleid: enige bankrekening in de KBC-CF-reeks + GL 499200 — bevestigen met finance). Klant = factoring-klant zodra ≥40% van zijn betaald volume via zo'n dagboek liep." },
    { label: "DSO (balansmethode)", detail: `AR-eindsaldo maand ÷ gefactureerd die maand × dagen in de maand — per categorie. Teller én noemer incl. btw (dag-ratio is btw-neutraal). Zelfde methode als het gevalideerde DSO-Excel (jul 2026). Een maand verschijnt pas als ze rijp is: minstens 25 dagen ná het maandeinde (facturen van maand M lopen tot in M+1) én met een omzet die niet wegvalt tegen de mediaan. Eenmalige, niet-operationele verkopen zijn uit de noemer gehouden${oneOffSales.length ? ` (${oneOffSales.map((o) => `${o.cust} ${new Intl.NumberFormat("nl-BE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(o.amount)} in ${o.month}`).join("; ")})` : ""}.` },
    { label: "DPO", detail: "VendorLedgerEntries (extern): AP-eindsaldo ÷ inkoopfacturen van de maand × dagen. Factuur-niveau DPO kan pas als finance/IT 'Detailed Vendor Ledger Entries' als webservice publiceert." },
    { label: "Factoringkosten", detail: "Gesplitst per CBN-advies 2011/23: factorcommissie op 613340 (klasse 61) + rente/disconto op 653x 'Discontokosten op vorderingen' (klasse 65), per maand, alle vennootschappen. LET OP: 653x kan ook niet-factoring-disconto bevatten." },
    { label: "Collectie-KPI's (CRF)", detail: `Credit Research Foundation-standaard, PER MAAND (N=1) berekend op de maand ${win.keys[nowIdx]} — dezelfde maand als de DSO, zodat teller en noemer één periode meten. CEI = (AR begin maand + omzet maand − AR eind maand) ÷ (idem − niet-vervallen AR eind maand) × 100; Best Possible DSO = niet-vervallen AR eind maand ÷ omzet maand × dagen; ADD = DSO − BPDSO. Externe posten, incl. btw. De YTD-variant met "kredietverkopen/N" is bewust NIET gebruikt: bij een groeiende N (1→12) versterkt die elke AR-drift met factor N en daalt de KPI structureel doorheen het jaar (auditbevinding 04/08/2026).` },
  ];
  const notes: string[] = [
    "LET OP factoring: de 'betaaldatum' in BC is de dag van de factor-afwikkeling, niet per se de dag dat de eindklant betaalde. De categorie 'extern via factoring' meet dus time-to-cash (wat telt voor liquiditeit), niet het gedrag van de eindklant.",
    `Facturen van maand M worden tot ver in M+1 geboekt — de jongste maand groeit dus nog aan: haar facturatie stijgt en haar DSO-punt zakt nog. Daarom rekenen alle kop-KPI's op ${win.keys[nowIdx]} (de laatste maand die rijp genoeg is; vanaf de 25e van de maand schuift dat een maand op) en zijn de laatste punten in de grafieken indicatief. Ook de laatste balk van 'facturatie per week' is een lopende, onvolledige week.`,
    `Benchmark-context België (Intrum EPR 2025 / EU Late Payment Observatory 2025, bronnen niet formeel 3-stemmen-geverifieerd): gemiddelde wérkelijke B2B-betaaltermijn ±61 dagen (contractueel ±43d, wettelijk max 60d sinds 2022); transport & logistiek was in 2024 de slechtst betalende sector van België (±30% op tijd). Onze externe DSO van ${dsoNow.total ?? "—"}d ligt daar${dsoNow.total != null && dsoNow.total < 61 ? " iets onder (gunstiger)" : " boven"}; de ${dsoNow.extOther ?? "—"}d bij niet-gefactorde klanten is ver boven elke norm.`,
    "De 15%-retentie (niet-voorgeschoten deel) en de werkelijke klantbetaling aan de factor staan NIET in BC — die zitten in de factor-portalen (KBC/Belfius/BNP). Actiepunt: maandelijkse factor-rapporten aanleveren om de retentie-doorlooptijd te meten.",
    "Bedragen op deze pagina zijn klantposten en dus INCL. btw (het te innen bedrag). Omzetcijfers in de P&L-cockpit zijn excl. btw — vergelijk niet 1-op-1.",
    `Factoringkost = factorcommissie (613340, klasse 61) ${fcInterest.slice(-12).some((x) => x !== 0) ? "+ rente/disconto (653x, klasse 65)" : "+ rente/disconto (653x, klasse 65) — maar op 653x staat momenteel €0"}. CBN-advies 2011/23 schrijft die splitsing voor. ${fcInterest.slice(-12).every((x) => x === 0) ? "Dat er niets op 653x staat bij dit factoringvolume betekent vrijwel zeker dat de factor zijn rente inhoudt op de doorstortingen zonder aparte boeking — de werkelijke financieringskost is dan hoger dan wat hier staat. Openstaande vraag aan de accountant." : ""}`,
    `Open posten (KPI + lijst) = open FACTUREN, extern, incl. btw. Open creditnota's en betalingen-zonder-toewijzing netten daar niet in; het grootboek-nettosaldo (AR-balans) staat er als aansluiting bij en is het cijfer dat de GL-controle bevestigt. Intercompany staat apart en zit NIET in het hoofdcijfer. Van ${openItems.length} open posten worden de ${Math.min(80, openItems.length)} grootste getoond.`,
    `Verwachte inning: reeds vervallen posten staan volledig in week 1 (er is geen latere verwachte datum voor) — week 1 is daardoor structureel hoger dan een normale inningsweek en is géén prognose van één week cash.`,
    excluded.length
      ? `Consolidatiescope: ${excluded.join(", ")} uitgesloten (${bundles.length} vennootschappen in beeld).`
      : `Alle ${bundles.length} vennootschappen inbegrepen; intercompany is overal apart gehouden (categorie IC) of uitgesloten waar aangegeven.`,
  ];

  return {
    asOf: new Date().toISOString(),
    periodNote: `betaalgedrag gemeten op betalingen sinds ${win.keys[0]}-01; facturatieflow laatste 26 weken`,
    isLive: true,
    dso, dsoNow, dsoInvoiceLevel, crfKpis, speedBuckets, customers, businessUnits, weekFlow, factors, factoringCost,
    bounceBacks,
    openInvoices: {
      total: r0(openTotal), overdue: r0(openOverdue), ic: r0(openIc),
      netLedger: r0(arExt[n - 1] + arEndByCat.ic[n - 1]),
      items: openItems.slice(0, 80), itemsShown: Math.min(80, openItems.length), itemsTotal: openItems.length,
    },
    cashExpectation, behaviour, icShare, dataQuality, sources, notes,
  };
}

// ============================================================
// Publieke getter — zelfde cache/inflight-patroon als lib/cfo.ts
// ============================================================
const inflight = new Map<string, Promise<CfoReceivables>>();

async function buildLive(cacheKey: string, exclude: string[]): Promise<CfoReceivables> {
  const today = new Date();
  const win = buildWindow(today);
  const raw = await fetchBCCompanies();
  const companies = raw
    .map((c) => ({ id: String(c.id), code: String(c.name) }))
    .filter((c) => isOperatingCompany(c.code) && !exclude.includes(c.code));
  const bundles: CompanyRcvBundle[] = [];
  // Sequentieel per 2: de klantposten-historie is de zwaarste pull van het dashboard.
  for (let i = 0; i < companies.length; i += 2) {
    const part = await Promise.all(companies.slice(i, i + 2).map((c) => buildCompanyRcvBundle(c, win, today)));
    bundles.push(...part);
  }
  const result = combineRcv(bundles, win, today, exclude);
  setCache(cacheKey, result, 720); // 12h
  return result;
}

export interface RcvState { building?: boolean; startedAt?: string }

/** Klanten & cash-data. Zware pull → nooit blokkeren: zonder cache start de build
 *  op de achtergrond en krijgt de client {building:true}; de UI pollt. */
export async function getReceivables(
  force = false, exclude: string[] = []
): Promise<CfoReceivables | (RcvState & { isLive: boolean })> {
  if (isDemoMode()) return demoReceivables();
  const excl = [...new Set(exclude.map((x) => x.trim().toUpperCase()).filter(Boolean))].sort();
  // v4: DSO-rijpheid en de uitsluiting van eenmalige verkopen wijzigen de reeksen —
  // een payload van een oudere build mag nooit blijven hangen (die toonde 132.302 dagen).
  const cacheKey = `rcv-v4-x:${excl.join(",")}`;
  const cached = getCache<CfoReceivables>(cacheKey);
  if (cached && !force) return cached;

  if (!inflight.has(cacheKey)) {
    const p = buildLive(cacheKey, excl).finally(() => inflight.delete(cacheKey));
    inflight.set(cacheKey, p);
    p.catch((e) => console.error("receivables build failed:", e));
  }
  if (cached) return { ...cached, refreshing: true };

  // Race: een warme her-run (alle bundels gecachet) is in seconden klaar — geef die
  // dan meteen terug; anders 202-building en laat de client pollen.
  const winner = await Promise.race([
    inflight.get(cacheKey)!.then((r) => ({ done: r })),
    new Promise<{ done: null }>((res) => setTimeout(() => res({ done: null }), 20_000)),
  ]);
  if (winner.done) return winner.done;
  return { building: true, startedAt: new Date().toISOString(), isLive: true };
}

// ============================================================
// Demodata — kleine, plausibele dataset voor demomodus/lokale build
// ============================================================
function demoReceivables(): CfoReceivables {
  const today = new Date();
  const win = buildWindow(today);
  const n = win.keys.length;
  const wave = (i: number, base: number, amp: number, ph = 0) => r0(base + amp * Math.sin((i + ph) / 2.2));
  const salesF = win.keys.map((_, i) => wave(i, 2_400_000, 380_000));
  const salesO = win.keys.map((_, i) => wave(i, 1_450_000, 260_000, 2));
  const salesI = win.keys.map((_, i) => wave(i, 950_000, 140_000, 4));
  const arF = win.keys.map((_, i) => wave(i, 3_900_000, 420_000, 1));
  const arO = win.keys.map((_, i) => wave(i, 3_050_000, 380_000, 3));
  const arI = win.keys.map((_, i) => wave(i, 2_600_000, 300_000, 5));
  const dsoOf = (ar: number[], s: number[]) => win.keys.map((_, i) => r0((ar[i] / s[i]) * win.daysIn[i]));
  const dso: RcvDsoSeries = {
    months: win.keys,
    dsoTotal: dsoOf(arF.map((v, i) => v + arO[i]), salesF.map((v, i) => v + salesO[i])),
    dsoExtFactoring: dsoOf(arF, salesF),
    dsoExtOther: dsoOf(arO, salesO),
    dsoCountback: win.keys.map((_, i) => wave(i, 52, 5, 2)),
    dpoTotal: win.keys.map((_, i) => wave(i, 49, 6, 1)),
    arEndByCat: { extFactoring: arF, extOther: arO, ic: arI },
    salesByCat: { extFactoring: salesF, extOther: salesO, ic: salesI },
  };
  const custNames = ["COLRUYT GROUP", "DELHAIZE", "AB INBEV", "PAINTING & DECORATING SERVICE", "BARRY CALLEBAUT", "MILCOBEL", "AGRISTO", "VANDEMOORTELE", "SOUDAL", "UNILIN"];
  const customers: RcvCustomerRow[] = custNames.map((name, i) => ({
    name, companies: i % 3 === 0 ? ["GTR", "GDI"] : ["GTR"],
    invoiced12m: r0(4_200_000 / (i + 1)), openNow: r0(520_000 / (i + 1)), overdueNow: r0(180_000 / (i + 2)),
    paidCount: 240 - i * 18,
    avgDaysToPay: 28 + i * 4, avgDaysVsDue: i - 3,
    factoredSharePct: i % 2 === 0 ? 92.5 : 4.2, ic: false,
    creditLimit: i % 3 === 0 ? r0(700_000 / (i + 1)) : null,
    creditUsedPct: i % 3 === 0 ? Math.round((520_000 / (i + 1)) / (700_000 / (i + 1)) * 1000) / 10 : null,
  }));
  const w0 = mondayOf(addDays(today, -25 * 7));
  const weekFlow: RcvWeekFlow[] = Array.from({ length: 26 }, (_, i) => ({
    weekStart: iso(addDays(w0, i * 7)), factored: wave(i, 620_000, 130_000), other: wave(i, 350_000, 90_000, 2), count: 300 + (i % 5) * 22,
  }));
  const m0 = mondayOf(today);
  return {
    asOf: new Date(0).toISOString(),
    periodNote: "voorbeelddata (demomodus)",
    isLive: false,
    dso,
    dsoNow: { total: 54, extFactoring: 49, extOther: 63, countback: 52, dpo: 48, asOfMonth: win.keys[n - 2] },
    dsoInvoiceLevel: { avgDays: 38, medianDays: 33, onTimePct: 41.5, note: "Voorbeelddata — bedrag-gewogen op volledig betaalde facturen." },
    crfKpis: {
      cei: 92.4, cei12mAvg: 90.1, bpdso: 34, add: 20,
      months: win.keys, ceiSeries: win.keys.map((_, i) => (i <= n - 2 ? 88 + ((i * 7) % 9) : null)),
      bpdsoSeries: win.keys.map((_, i) => (i <= n - 2 ? 32 + ((i * 3) % 6) : null)),
      addSeries: win.keys.map((_, i) => (i <= n - 2 ? 18 + ((i * 5) % 7) : null)),
      asOfMonth: win.keys[n - 2],
      note: "Voorbeelddata — CRF-standaard (CEI/BPDSO/ADD), per maand berekend.",
    },
    speedBuckets: [
      { label: "Op tijd / te vroeg", amount: 9_400_000, count: 4210 },
      { label: "1–15d te laat", amount: 6_800_000, count: 3010 },
      { label: "16–30d", amount: 3_900_000, count: 1585 },
      { label: "31–60d", amount: 2_100_000, count: 830 },
      { label: "61–90d", amount: 700_000, count: 260 },
      { label: "> 90d te laat", amount: 450_000, count: 140 },
    ],
    customers,
    businessUnits: [
      { code: "TRUC", invoiced12m: 24_800_000, openNow: 5_900_000, avgDaysToPay: 41, invoiceCount12m: 9100 },
      { code: "DISTR", invoiced12m: 11_400_000, openNow: 2_700_000, avgDaysToPay: 37, invoiceCount12m: 6400 },
      { code: "WARE", invoiced12m: 8_300_000, openNow: 1_950_000, avgDaysToPay: 33, invoiceCount12m: 3900 },
      { code: "TANK", invoiced12m: 4_400_000, openNow: 610_000, avgDaysToPay: 21, invoiceCount12m: 2200 },
      { code: "(geen)", invoiced12m: 2_100_000, openNow: 480_000, avgDaysToPay: 39, invoiceCount12m: 800 },
    ],
    weekFlow,
    factors: [
      { key: "KBC", label: "KBC Commercial Finance", companies: ["GTR", "WHS", "TDR"], settled12m: 24_500_000, medianDaysToSettle: 41, avgDaysToSettle: 46, openFactored: 4_100_000, openFactoredOver90: 310_000 },
      { key: "Belfius", label: "Belfius Commercial Finance", companies: ["GDI"], settled12m: 11_200_000, medianDaysToSettle: 37, avgDaysToSettle: 43, openFactored: 2_050_000, openFactoredOver90: 145_000 },
      { key: "BNP", label: "BNP Paribas Fortis Factor", companies: ["GTR"], settled12m: 3_900_000, medianDaysToSettle: 44, avgDaysToSettle: 49, openFactored: 780_000, openFactoredOver90: 60_000 },
    ],
    factoringCost: {
      months: win.keys,
      amounts: win.keys.map((_, i) => wave(i, 21_000, 4_000) + wave(i, 14_000, 3_000, 1)),
      fee: win.keys.map((_, i) => wave(i, 21_000, 4_000)),
      interest: win.keys.map((_, i) => wave(i, 14_000, 3_000, 1)),
      total12m: 420_000, totalYtd: 119_025, feeYtd: 45_932, interestYtd: 73_093, ytdThrough: win.keys[n - 2],
    },
    bounceBacks: { count: 34, amount: 412_000, note: "Voorbeeld — teruggeboekte toewijzingen laatste 12m.", examples: [] },
    openInvoices: {
      total: 13_450_000, overdue: 4_820_000, ic: 4_100_000, netLedger: 12_900_000,
      itemsShown: 8, itemsTotal: 640,
      items: custNames.slice(0, 8).map((c, i) => ({
        company: ["GTR", "GDI", "WHS"][i % 3], customer: c, docNo: `812260${700 + i}`,
        invDate: iso(addDays(today, -20 - i * 9)), dueDate: iso(addDays(today, 10 - i * 9)),
        amount: r0(390_000 / (i + 1)), open: true, daysToPay: null, daysVsDue: i * 9 - 10,
        via: i % 2 === 0 ? "KBC" : "", bcUrl: custLedgerDocLink(["GTR", "GDI", "WHS"][i % 3], `812260${700 + i}`),
      })),
    },
    cashExpectation: Array.from({ length: 13 }, (_, i) => ({
      weekStart: iso(addDays(m0, i * 7)), label: `wk ${String(i + 1).padStart(2, "0")}`,
      expected: wave(i, 1_050_000, 260_000), onDueDate: wave(i, 1_180_000, 420_000, 2),
    })),
    icShare: { arOpenIcPct: 27.9, salesIcPct: 23.4 },
    dataQuality: ["Voorbeelddata — datakwaliteitschecks draaien alleen live."],
    sources: [
      { label: "Klantposten (AR)", detail: "Demomodus — structuur identiek aan live (Cust_LedgerEntries)." },
      { label: "Echte betaaldata", detail: "Demomodus — live komt dit uit Gedetailleerde_klantenposten_Excel (Application-posten)." },
    ],
    notes: ["Voorbeelddata (demomodus) — orde van grootte gebaseerd op de echte groep."],
  };
}
