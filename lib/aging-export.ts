// On-demand aging exports (Excel) for the CFO cockpit — the "button" Laura asked for.
// Pulls LIVE open items from Business Central and builds a grouped aging workbook:
//  - AP (leveranciers): ODataV4 web service VendorLedgerEntries (NOT in api/v2.0)
//  - AR (klanten):      ODataV4 web service Cust_LedgerEntries, Open=true — ALLE
//    niet-afgepunte posten (facturen, creditnota's, onafgepunte betalingen), dezelfde
//    basis als het BC-rapport "Klant - Vervallen posten" (rapport 106). Tot 11/08/2026
//    stond hier api/v2.0 salesInvoices, maar dat mist creditnota's en dubbele
//    betalingen — de totalen sloten daardoor niet aan op wat finance in BC ziet.
// Every export carries the pull timestamp in the filename, the title row and the
// Leeswijzer, so finance always knows how fresh the numbers are.

import ExcelJS from "exceljs";
import { getBCToken, fetchBCCompanies } from "./bc-client";
import { fetchWithRetry } from "./http";
import { vendorLedgerDocLink, custLedgerDocLink } from "./bc-links";
import { isIcName } from "./cfo";

const ODATA_ROOT = `https://api.businesscentral.dynamics.com/v2.0/${process.env.BC_TENANT_ID}/${process.env.BC_ENVIRONMENT || "production"}`;
const API_ROOT = `${ODATA_ROOT}/api/v2.0`;

function isOperatingCompany(name: string): boolean {
  return !/^_/.test(name) && !/test|copie|fleetmate/i.test(name);
}

// Intercompany-detectie centraal uit lib/cfo.ts (audit 11/08/2026): een lokale
// kopie van de regex driftte eerder al eens (de Lamberts-&-les) — één bron van
// waarheid; zie isIcName-import bovenaan.
// Merge name variants: strip company-code prefixes ("GTG - ") and legal forms.
const PREFIX_RX = /^(GTR|GTG|GSS|GPR|TFO|GDI|GRE|WHS|TDR|LMB|GEX)\s*-\s*/i;
const LEGAL_RX = /\b(NV\/SA|NV|SA|BVBA|BV|VOF|GMBH|LTD|INC|SPRL|SCRL|CVBA|COMM\.?\s*V|SRL|SARL|GCV)\b\.?/gi;
function normName(name: string): string {
  let n = (name || "").toUpperCase();
  n = n.replace(PREFIX_RX, "").replace(LEGAL_RX, " ").replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  return n || (name || "").toUpperCase().trim();
}

export interface AgingRow {
  party: string;          // vendor or customer name
  docNo: string;
  docType: string;
  amountOrigin: number;   // in document currency
  currency: string;
  invoiceDate: string;
  dueDate: string;        // "" when unknown
  amountEUR: number;      // payable/receivable in EUR (positive = owed)
  company: string;        // BC company code
  // Btw-/ondernemingsnummer van de tegenpartij (vraag finance 10/08/2026), uit de
  // klanten-/leveranciersstamdata (taxRegistrationNumber). Leeg = niet ingevuld in BC.
  vatNo: string;
  // Betalingsvoorwaarde-code van de tegenpartij (vraag finance 11/08/2026), uit de
  // stamdata (paymentTermsId → paymentTerms.code, bv. "30D", "LM+30D").
  payTerms: string;
}

