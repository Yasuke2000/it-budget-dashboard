// On-demand "Overzicht uitgaven"-export (Excel) voor de CFO-cockpit — de knop die
// David 11/08/2026 vroeg, als live variant van de FINSIT/OVZ-export uit
// exports/_generator (pull-data.mjs + build-xlsx3.py). Zelfde categorie→rekening-
// mapping en zelfde semantiek: geboekte kosten excl. BTW (klasse 60-65, debet−credit)
// per firma per maand, plus BV (453-credits) als memo buiten het totaal.
// De maandblokken per firma spiegelen 1-op-1 het Excel "Overzicht uitgaven JAN JUN"
// dat finance kent (categorie × firma, TOTAAL excl. BV°).

import ExcelJS from "exceljs";
import { getBCToken, fetchBCCompanies } from "./bc-client";
import { fetchWithRetry } from "./http";

const ODATA_ROOT = `https://api.businesscentral.dynamics.com/v2.0/${process.env.BC_TENANT_ID}/${process.env.BC_ENVIRONMENT || "production"}`;
const API_ROOT = `${ODATA_ROOT}/api/v2.0`;

// Vaste firmavolgorde zoals in de bestaande export (finance is die volgorde gewend).
const COMPANY_ORDER = ["GTR", "GTG", "GSS", "GPR", "TFO", "GDI", "GRE", "WHS", "TDR", "LMB", "GEX"];

// ---- categorie-mapping — identiek aan exports/_generator/pull-data.mjs ----
const SETS: Record<string, Set<string>> = {
  LONEN: new Set(["620200", "620205", "620210"]),
  WEDDES: new Set(["620100", "620101", "620110"]),
  RSZ: new Set(["621000", "621100", "621300", "621400", "621500", "621550", "621600", "621605", "621610", "621620", "645000"]),
  MANAGERS: new Set(["613301"]),
  ZELFSTANDIGEN: new Set(["613300"]),
  MAALTIJDCHEQUES: new Set(["623710", "613311"]),
  LEASINGS: new Set(["610100", "610200", "610250", "610260", "610500", "650010"]),
  KREDIETEN: new Set(["650000", "650020", "650023", "650100"]),
  ONDERAANNEMERS: new Set(["603000", "603001", "603002", "603003", "603010", "603020"]),
  DIESEL: new Set(["601300", "601310", "601320", "604300", "604301", "604310", "604320", "604330", "612000", "612015", "612025", "612030"]),
  TOL: new Set(["615100", "615101", "615110", "615111", "615120"]),
  DKV: new Set(["613362"]), // 613363 = AS24 (andere kaartaanbieder) → REST
};
const EXCLUDE_PREFIX = ["609", "630", "631", "634", "638", "66", "67", "68", "69"]; // non-cash / resultaat
const EXCLUDE_ACCT = new Set(["621200", "621201", "621202", "621203"]); // vakantiegeld-provisies

const CAT_ORDER: { key: string; label: string }[] = [
  { key: "LONEN", label: "Lonen" }, { key: "WEDDES", label: "Weddes" }, { key: "RSZ", label: "RSZ" },
  { key: "BV", label: "BV°" },
  { key: "MANAGERS", label: "Managers" }, { key: "ZELFSTANDIGEN", label: "Zelfstandigen" },
  { key: "MAALTIJDCHEQUES", label: "Maaltijdcheques" },
  { key: "LEASINGS", label: "Leasings" }, { key: "KREDIETEN", label: "Kredieten" }, { key: "HUUR", label: "Huur" },
  { key: "ONDERAANNEMERS", label: "Onderaannemers" },
  { key: "DIESEL", label: "Diesel" }, { key: "TOL", label: "Tol" }, { key: "DKV", label: "DKV" },
  { key: "REST", label: "Rest" },
];

function categorize(acct: string, desc: string): string {
  if (/dkv/i.test(desc || "")) return "DKV";
  for (const [cat, set] of Object.entries(SETS)) if (set.has(acct)) return cat;
  if (acct.startsWith("6100")) return "HUUR";
  return "REST";
}
function inScope(acct: string): boolean {
  if (acct.length < 6) return false;
  if (EXCLUDE_ACCT.has(acct)) return false;
  for (const p of EXCLUDE_PREFIX) if (acct.startsWith(p)) return false;
  return /^6[0-5]/.test(acct);
}

// months["2026-01"]["GTR"]["LONEN"] = bedrag
export type UitgavenData = {
  months: Record<string, Record<string, Record<string, number>>>;
  companies: string[];
  rows: number;
};

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
    for (const v of data.value || []) out.push(v);
    next = data["@odata.nextLink"] || null;
    page++;
  }
  return out;
}

