// On-demand aging exports (Excel) for the CFO cockpit — the "button" Laura asked for.
// Pulls LIVE open items from Business Central and builds a grouped aging workbook:
//  - AP (leveranciers): ODataV4 web service VendorLedgerEntries (NOT in api/v2.0)
//  - AR (klanten):      api/v2.0 salesInvoices with remainingAmount (status Open)
// Every export carries the pull timestamp in the filename, the title row and the
// Leeswijzer, so finance always knows how fresh the numbers are.

import ExcelJS from "exceljs";
import { getBCToken, fetchBCCompanies } from "./bc-client";
import { fetchWithRetry } from "./http";

const ODATA_ROOT = `https://api.businesscentral.dynamics.com/v2.0/${process.env.BC_TENANT_ID}/${process.env.BC_ENVIRONMENT || "production"}`;
const API_ROOT = `${ODATA_ROOT}/api/v2.0`;

function isOperatingCompany(name: string): boolean {
  return !/^_/.test(name) && !/test|copie|fleetmate/i.test(name);
}

// Intercompany counterparty (own group entity) — same heuristic as the validated exports.
const IC_RX = /gheeraert|\bde\s*rudder\b|dr logistics|\brudder\b|marcel lamberts|lamberts en zonen|trans[\s-]?form|\bwarehouse\b|m[\s-]?express/i;
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
  return out;
}

const DOCTYPE_NL: Record<string, string> = {
  Invoice: "Factuur", "Credit Memo": "Creditnota", Payment: "Betaling", Refund: "Terugbetaling", " ": "—", "": "—",
};
function cleanDate(d: unknown): string {
  const s = String(d || "");
  return s && !s.startsWith("0001") ? s.slice(0, 10) : "";
}