async function pageAll(url: string, token: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let next: string | null = url;
  let page = 0;
  while (next && page < 400) {
    const res: Response = await fetchWithRetry(next, {
      headers: { Authorization: `Bearer ${token}`, "Data-Access-Intent": "ReadOnly", Accept: "application/json" },
    }, { timeoutMs: 90_000, maxAttempts: 2 });
    if (!res.ok) throw new Error(`BC ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data: { value?: Record<string, unknown>[]; "@odata.nextLink"?: string } = await res.json();
    for (const v of data.value || []) out.push(v); // geen push(...page): stack-limiet bij 20k-rijen-pagina's
    next = data["@odata.nextLink"] || null;
    page++;
  }
  if (next) throw new Error("BC-paging (aging): 400-paginalimiet bereikt, dataset onvolledig");
  return out;
}

const DOCTYPE_NL: Record<string, string> = {
  Invoice: "Factuur", "Credit Memo": "Creditnota", Payment: "Betaling", Refund: "Terugbetaling",
  Reminder: "Aanmaning", "Finance Charge Memo": "Rentenota", " ": "—", "": "—",
};
function cleanDate(d: unknown): string {
  const s = String(d || "");
  return s && !s.startsWith("0001") ? s.slice(0, 10) : "";
}

// Stamdata-join per vennootschap: partijnummer → { btw-nummer, betalingsvoorwaarde-code }.
// paymentTerms is een aparte entiteit (id → code), klanten/leveranciers dragen enkel het id.
async function fetchPartyMeta(
  companyId: string, entity: "customers" | "vendors", token: string
): Promise<Record<string, { vat: string; terms: string }>> {
  const termsById: Record<string, string> = {};
  for (const t of await pageAll(`${API_ROOT}/companies(${companyId})/paymentTerms?$select=id,code`, token)) {
    termsById[String(t.id)] = String(t.code || "");
  }
  const meta: Record<string, { vat: string; terms: string }> = {};
  for (const p of await pageAll(`${API_ROOT}/companies(${companyId})/${entity}?$select=number,taxRegistrationNumber,paymentTermsId`, token)) {
    meta[String(p.number)] = {
      vat: p.taxRegistrationNumber ? String(p.taxRegistrationNumber) : "",
      terms: termsById[String(p.paymentTermsId || "")] || "",
    };
  }
  return meta;
}

/** All OPEN vendor ledger entries, group-wide. Payable = −Remaining_Amt_LCY. */
export async function fetchAgingAP(): Promise<AgingRow[]> {
  const token = await getBCToken();
  const companies = (await fetchBCCompanies())
    .filter((c) => isOperatingCompany(String(c.name)))
    .map((c) => ({ id: String(c.id), code: String(c.name) }));
  const rows: AgingRow[] = [];
  for (const c of companies) {
    const co = c.code;
    const meta = await fetchPartyMeta(c.id, "vendors", token);
    // NO $top: it caps the TOTAL result set (a €776k lesson) — page via nextLink.
    const url = `${ODATA_ROOT}/ODataV4/Company('${encodeURIComponent(co)}')/VendorLedgerEntries?$filter=Open eq true&$select=Vendor_No,Vendor_Name,Document_Type,Document_No,Document_Date,Posting_Date,Due_Date,Currency_Code,Remaining_Amount,Remaining_Amt_LCY`;
    const raw = await pageAll(url, token);
    for (const e of raw) {
      const remLCY = (e.Remaining_Amt_LCY as number) || 0;
      const remDoc = (e.Remaining_Amount as number) || 0;
      if (remLCY === 0 && remDoc === 0) continue;
      const m = meta[String(e.Vendor_No || "")];
      rows.push({
        vatNo: m?.vat || "",
        payTerms: m?.terms || "",
        party: String(e.Vendor_Name || "").trim() || "(zonder naam)",
        docNo: String(e.Document_No || ""),
        docType: DOCTYPE_NL[String(e.Document_Type ?? "")] ?? String(e.Document_Type || ""),
        amountOrigin: Math.round(-remDoc * 100) / 100,
        currency: String(e.Currency_Code || "EUR") || "EUR",
        invoiceDate: cleanDate(e.Document_Date) || cleanDate(e.Posting_Date),
        dueDate: cleanDate(e.Due_Date),
        amountEUR: Math.round(-remLCY * 100) / 100,
        company: co,
      });
    }
  }
  return rows;
}

/**
 * All OPEN customer ledger entries, group-wide — facturen, creditnota's én
 * niet-afgepunte betalingen (vraag finance 11/08/2026: "alle open posten, niet
 * afgepunte"). Zelfde basis als BC-rapport 106 "Klant - Vervallen posten";
 * gevalideerd: GDI-totaal met vervaldag ≤ vandaag = € 4.188.920,04, exact het
 * rapporttotaal van 11/08/2026 10:58.
 */
export async function fetchAgingAR(): Promise<AgingRow[]> {
  const token = await getBCToken();
  const companies = (await fetchBCCompanies())
    .filter((c) => isOperatingCompany(String(c.name)))
    .map((c) => ({ id: String(c.id), code: String(c.name) }));
  const rows: AgingRow[] = [];
  for (const c of companies) {
    const co = c.code;
    const meta = await fetchPartyMeta(c.id, "customers", token);
    const url = `${ODATA_ROOT}/ODataV4/Company('${encodeURIComponent(co)}')/Cust_LedgerEntries?$filter=Open eq true&$select=Customer_No,Customer_Name,Document_Type,Document_No,Document_Date,Posting_Date,Due_Date,Currency_Code,Remaining_Amount,Remaining_Amt_LCY`;
    const raw = await pageAll(url, token);
    for (const e of raw) {
      const remLCY = (e.Remaining_Amt_LCY as number) || 0;
      const remDoc = (e.Remaining_Amount as number) || 0;
      if (remLCY === 0 && remDoc === 0) continue;
      const m = meta[String(e.Customer_No || "")];
      rows.push({
        vatNo: m?.vat || "",
        payTerms: m?.terms || "",
        party: String(e.Customer_Name || "").trim() || "(zonder naam)",
        docNo: String(e.Document_No || ""),
        docType: DOCTYPE_NL[String(e.Document_Type ?? "")] ?? String(e.Document_Type || ""),
        amountOrigin: Math.round(remDoc * 100) / 100,
        currency: String(e.Currency_Code || "EUR") || "EUR",
        invoiceDate: cleanDate(e.Document_Date) || cleanDate(e.Posting_Date),
        dueDate: cleanDate(e.Due_Date),
        amountEUR: Math.round(remLCY * 100) / 100,
        company: co,
      });
    }
  }
  return rows;
}

// ---------------- workbook ----------------

// Ouderdomsblokken op DAGEN SINDS FACTUURDATUM (vraag finance 11/08/2026) — niet op
// vervaldag. "Hoe lang zweeft dit geld al", los van de afgesproken termijn. De
// vervaldag blijft als aparte kolom staan; het "vervallen"-deel (vervaldag ≤ vandaag,
// = BC-rapport "Vervallen posten") staat apart op de bladen.
const BUCKETS = ["0 – 30d", "31 – 60d", "61 – 90d", "> 90d", "Onbekend"] as const;
// Audit 11/08/2026: leeftijd op KALENDERDAG Brussel (snapIso), niet op het
// milliseconden-verschil met het pull-moment — een pull om 01:00 schoof anders
// alle grensfacturen één bucket te jong t.o.v. het dashboard.
function bucketOf(invDate: string, snapIso: string): (typeof BUCKETS)[number] {
  if (!invDate) return "Onbekend";
  const d = Date.parse(`${invDate}T00:00:00Z`);
  if (Number.isNaN(d)) return "Onbekend";
  const days = Math.floor((Date.parse(`${snapIso}T00:00:00Z`) - d) / 86400000);
  if (days <= 30) return "0 – 30d";
  if (days <= 60) return "31 – 60d";
  if (days <= 90) return "61 – 90d";
  return "> 90d";
}

const EUR_FMT = '#,##0.00\\ "€"';
const BLUE = "FF1F5FA8", BLUEROW = "FF4E86C6", ICCLR = "FF7A5195", YELLOW = "FFFFF2CC";
function fill(ws: ExcelJS.Worksheet, row: number, cols: number, argb: string) {
  for (let c = 1; c <= cols; c++) ws.getCell(row, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
}
const r2c = (v: number) => Math.round(v * 100) / 100;

export async function buildAgingWorkbook(
  kind: "ap" | "ar", rows: AgingRow[], pulledAt: Date
): Promise<{ buffer: ArrayBuffer; filename: string }> {
  const isAP = kind === "ap";
  const partyLabel = isAP ? "Leveranciersnaam" : "Klantnaam";
  const title = isAP ? "LEVERANCIERSAGING" : "KLANTENAGING";
  const stamp = pulledAt.toLocaleString("nl-BE", { timeZone: "Europe/Brussels", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const fileStamp = pulledAt.toLocaleString("sv-SE", { timeZone: "Europe/Brussels" }).replace(" ", "_").replace(/:/g, "").slice(0, 15);
  const snapIso = pulledAt.toLocaleDateString("sv-SE", { timeZone: "Europe/Brussels" }); // YYYY-MM-DD
  const isOverdue = (x: AgingRow) => !!x.dueDate && x.dueDate <= snapIso;

  // group by normalized party name
  const groups = new Map<string, { display: string; rows: AgingRow[] }>();
  for (const r of rows) {
    const key = normName(r.party);
    const g = groups.get(key) ?? { display: r.party, rows: [] };
    g.rows.push(r);
    if (g.rows.length === 1) g.display = r.party;
    groups.set(key, g);
  }
  const order = [...groups.values()].sort((a, b) => a.display.localeCompare(b.display, "nl"));
  const bucketSums = (rs: AgingRow[]) => {
    const s: Record<string, number> = {};
    for (const b of BUCKETS) s[b] = 0;
    for (const r of rs) s[bucketOf(r.invoiceDate, snapIso)] += r.amountEUR;
    return s;
  };

  // Kolomindeling detailblad — afgeleid, zodat een bucket-wijziging niet stil de
  // vaste kolommen (Soort/Vennootschap/…) verschuift.
  const B0 = 7;                                 // eerste bucketkolom
  const C_SOORT = B0 + BUCKETS.length;          // 12
  const C_COMP = C_SOORT + 1;                   // 13
  const C_VAT = C_COMP + 1;                     // 14
  const C_TERMS = C_VAT + 1;                    // 15

  const wb = new ExcelJS.Workbook();
  wb.created = pulledAt;

  // ---- sheet 1: detail grouped ----
  const ws = wb.addWorksheet("Aging");
  const headers = [partyLabel, "Factuurnummer", "Totaalbedrag", "Munt", "Factuurdatum", "Vervaldatum", ...BUCKETS, "Soort", "Vennootschap", "Btw-nummer", "Betalingsvoorwaarde"];
  const NC = headers.length;
  ws.getCell(1, 1).value = `${title} — GHEERAERT GROEP — data getrokken op ${stamp} · ouderdom = dagen sinds FACTUURDATUM`;
  ws.getCell(1, 1).font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
  fill(ws, 1, NC, BLUE);
  ws.getRow(3).values = headers;
  ws.getRow(3).font = { bold: true, color: { argb: "FFFFFFFF" } };
  fill(ws, 3, NC, BLUE);
  const widths = [34, 16, 14, 7, 12, 12, 13, 13, 13, 12, 12, 9, 13, 15, 18];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  const grand = bucketSums(rows);
  const grandTotal = r2c(BUCKETS.reduce((s, b) => s + grand[b], 0));
  const grandOverdue = r2c(rows.filter(isOverdue).reduce((s, x) => s + x.amountEUR, 0));
  let r = 4;
  ws.getCell(r, 1).value = "GROEPSTOTAAL";
  ws.getCell(r, 1).font = { bold: true };
  ws.getCell(r, 3).value = grandTotal;
  BUCKETS.forEach((b, i) => { const c = ws.getCell(r, B0 + i); c.value = r2c(grand[b]); c.numFmt = EUR_FMT; c.font = { bold: true }; });
  ws.getCell(r, 3).numFmt = EUR_FMT; ws.getCell(r, 3).font = { bold: true };
  fill(ws, r, NC, YELLOW);
  r++;

  for (const g of order) {
    const sums = bucketSums(g.rows);
    const net = r2c(BUCKETS.reduce((s, b) => s + sums[b], 0));
    const ic = isIcName(g.display);
    ws.getCell(r, 1).value = g.display;
    ws.getCell(r, 3).value = net;
    ws.getCell(r, 3).numFmt = EUR_FMT;
    BUCKETS.forEach((b, i) => { const v = r2c(sums[b]); if (v) { const c = ws.getCell(r, B0 + i); c.value = v; c.numFmt = EUR_FMT; } });
    ws.getCell(r, C_SOORT).value = ic ? "IC" : "Extern";
    ws.getCell(r, C_VAT).value = g.rows.find((x) => x.vatNo)?.vatNo || "";
    ws.getCell(r, C_TERMS).value = g.rows.find((x) => x.payTerms)?.payTerms || "";
    ws.getRow(r).font = { bold: true, color: { argb: "FFFFFFFF" } };
    fill(ws, r, NC, ic ? ICCLR : BLUEROW);
    r++;
    const sorted = [...g.rows].sort((a, b) => (a.company + (a.invoiceDate || "9999")).localeCompare(b.company + (b.invoiceDate || "9999")));
    for (const x of sorted) {
      ws.getCell(r, 1).value = g.display; ws.getCell(r, 1).font = { color: { argb: "FF808080" } };
      // Factuurnummer = BC-deeplink (vindplaats, geen payload — zelfde conventie als
      // de andere exports): AP → leveranciersposten (page 29), AR → klantposten
      // (page 25, werkt óók voor creditnota's/betalingen). Zonder BC-login: niets.
      const label = x.docNo + (x.docType !== "Factuur" ? `  ·${x.docType}` : "");
      if (x.docNo) {
        ws.getCell(r, 2).value = {
          text: label,
          hyperlink: isAP ? vendorLedgerDocLink(x.company, x.docNo) : custLedgerDocLink(x.company, x.docNo),
        };
        ws.getCell(r, 2).font = { color: { argb: "FF1F5FA8" }, underline: true };
      } else {
        ws.getCell(r, 2).value = label;
      }
      ws.getCell(r, 3).value = x.amountOrigin; ws.getCell(r, 3).numFmt = EUR_FMT;
      ws.getCell(r, 4).value = x.currency;
      ws.getCell(r, 5).value = x.invoiceDate;
      ws.getCell(r, 6).value = x.dueDate;
      if (isOverdue(x)) ws.getCell(r, 6).font = { color: { argb: "FFB4342A" } };
      const b = bucketOf(x.invoiceDate, snapIso);
      const ci = B0 + BUCKETS.indexOf(b);
      ws.getCell(r, ci).value = x.amountEUR; ws.getCell(r, ci).numFmt = EUR_FMT;
      if (b === "> 90d") ws.getCell(r, ci).font = { color: { argb: "FFB4342A" } };
      ws.getCell(r, C_COMP).value = x.company;
      ws.getCell(r, C_VAT).value = x.vatNo;
      ws.getCell(r, C_TERMS).value = x.payTerms;
      r++;
    }
  }
  ws.views = [{ state: "frozen", ySplit: 3 }];

  // ---- sheet 2: per vennootschap (vraag finance 11/08/2026: "een mooi bedrag per
  // bedrijf"). "Waarvan vervallen" = vervaldag ≤ vandaag en sluit daarmee aan op het
  // BC-rapport "Vervallen posten" per vennootschap (GDI gevalideerd op de cent). ----
  const wsC = wb.addWorksheet("Per vennootschap");
  wsC.getCell(1, 1).value = `TOTAAL PER VENNOOTSCHAP — data getrokken op ${stamp}`;
  wsC.getCell(1, 1).font = { bold: true, size: 12 };
  const hC = ["Vennootschap", "Totaal open", `Waarvan vervallen (vervaldag ≤ ${stamp.slice(0, 10)})`, "Niet vervallen", ...BUCKETS, "# posten"];
  wsC.getRow(3).values = hC;
  wsC.getRow(3).font = { bold: true, color: { argb: "FFFFFFFF" } };
  fill(wsC, 3, hC.length, BLUE);
  wsC.getColumn(1).width = 16; wsC.getColumn(3).width = 34;
  for (const i of [2, 4, 5, 6, 7, 8, 9]) wsC.getColumn(i).width = 16;
  const byComp = new Map<string, AgingRow[]>();
  for (const x of rows) {
    const arr = byComp.get(x.company) ?? [];
    arr.push(x);
    byComp.set(x.company, arr);
  }
  const compOrder = [...byComp.entries()]
    .map(([co, rs]) => ({ co, rs, tot: r2c(rs.reduce((s, x) => s + x.amountEUR, 0)) }))
    .sort((a, b) => b.tot - a.tot);
  let rC = 4;
  wsC.getCell(rC, 1).value = "GROEPSTOTAAL"; wsC.getCell(rC, 1).font = { bold: true };
  wsC.getCell(rC, 2).value = grandTotal;
  wsC.getCell(rC, 3).value = grandOverdue;
  wsC.getCell(rC, 4).value = r2c(grandTotal - grandOverdue);
  BUCKETS.forEach((b, i) => { wsC.getCell(rC, 5 + i).value = r2c(grand[b]); });
  wsC.getCell(rC, 5 + BUCKETS.length).value = rows.length;
  for (let c = 2; c <= 4 + BUCKETS.length; c++) { wsC.getCell(rC, c).numFmt = EUR_FMT; wsC.getCell(rC, c).font = { bold: true }; }
  fill(wsC, rC, hC.length, YELLOW);
  rC++;
  for (const { co, rs, tot } of compOrder) {
    const overdue = r2c(rs.filter(isOverdue).reduce((s, x) => s + x.amountEUR, 0));
    const sums = bucketSums(rs);
    wsC.getCell(rC, 1).value = co; wsC.getCell(rC, 1).font = { bold: true };
    wsC.getCell(rC, 2).value = tot;
    wsC.getCell(rC, 3).value = overdue;
    wsC.getCell(rC, 4).value = r2c(tot - overdue);
    BUCKETS.forEach((b, i) => { wsC.getCell(rC, 5 + i).value = r2c(sums[b]); });
    wsC.getCell(rC, 5 + BUCKETS.length).value = rs.length;
    for (let c = 2; c <= 4 + BUCKETS.length; c++) wsC.getCell(rC, c).numFmt = EUR_FMT;
    rC++;
  }
  wsC.views = [{ state: "frozen", ySplit: 3 }];

  // ---- sheet 3: summary per party ----
  const ws2 = wb.addWorksheet("Samenvatting");
  ws2.getCell(1, 1).value = `SAMENVATTING PER ${isAP ? "LEVERANCIER" : "KLANT"} — data getrokken op ${stamp}`;
  ws2.getCell(1, 1).font = { bold: true, size: 12 };
  const h2 = [partyLabel, "Soort", "Totaal openstaand", "Waarvan vervallen", ...BUCKETS, "# posten", "# venn.", "Btw-nummer", "Betalingsvoorwaarde"];
  ws2.getRow(3).values = h2;
  ws2.getRow(3).font = { bold: true, color: { argb: "FFFFFFFF" } };
  fill(ws2, 3, h2.length, BLUE);
  ws2.getColumn(1).width = 36;
  for (let i = 3; i <= 4 + BUCKETS.length; i++) ws2.getColumn(i).width = 14;
  ws2.getColumn(h2.length - 1).width = 15;
  ws2.getColumn(h2.length).width = 18;
  let r2 = 4;
  for (const g of order) {
    const sums = bucketSums(g.rows);
    const net = r2c(BUCKETS.reduce((s, b) => s + sums[b], 0));
    const overdue = r2c(g.rows.filter(isOverdue).reduce((s, x) => s + x.amountEUR, 0));
    ws2.getCell(r2, 1).value = g.display;
    ws2.getCell(r2, 2).value = isIcName(g.display) ? "IC" : "Extern";
    ws2.getCell(r2, 3).value = net; ws2.getCell(r2, 3).numFmt = EUR_FMT; ws2.getCell(r2, 3).font = { bold: true };
    ws2.getCell(r2, 4).value = overdue; ws2.getCell(r2, 4).numFmt = EUR_FMT;
    BUCKETS.forEach((b, i) => { const c = ws2.getCell(r2, 5 + i); c.value = r2c(sums[b]); c.numFmt = EUR_FMT; });
    ws2.getCell(r2, 5 + BUCKETS.length).value = g.rows.length;
    ws2.getCell(r2, 6 + BUCKETS.length).value = new Set(g.rows.map((x) => x.company)).size;
    ws2.getCell(r2, 7 + BUCKETS.length).value = g.rows.find((x) => x.vatNo)?.vatNo || "";
    ws2.getCell(r2, 8 + BUCKETS.length).value = g.rows.find((x) => x.payTerms)?.payTerms || "";
    r2++;
  }
  ws2.autoFilter = { from: { row: 3, column: 1 }, to: { row: r2 - 1, column: h2.length } };
  ws2.views = [{ state: "frozen", ySplit: 3 }];

  // ---- sheet 4: leeswijzer ----
  const ws3 = wb.addWorksheet("Leeswijzer");
  const notes = [
    `${title} — Gheeraert Groep`,
    `DATA GETROKKEN OP: ${stamp} (live uit Business Central op het moment van de klik).`,
    "",
    isAP
      ? "Bron: ALLE open (niet-afgepunte) leveranciersposten (VendorLedgerEntries, Open=true), alle operationele vennootschappen — facturen, creditnota's en onafgepunte betalingen. Te betalen = −Remaining_Amt_LCY (factuur +, creditnota/betaling −)."
      : "Bron: ALLE open (niet-afgepunte) klantposten (Cust_LedgerEntries, Open=true), alle operationele vennootschappen — facturen, creditnota's en onafgepunte betalingen (negatief). Zelfde basis als het BC-rapport 'Klant - Vervallen posten'; gevalideerd op GDI: vervallen deel = € 4.188.920,04, exact het rapporttotaal van 11/08/2026.",
    "OUDERDOMSBLOKKEN t.o.v. de FACTUURDATUM (afspraak finance 11/08/2026): 0–30d / 31–60d / 61–90d / > 90d / Onbekend (geen datum). Dit meet hoe lang het geld al zweeft, los van de afgesproken betaaltermijn.",
    "WAARVAN VERVALLEN (bladen 'Per vennootschap' en 'Samenvatting') = posten met vervaldag op of vóór vandaag — dat is het cijfer dat aansluit op het BC-rapport 'Vervallen posten'. Een vervallen vervaldatum kleurt rood op het Aging-blad.",
    "BETALINGSVOORWAARDE: de conditiecode uit de stamdata (bv. 30D = 30 dagen na factuurdatum, LM+30D = eind maand + 30 dagen). Leeg = geen conditie ingevuld in BC.",
    "Groepering per naam over alle vennootschappen (firmacode-prefix en rechtsvormen genegeerd bij het matchen).",
    "Soort: IC = intercompany (eigen groepsvennootschap als tegenpartij, naam-gebaseerd).",
    "DOORKLIKKEN: het factuurnummer op het Aging-blad is een link die de post rechtstreeks in Business Central opent (BC-login vereist).",
    "BTW-NUMMER: uit de klanten-/leveranciersstamdata in BC (veld Ondernemingsnr./btw). Leeg = niet ingevuld in BC; bij een naam-groep over meerdere vennootschappen wordt het eerste ingevulde nummer getoond.",
    `Groepstotaal: € ${grandTotal.toLocaleString("nl-BE")} open over ${rows.length} posten en ${groups.size} ${isAP ? "leveranciers" : "klanten"}, waarvan € ${grandOverdue.toLocaleString("nl-BE")} vervallen.`,
  ];
  notes.forEach((t, i) => {
    ws3.getCell(i + 2, 2).value = t;
    ws3.getCell(i + 2, 2).font = i === 0 ? { bold: true, size: 13 } : i === 1 ? { bold: true } : { size: 10 };
  });
  ws3.getColumn(2).width = 130;

  const buffer = await wb.xlsx.writeBuffer();
  const filename = `${isAP ? "Leveranciersaging" : "Klantenaging"} - Gheeraert Groep - ${fileStamp}.xlsx`;
  return { buffer: buffer as ArrayBuffer, filename };
}