export async function fetchUitgaven(fromISO: string, toISO: string): Promise<UitgavenData> {
  const token = await getBCToken();
  const companies = (await fetchBCCompanies())
    .map((c) => ({ id: String(c.id), name: String(c.name) }))
    .filter((c) => COMPANY_ORDER.includes(c.name));
  const months: UitgavenData["months"] = {};
  let rows = 0;

  for (const c of companies) {
    const filter = `postingDate ge ${fromISO} and postingDate le ${toISO} and (startswith(accountNumber,'6') or startswith(accountNumber,'453'))`;
    const url = `${API_ROOT}/companies(${c.id})/generalLedgerEntries?$filter=${encodeURIComponent(filter)}&$select=postingDate,accountNumber,description,debitAmount,creditAmount`;
    const entries = await pageAll(url, token);
    for (const e of entries) {
      const acct = String(e.accountNumber || "");
      const m = String(e.postingDate || "").slice(0, 7);
      if (!m) continue;
      let cat: string;
      let amt: number;
      if (acct.startsWith("453")) {
        // BV = alleen creditzijde (ingehouden bedrijfsvoorheffing van de maand);
        // betalingen (debet) niet netteren — zelfde regel als de gevalideerde export.
        amt = Number(e.creditAmount || 0);
        if (!amt) continue;
        cat = "BV";
      } else {
        if (!inScope(acct)) continue;
        amt = Number(e.debitAmount || 0) - Number(e.creditAmount || 0);
        cat = categorize(acct, String(e.description || ""));
      }
      rows++;
      const mm = (months[m] ??= {});
      const co = (mm[c.name] ??= {});
      co[cat] = (co[cat] || 0) + amt;
    }
  }
  // afronden op de cent
  for (const m of Object.keys(months)) for (const co of Object.keys(months[m])) for (const k of Object.keys(months[m][co])) months[m][co][k] = Math.round(months[m][co][k] * 100) / 100;
  const present = COMPANY_ORDER.filter((n) => companies.some((c) => c.name === n));
  return { months, companies: present, rows };
}

// ---- workbook ----
const MONTH_NL = ["Januari", "Februari", "Maart", "April", "Mei", "Juni", "Juli", "Augustus", "September", "Oktober", "November", "December"];
const EUR_FMT = '#,##0.00 "€"';