/** All OPEN vendor ledger entries, group-wide. Payable = −Remaining_Amt_LCY. */
export async function fetchAgingAP(): Promise<AgingRow[]> {
  const token = await getBCToken();
  const companies = (await fetchBCCompanies())
    .map((c) => String(c.name))
    .filter(isOperatingCompany);
  const rows: AgingRow[] = [];
  for (const co of companies) {
    // NO $top: it caps the TOTAL result set (a €776k lesson) — page via nextLink.
    const url = `${ODATA_ROOT}/ODataV4/Company('${encodeURIComponent(co)}')/VendorLedgerEntries?$filter=Open eq true&$select=Vendor_Name,Document_Type,Document_No,Document_Date,Posting_Date,Due_Date,Currency_Code,Remaining_Amount,Remaining_Amt_LCY`;
    const raw = await pageAll(url, token);
    for (const e of raw) {
      const remLCY = (e.Remaining_Amt_LCY as number) || 0;
      const remDoc = (e.Remaining_Amount as number) || 0;
      if (remLCY === 0 && remDoc === 0) continue;
      rows.push({
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

/** All OPEN sales invoices (receivables), group-wide. Credit memos are not netted. */
export async function fetchAgingAR(): Promise<AgingRow[]> {
  const token = await getBCToken();
  const companies = (await fetchBCCompanies())
    .filter((c) => isOperatingCompany(String(c.name)))
    .map((c) => ({ id: String(c.id), code: String(c.name) }));
  const rows: AgingRow[] = [];
  for (const c of companies) {
    const url = `${API_ROOT}/companies(${c.id})/salesInvoices?$filter=${encodeURIComponent("status eq 'Open'")}&$select=number,customerName,invoiceDate,dueDate,currencyCode,remainingAmount`;
    const raw = await pageAll(url, token);
    for (const e of raw) {
      const rem = (e.remainingAmount as number) || 0;
      if (!rem) continue;
      rows.push({
        party: String(e.customerName || "").trim() || "(zonder naam)",
        docNo: String(e.number || ""),
        docType: "Factuur",
        amountOrigin: Math.round(rem * 100) / 100,
        currency: String(e.currencyCode || "EUR") || "EUR",
        invoiceDate: cleanDate(e.invoiceDate),
        dueDate: cleanDate(e.dueDate),
        amountEUR: Math.round(rem * 100) / 100,
        company: c.code,
      });
    }
  }
  return rows;
}

// ---------------- workbook ----------------

const BUCKETS = ["Niet vervallen", "< 30d", "< 60d", "< 90d", "> 90d", "Onbekend"] as const;
function bucketOf(due: string, snapshot: Date): (typeof BUCKETS)[number] {
  if (!due) return "Onbekend";
  const d = new Date(`${due}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "Onbekend";
  const days = Math.floor((snapshot.getTime() - d.getTime()) / 86400000);
  if (days <= 0) return "Niet vervallen";
  if (days <= 30) return "< 30d";
  if (days <= 60) return "< 60d";
  if (days <= 90) return "< 90d";
  return "> 90d";
}

const EUR_FMT = '#,##0.00\\ "€"';
const BLUE = "FF1F5FA8", BLUEROW = "FF4E86C6", ICCLR = "FF7A5195", YELLOW = "FFFFF2CC";
function fill(ws: ExcelJS.Worksheet, row: number, cols: number, argb: string) {
  for (let c = 1; c <= cols; c++) ws.getCell(row, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
}

export async function buildAgingWorkbook(
  kind: "ap" | "ar", rows: AgingRow[], pulledAt: Date
): Promise<{ buffer: ArrayBuffer; filename: string }> {
  const isAP = kind === "ap";
  const partyLabel = isAP ? "Leveranciersnaam" : "Klantnaam";
  const title = isAP ? "LEVERANCIERSAGING" : "KLANTENAGING";
  const stamp = pulledAt.toLocaleString("nl-BE", { timeZone: "Europe/Brussels", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const fileStamp = pulledAt.toLocaleString("sv-SE", { timeZone: "Europe/Brussels" }).replace(" ", "_").replace(/:/g, "").slice(0, 15);

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
    for (const r of rs) s[bucketOf(r.dueDate, pulledAt)] += r.amountEUR;
    return s;
  };

  const wb = new ExcelJS.Workbook();
  wb.created = pulledAt;

  // ---- sheet 1: detail grouped ----
  const ws = wb.addWorksheet("Aging");
  const headers = [partyLabel, "Factuurnummer", "Totaalbedrag", "Munt", "Factuurdatum", "Vervaldatum", ...BUCKETS, "Soort", "Vennootschap"];
  const NC = headers.length;
  ws.getCell(1, 1).value = `${title} — GHEERAERT GROEP — data getrokken op ${stamp}`;
  ws.getCell(1, 1).font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
  fill(ws, 1, NC, BLUE);
  ws.getRow(3).values = headers;
  ws.getRow(3).font = { bold: true, color: { argb: "FFFFFFFF" } };
  fill(ws, 3, NC, BLUE);
  const widths = [34, 16, 14, 7, 12, 12, 13, 12, 12, 12, 13, 12, 9, 26];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  const grand = bucketSums(rows);
  const grandTotal = Math.round(BUCKETS.reduce((s, b) => s + grand[b], 0) * 100) / 100;
  let r = 4;
  ws.getCell(r, 1).value = "GROEPSTOTAAL";
  ws.getCell(r, 1).font = { bold: true };
  ws.getCell(r, 3).value = grandTotal;
  BUCKETS.forEach((b, i) => { const c = ws.getCell(r, 7 + i); c.value = Math.round(grand[b] * 100) / 100; c.numFmt = EUR_FMT; c.font = { bold: true }; });
  ws.getCell(r, 3).numFmt = EUR_FMT; ws.getCell(r, 3).font = { bold: true };
  fill(ws, r, NC, YELLOW);
  r++;

  for (const g of order) {
    const sums = bucketSums(g.rows);
    const net = Math.round(BUCKETS.reduce((s, b) => s + sums[b], 0) * 100) / 100;
    const ic = IC_RX.test(g.display);
    ws.getCell(r, 1).value = g.display;
    ws.getCell(r, 3).value = net;
    ws.getCell(r, 3).numFmt = EUR_FMT;
    BUCKETS.forEach((b, i) => { const v = Math.round(sums[b] * 100) / 100; if (v) { const c = ws.getCell(r, 7 + i); c.value = v; c.numFmt = EUR_FMT; } });
    ws.getCell(r, 13).value = ic ? "IC" : "Extern";
    ws.getRow(r).font = { bold: true, color: { argb: "FFFFFFFF" } };
    fill(ws, r, NC, ic ? ICCLR : BLUEROW);
    r++;
    const sorted = [...g.rows].sort((a, b) => (a.company + (a.dueDate || "9999")).localeCompare(b.company + (b.dueDate || "9999")));
    for (const x of sorted) {
      ws.getCell(r, 1).value = g.display; ws.getCell(r, 1).font = { color: { argb: "FF808080" } };
      ws.getCell(r, 2).value = x.docNo + (x.docType !== "Factuur" ? `  ·${x.docType}` : "");
      ws.getCell(r, 3).value = x.amountOrigin; ws.getCell(r, 3).numFmt = EUR_FMT;
      ws.getCell(r, 4).value = x.currency;
      ws.getCell(r, 5).value = x.invoiceDate;
      ws.getCell(r, 6).value = x.dueDate;
      const b = bucketOf(x.dueDate, pulledAt);
      const ci = 7 + BUCKETS.indexOf(b);
      ws.getCell(r, ci).value = x.amountEUR; ws.getCell(r, ci).numFmt = EUR_FMT;
      if (b === "> 90d") ws.getCell(r, ci).font = { color: { argb: "FFB4342A" } };
      ws.getCell(r, 14).value = x.company;
      r++;
    }
  }
  ws.views = [{ state: "frozen", ySplit: 3 }];

  // ---- sheet 2: summary ----
  const ws2 = wb.addWorksheet("Samenvatting");
  ws2.getCell(1, 1).value = `SAMENVATTING PER ${isAP ? "LEVERANCIER" : "KLANT"} — data getrokken op ${stamp}`;
  ws2.getCell(1, 1).font = { bold: true, size: 12 };
  const h2 = [partyLabel, "Soort", "Totaal openstaand", ...BUCKETS, "# posten", "# venn."];
  ws2.getRow(3).values = h2;
  ws2.getRow(3).font = { bold: true, color: { argb: "FFFFFFFF" } };
  fill(ws2, 3, h2.length, BLUE);
  ws2.getColumn(1).width = 36;
  for (let i = 3; i <= 9; i++) ws2.getColumn(i).width = 14;
  let r2 = 4;
  for (const g of order) {
    const sums = bucketSums(g.rows);
    const net = Math.round(BUCKETS.reduce((s, b) => s + sums[b], 0) * 100) / 100;
    ws2.getCell(r2, 1).value = g.display;
    ws2.getCell(r2, 2).value = IC_RX.test(g.display) ? "IC" : "Extern";
    ws2.getCell(r2, 3).value = net; ws2.getCell(r2, 3).numFmt = EUR_FMT; ws2.getCell(r2, 3).font = { bold: true };
    BUCKETS.forEach((b, i) => { const c = ws2.getCell(r2, 4 + i); c.value = Math.round(sums[b] * 100) / 100; c.numFmt = EUR_FMT; });
    ws2.getCell(r2, 10).value = g.rows.length;
    ws2.getCell(r2, 11).value = new Set(g.rows.map((x) => x.company)).size;
    r2++;
  }
  ws2.autoFilter = { from: { row: 3, column: 1 }, to: { row: r2 - 1, column: h2.length } };
  ws2.views = [{ state: "frozen", ySplit: 3 }];

  // ---- sheet 3: leeswijzer ----
  const ws3 = wb.addWorksheet("Leeswijzer");
  const notes = [
    `${title} — Gheeraert Groep`,
    `DATA GETROKKEN OP: ${stamp} (live uit Business Central op het moment van de klik).`,
    "",
    isAP
      ? "Bron: open leveranciersposten (VendorLedgerEntries, Open=true), alle operationele vennootschappen. Te betalen = −Remaining_Amt_LCY (factuur +, creditnota/betaling −)."
      : "Bron: open verkoopfacturen (salesInvoices, status Open, remainingAmount), alle operationele vennootschappen. Creditnota's zijn niet gesaldeerd.",
    "Buckets t.o.v. de VERVALDATUM: Niet vervallen / < 30d / < 60d / < 90d / > 90d / Onbekend (geen vervaldatum).",
    "Groepering per naam over alle vennootschappen (firmacode-prefix en rechtsvormen genegeerd bij het matchen).",
    "Soort: IC = intercompany (eigen groepsvennootschap als tegenpartij, naam-gebaseerd).",
    `Groepstotaal: € ${grandTotal.toLocaleString("nl-BE")} over ${rows.length} posten en ${groups.size} ${isAP ? "leveranciers" : "klanten"}.`,
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