function monthLabel(m: string): string {
  return `${MONTH_NL[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
}

export async function buildUitgavenWorkbook(data: UitgavenData, fromISO: string, toISO: string, pulledAt: Date): Promise<{ buffer: ArrayBuffer; filename: string }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "IT Finance dashboard";
  wb.created = pulledAt;
  const stamp = pulledAt.toLocaleString("nl-BE", { timeZone: "Europe/Brussels", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const monthKeys = Object.keys(data.months).sort();
  const COS = data.companies;
  const val = (m: string, co: string, cat: string) => data.months[m]?.[co]?.[cat] || 0;
  const gMonth = (m: string, cat: string) => Math.round(COS.reduce((s, co) => s + val(m, co, cat), 0) * 100) / 100;
  const coMonthTot = (m: string, co: string) => Math.round(CAT_ORDER.filter((c) => c.key !== "BV").reduce((s, c) => s + val(m, co, c.key), 0) * 100) / 100;

  // ---------- Overzicht ----------
  const ov = wb.addWorksheet("Overzicht", { views: [{ showGridLines: false }] });
  ov.getCell("B2").value = `OVERZICHT UITGAVEN GHEERAERT GROEP — ${fromISO} t/m ${toISO}`;
  ov.getCell("B2").font = { bold: true, size: 15 };
  ov.getCell("B3").value = `Geboekte kosten excl. BTW · ${COS.length} entiteiten · incl. intercompany · bron: Business Central (live) · data getrokken ${stamp}`;
  ov.getCell("B3").font = { italic: true, size: 9, color: { argb: "FF808080" } };

  // maandtrend
  ov.getCell("B5").value = "Maandtrend (totaal excl. BV°)";
  ov.getCell("B5").font = { bold: true, size: 12 };
  monthKeys.forEach((m, i) => {
    const h = ov.getCell(6, 2 + i); h.value = monthLabel(m).slice(0, 3); h.font = { bold: true };
    const c = ov.getCell(7, 2 + i);
    c.value = Math.round(COS.reduce((s, co) => s + coMonthTot(m, co), 0) * 100) / 100;
    c.numFmt = '#,##0 "€"';
  });

  // per categorie (rijen) × maand (kolommen)
  let r = 9;
  ov.getCell(r, 2).value = "Per categorie"; ov.getCell(r, 2).font = { bold: true, size: 12 }; r++;
  ov.getCell(r, 2).value = "Categorie"; ov.getCell(r, 2).font = { bold: true };
  monthKeys.forEach((m, i) => { const c = ov.getCell(r, 3 + i); c.value = monthLabel(m).slice(0, 3); c.font = { bold: true }; });
  const totCol = 3 + monthKeys.length;
  ov.getCell(r, totCol).value = "Totaal"; ov.getCell(r, totCol).font = { bold: true };
  r++;
  const ranked = CAT_ORDER.filter((c) => c.key !== "BV")
    .slice()
    .sort((a, b) => Math.abs(monthKeys.reduce((s, m) => s + gMonth(m, b.key), 0)) - Math.abs(monthKeys.reduce((s, m) => s + gMonth(m, a.key), 0)));
  for (const cat of ranked) {
    ov.getCell(r, 2).value = cat.label;
    monthKeys.forEach((m, i) => { const c = ov.getCell(r, 3 + i); c.value = gMonth(m, cat.key); c.numFmt = '#,##0 "€"'; });
    const t = ov.getCell(r, totCol);
    t.value = Math.round(monthKeys.reduce((s, m) => s + gMonth(m, cat.key), 0) * 100) / 100;
    t.numFmt = '#,##0 "€"'; t.font = { bold: true };
    r++;
  }
  ov.getCell(r, 2).value = "TOTAAL (excl. BV°)"; ov.getCell(r, 2).font = { bold: true };
  monthKeys.forEach((m, i) => {
    const c = ov.getCell(r, 3 + i);
    c.value = Math.round(COS.reduce((s, co) => s + coMonthTot(m, co), 0) * 100) / 100;
    c.numFmt = '#,##0 "€"'; c.font = { bold: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
  });
  const gt = ov.getCell(r, totCol);
  gt.value = Math.round(monthKeys.reduce((s, m) => s + COS.reduce((x, co) => x + coMonthTot(m, co), 0), 0) * 100) / 100;
  gt.numFmt = '#,##0 "€"'; gt.font = { bold: true };
  gt.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
  r += 2;
  ov.getCell(r, 2).value = "° BV (memo — zit in de bruto lonen, telt niet mee in het totaal):";
  ov.getCell(r, 2).font = { italic: true, size: 9, color: { argb: "FF808080" } };
  monthKeys.forEach((m, i) => { const c = ov.getCell(r, 3 + i); c.value = gMonth(m, "BV"); c.numFmt = '#,##0 "€"'; c.font = { italic: true, size: 9, color: { argb: "FF808080" } }; });
  ov.getColumn(2).width = 22;
  for (let i = 0; i <= monthKeys.length; i++) ov.getColumn(3 + i).width = 13.5;

  // ---------- Per firma per maand (het blok-formaat dat finance kent) ----------
  const wf = wb.addWorksheet("Per firma per maand", { views: [{ showGridLines: false }] });
  wf.getCell("B1").value = "Totaalbedrag per firma per maand, per categorie. BV° = memo (ingehouden bedrijfsvoorheffing, zit in de bruto lonen) en telt niet mee in TOTAAL.";
  wf.getCell("B1").font = { italic: true, size: 9, color: { argb: "FF808080" } };
  let fr = 3;
  for (const m of monthKeys) {
    const t = wf.getCell(fr, 2); t.value = monthLabel(m);
    t.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
    t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0070C0" } };
    fr++;
    wf.getCell(fr, 2).value = "Categorie"; wf.getCell(fr, 2).font = { bold: true };
    COS.forEach((co, j) => { const h = wf.getCell(fr, 3 + j); h.value = co; h.font = { bold: true }; });
    const gcol = 3 + COS.length;
    wf.getCell(fr, gcol).value = "Totaal groep"; wf.getCell(fr, gcol).font = { bold: true };
    fr++;
    const catStart = fr;
    for (const cat of CAT_ORDER) {
      const isBV = cat.key === "BV";
      const lc = wf.getCell(fr, 2); lc.value = cat.label;
      if (isBV) lc.font = { italic: true, color: { argb: "FF808080" } };
      COS.forEach((co, j) => {
        const c = wf.getCell(fr, 3 + j); c.value = val(m, co, cat.key); c.numFmt = EUR_FMT;
        if (isBV) c.font = { italic: true, color: { argb: "FF808080" } };
      });
      const g = wf.getCell(fr, gcol); g.value = gMonth(m, cat.key); g.numFmt = EUR_FMT; g.font = { bold: !isBV, italic: isBV, color: isBV ? { argb: "FF808080" } : undefined };
      fr++;
    }
    // TOTAAL-rij (excl. BV): BV staat op catStart+3 → som in twee stukken, zoals het origineel
    const bvRow = catStart + CAT_ORDER.findIndex((c) => c.key === "BV");
    const lastCat = catStart + CAT_ORDER.length - 1;
    const tc = wf.getCell(fr, 2); tc.value = "TOTAAL (excl. BV°)"; tc.font = { bold: true };
    tc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
    for (let j = 0; j <= COS.length; j++) {
      const colL = wf.getColumn(3 + j).letter;
      const c = wf.getCell(fr, 3 + j);
      c.value = { formula: `SUM(${colL}${catStart}:${colL}${bvRow - 1})+SUM(${colL}${bvRow + 1}:${colL}${lastCat})` };
      c.numFmt = EUR_FMT; c.font = { bold: true };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
    }
    fr += 3;
  }
  wf.getColumn(2).width = 18;
  for (let j = 0; j <= COS.length; j++) wf.getColumn(3 + j).width = 14;

  // ---------- Leeswijzer & Mapping ----------
  const lw = wb.addWorksheet("Leeswijzer & Mapping", { views: [{ showGridLines: false }] });
  const lines: [string, boolean][] = [
    [`Overzicht uitgaven — Gheeraert Groep · periode ${fromISO} t/m ${toISO} · data live uit Business Central getrokken op ${stamp}.`, true],
    ["Wat telt mee: geboekte kosten excl. BTW op grootboekklasse 60–65 (debet − credit), boekingsdatum in de periode, alle operationele vennootschappen, incl. intercompany.", false],
    ["Uitgesloten (non-cash/resultaat): 609* voorraadwijzigingen, 630/631/634/638 afschrijvingen & voorzieningen, klasse 66–69, en 6212xx vakantiegeld-provisies.", false],
    ["BV° = credits op 453* (ingehouden bedrijfsvoorheffing) — memo: zit al in de bruto lonen en telt dus NIET mee in het totaal.", false],
    ["De laatste maand kan onvolledig zijn zolang de loonverwerking niet geboekt is (lonen van maand X worden begin maand X+1 geboekt).", false],
    ["", false],
    ["Categorie → grootboekrekeningen:", true],
    ["Lonen: 620200, 620205, 620210", false],
    ["Weddes: 620100, 620101, 620110", false],
    ["RSZ: 621000, 621100, 621300–621620, 645000", false],
    ["Managers: 613301 · Zelfstandigen: 613300", false],
    ["Maaltijdcheques: 623710, 613311", false],
    ["Leasings: 610100, 610200, 610250, 610260, 610500, 650010", false],
    ["Kredieten: 650000, 650020, 650023, 650100", false],
    ["Huur: overige 6100*", false],
    ["Onderaannemers: 603000–603020", false],
    ["Diesel: 601300–601320, 604300–604330, 612000–612030", false],
    ["Tol: 615100–615120", false],
    ["DKV: 613362 + omschrijving bevat 'DKV' (613363 = AS24 → Rest)", false],
    ["Rest: alle overige 60–65-rekeningen in scope", false],
    ["", false],
    ["Zelfde mapping als de gevalideerde export 'Uitgaven per categorie' (FINSIT/OVZ-stijl); detail per week/persoon staat in die Excel (exports-map).", false],
  ];
  lines.forEach(([txt, bold], i) => {
    const c = lw.getCell(i + 2, 2); c.value = txt; c.font = { bold, size: bold ? 11 : 10 };
  });
  lw.getColumn(2).width = 130;

  const buffer = await wb.xlsx.writeBuffer();
  const dstamp = pulledAt.toLocaleDateString("sv-SE", { timeZone: "Europe/Brussels" });
  return { buffer: buffer as ArrayBuffer, filename: `Overzicht uitgaven - Gheeraert Groep - ${fromISO} tm ${toISO} (pull ${dstamp}).xlsx` };
}

// Default-periode voor de knop: 1 januari van dit jaar t/m de laatste VOLLEDIGE maand
// (lonen van de lopende maand zijn nog niet geboekt — zie Leeswijzer).
export function defaultUitgavenRange(now = new Date()): { from: string; to: string } {
  const brussels = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Brussels" }));
  const y = brussels.getFullYear();
  const lastFullMonthEnd = new Date(y, brussels.getMonth(), 0); // dag 0 = laatste dag vorige maand
  const to = `${lastFullMonthEnd.getFullYear()}-${String(lastFullMonthEnd.getMonth() + 1).padStart(2, "0")}-${String(lastFullMonthEnd.getDate()).padStart(2, "0")}`;
  return { from: `${lastFullMonthEnd.getFullYear()}-01-01`, to };
}
