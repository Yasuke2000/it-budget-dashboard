// On-demand "Overzicht uitgaven"-export (Excel) voor de CFO-cockpit — de knop die
// David 11/08/2026 vroeg, als live variant van de FINSIT/OVZ-export uit
// exports/_generator (pull-data.mjs + build-xlsx3.py). Zelfde categorie→rekening-
// mapping en zelfde semantiek: geboekte kosten excl. BTW (klasse 60-65, debet−credit)
// per firma per maand, plus BV (453-credits) als memo buiten het totaal.
// De maandblokken per firma spiegelen 1-op-1 het Excel "Overzicht uitgaven JAN JUN"
// dat finance kent (categorie × firma, TOTAAL excl. BV°).
// v2 (audit 11/08): blad "Detail rekeningen" (audittrail per grootboekrekening met
// BC-deeplink), wit canvas (geen gridlines), freeze panes + autofilter, zebra-rijen.

import ExcelJS from "exceljs";
import { getBCToken, fetchBCCompanies } from "./bc-client";
import { fetchWithRetry } from "./http";
import { glAccountLink } from "./bc-links";

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
const CAT_LABEL: Record<string, string> = Object.fromEntries(CAT_ORDER.map((c) => [c.key, c.label]));

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
// acctDetail["2026-01"]["GTR|620200|LONEN"] = bedrag  (audittrail)
export type UitgavenData = {
  months: Record<string, Record<string, Record<string, number>>>;
  acctDetail: Record<string, Record<string, number>>;
  acctNames: Record<string, string>;
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
  const acctDetail: UitgavenData["acctDetail"] = {};
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
      const dm = (acctDetail[m] ??= {});
      const key = `${c.name}|${acct}|${cat}`;
      dm[key] = (dm[key] || 0) + amt;
    }
  }
  // afronden op de cent
  for (const m of Object.keys(months)) for (const co of Object.keys(months[m])) for (const k of Object.keys(months[m][co])) months[m][co][k] = Math.round(months[m][co][k] * 100) / 100;
  for (const m of Object.keys(acctDetail)) for (const k of Object.keys(acctDetail[m])) acctDetail[m][k] = Math.round(acctDetail[m][k] * 100) / 100;

  // Rekeningnamen voor de audittrail: unie over de 3 grootste boekhoudingen volstaat
  // (zelfde aanpak als de offline generator: GTR/GDI/WHS dekken het rekeningschema).
  const acctNames: Record<string, string> = {};
  for (const c of companies.filter((x) => ["GTR", "GDI", "WHS"].includes(x.name))) {
    const accounts = await pageAll(`${API_ROOT}/companies(${c.id})/accounts?$select=number,displayName`, token);
    for (const a of accounts) {
      const num = String(a.number || "");
      if (num && !acctNames[num]) acctNames[num] = String(a.displayName || "");
    }
  }

  const present = COMPANY_ORDER.filter((n) => companies.some((c) => c.name === n));
  return { months, acctDetail, acctNames, companies: present, rows };
}

// ---- workbook ----
const MONTH_NL = ["Januari", "Februari", "Maart", "April", "Mei", "Juni", "Juli", "Augustus", "September", "Oktober", "November", "December"];
const EUR_FMT = '#,##0.00 "€"';
const EURK_FMT = '#,##0 "€"';
const C = { blue: "FF0F4C81", lightBlue: "FFE8F0F8", yellow: "FFFFF2CC", yellowStrong: "FFFFE599", grey: "FF808080", zebra: "FFF6F8FA", white: "FFFFFFFF" };
const fillOf = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

function monthLabel(m: string): string {
  return `${MONTH_NL[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
}
function monthShort(m: string): string {
  return `${MONTH_NL[Number(m.slice(5, 7)) - 1].slice(0, 3)} ${m.slice(2, 4)}`;
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
  const gMonthTot = (m: string) => Math.round(COS.reduce((s, co) => s + coMonthTot(m, co), 0) * 100) / 100;

  // ---------- Overzicht ----------
  const ov = wb.addWorksheet("Overzicht", { views: [{ showGridLines: false }], properties: { tabColor: { argb: C.blue } } });
  const ovTitle = ov.getCell("B2");
  ovTitle.value = `OVERZICHT UITGAVEN GHEERAERT GROEP — ${fromISO} t/m ${toISO}`;
  ovTitle.font = { bold: true, size: 15, color: { argb: C.white } };
  ovTitle.fill = fillOf(C.blue);
  ov.mergeCells(2, 2, 2, Math.max(4 + monthKeys.length, 8));
  ov.getRow(2).height = 24;
  ov.getCell("B3").value = `Geboekte kosten excl. BTW · ${COS.length} entiteiten · incl. intercompany · bron: Business Central (live) · data getrokken ${stamp}`;
  ov.getCell("B3").font = { italic: true, size: 9, color: { argb: C.grey } };

  // maandtrend
  ov.getCell("B5").value = "Maandtrend (totaal excl. BV°)";
  ov.getCell("B5").font = { bold: true, size: 12 };
  monthKeys.forEach((m, i) => {
    const h = ov.getCell(6, 2 + i); h.value = monthShort(m); h.font = { bold: true, color: { argb: C.blue } };
    h.fill = fillOf(C.lightBlue);
    const c = ov.getCell(7, 2 + i); c.value = gMonthTot(m); c.numFmt = EURK_FMT;
  });

  // per categorie (rijen) × maand (kolommen)
  let r = 9;
  ov.getCell(r, 2).value = "Per categorie"; ov.getCell(r, 2).font = { bold: true, size: 12 }; r++;
  const hdrRow = r;
  ov.getCell(r, 2).value = "Categorie";
  monthKeys.forEach((m, i) => { ov.getCell(r, 3 + i).value = monthShort(m); });
  const totCol = 3 + monthKeys.length;
  ov.getCell(r, totCol).value = "Totaal";
  ov.getCell(r, totCol + 1).value = "Aandeel";
  for (let cc = 2; cc <= totCol + 1; cc++) {
    const c = ov.getCell(hdrRow, cc);
    c.font = { bold: true, color: { argb: C.white } }; c.fill = fillOf(C.blue);
  }
  r++;
  const grand = Math.round(monthKeys.reduce((s, m) => s + gMonthTot(m), 0) * 100) / 100;
  const ranked = CAT_ORDER.filter((c) => c.key !== "BV")
    .slice()
    .sort((a, b) => Math.abs(monthKeys.reduce((s, m) => s + gMonth(m, b.key), 0)) - Math.abs(monthKeys.reduce((s, m) => s + gMonth(m, a.key), 0)));
  let zebra = false;
  for (const cat of ranked) {
    if (zebra) for (let cc = 2; cc <= totCol + 1; cc++) ov.getCell(r, cc).fill = fillOf(C.zebra);
    zebra = !zebra;
    ov.getCell(r, 2).value = cat.label;
    monthKeys.forEach((m, i) => { const c = ov.getCell(r, 3 + i); c.value = gMonth(m, cat.key); c.numFmt = EURK_FMT; });
    const catTot = Math.round(monthKeys.reduce((s, m) => s + gMonth(m, cat.key), 0) * 100) / 100;
    const t = ov.getCell(r, totCol); t.value = catTot; t.numFmt = EURK_FMT; t.font = { bold: true };
    const p = ov.getCell(r, totCol + 1); p.value = grand ? catTot / grand : 0; p.numFmt = "0.0%"; p.font = { size: 9, color: { argb: C.grey } };
    r++;
  }
  ov.getCell(r, 2).value = "TOTAAL (excl. BV°)";
  for (let cc = 2; cc <= totCol; cc++) { const c = ov.getCell(r, cc); c.font = { bold: true }; c.fill = fillOf(C.yellowStrong); }
  monthKeys.forEach((m, i) => { const c = ov.getCell(r, 3 + i); c.value = gMonthTot(m); c.numFmt = EURK_FMT; });
  const gt = ov.getCell(r, totCol); gt.value = grand; gt.numFmt = EURK_FMT;
  r += 2;
  ov.getCell(r, 2).value = "° BV (memo — zit in de bruto lonen, telt niet mee in het totaal):";
  ov.getCell(r, 2).font = { italic: true, size: 9, color: { argb: C.grey } };
  monthKeys.forEach((m, i) => { const c = ov.getCell(r, 3 + i); c.value = gMonth(m, "BV"); c.numFmt = EURK_FMT; c.font = { italic: true, size: 9, color: { argb: C.grey } }; });
  ov.getColumn(2).width = 22;
  for (let i = 0; i <= monthKeys.length; i++) ov.getColumn(3 + i).width = 13.5;
  ov.getColumn(totCol + 1).width = 9;

  // ---------- Per firma per maand (het blok-formaat dat finance kent) ----------
  const wf = wb.addWorksheet("Per firma per maand", { views: [{ showGridLines: false }], properties: { tabColor: { argb: C.blue } } });
  wf.getCell("B1").value = "Totaalbedrag per firma per maand, per categorie. BV° = memo (ingehouden bedrijfsvoorheffing, zit in de bruto lonen) en telt niet mee in TOTAAL.";
  wf.getCell("B1").font = { italic: true, size: 9, color: { argb: C.grey } };
  let fr = 3;
  const gcol = 3 + COS.length;
  for (const m of monthKeys) {
    const t = wf.getCell(fr, 2); t.value = monthLabel(m);
    t.font = { bold: true, size: 12, color: { argb: C.white } };
    t.fill = fillOf(C.blue);
    wf.mergeCells(fr, 2, fr, gcol);
    wf.getRow(fr).height = 20;
    fr++;
    wf.getCell(fr, 2).value = "Categorie";
    COS.forEach((co, j) => { wf.getCell(fr, 3 + j).value = co; });
    wf.getCell(fr, gcol).value = "Totaal groep";
    for (let cc = 2; cc <= gcol; cc++) { const c = wf.getCell(fr, cc); c.font = { bold: true, color: { argb: C.blue } }; c.fill = fillOf(C.lightBlue); }
    fr++;
    const catStart = fr;
    let z = false;
    for (const cat of CAT_ORDER) {
      const isBV = cat.key === "BV";
      if (z && !isBV) for (let cc = 2; cc <= gcol; cc++) wf.getCell(fr, cc).fill = fillOf(C.zebra);
      z = !z;
      const lc = wf.getCell(fr, 2); lc.value = cat.label;
      if (isBV) lc.font = { italic: true, color: { argb: C.grey } };
      COS.forEach((co, j) => {
        const c = wf.getCell(fr, 3 + j); c.value = val(m, co, cat.key); c.numFmt = EUR_FMT;
        if (isBV) c.font = { italic: true, color: { argb: C.grey } };
      });
      const g = wf.getCell(fr, gcol); g.value = gMonth(m, cat.key); g.numFmt = EUR_FMT;
      g.font = isBV ? { italic: true, color: { argb: C.grey } } : { bold: true };
      fr++;
    }
    // TOTAAL-rij (excl. BV): BV-rij overslaan in de som, zoals het origineel
    const bvRow = catStart + CAT_ORDER.findIndex((c) => c.key === "BV");
    const lastCat = catStart + CAT_ORDER.length - 1;
    const tc = wf.getCell(fr, 2); tc.value = "TOTAAL (excl. BV°)";
    for (let j = 0; j <= COS.length; j++) {
      const colL = wf.getColumn(3 + j).letter;
      const c = wf.getCell(fr, 3 + j);
      c.value = { formula: `SUM(${colL}${catStart}:${colL}${bvRow - 1})+SUM(${colL}${bvRow + 1}:${colL}${lastCat})` };
      c.numFmt = EUR_FMT;
    }
    for (let cc = 2; cc <= gcol; cc++) { const c = wf.getCell(fr, cc); c.font = { bold: true }; c.fill = fillOf(C.yellowStrong); }
    fr += 3;
  }
  wf.getColumn(2).width = 18;
  for (let j = 0; j <= COS.length; j++) wf.getColumn(3 + j).width = 14;
  wf.views = [{ showGridLines: false, state: "frozen", xSplit: 2 }];

  // ---------- Detail rekeningen (audittrail met BC-deeplinks) ----------
  const dt = wb.addWorksheet("Detail rekeningen", { views: [{ showGridLines: false, state: "frozen", ySplit: 4 }] });
  dt.getCell("B2").value = "Audittrail — elke grootboekrekening in scope, per firma per maand. Klik \"Open in BC\" om de boekingen op die rekening in Business Central te zien.";
  dt.getCell("B2").font = { italic: true, size: 9, color: { argb: C.grey } };
  const dHdr = ["Firma", "Rekening", "Naam", "Categorie", ...monthKeys.map(monthShort), "Totaal", "Open in BC"];
  dHdr.forEach((h, i) => {
    const c = dt.getCell(4, 2 + i); c.value = h; c.font = { bold: true, color: { argb: C.white } }; c.fill = fillOf(C.blue);
  });
  // verzamel per (firma, rekening, categorie) een rij met maandbedragen
  const detailRows = new Map<string, number[]>();
  monthKeys.forEach((m, mi) => {
    for (const [key, amt] of Object.entries(data.acctDetail[m] || {})) {
      const arr = detailRows.get(key) ?? new Array(monthKeys.length).fill(0);
      arr[mi] = amt;
      detailRows.set(key, arr);
    }
  });
  const sortedKeys = [...detailRows.keys()].sort((a, b) => {
    const [coA, acA] = a.split("|"); const [coB, acB] = b.split("|");
    const oi = COMPANY_ORDER.indexOf(coA) - COMPANY_ORDER.indexOf(coB);
    return oi !== 0 ? oi : acA.localeCompare(acB);
  });
  let dr = 5;
  let dz = false;
  for (const key of sortedKeys) {
    const [co, acct, cat] = key.split("|");
    const arr = detailRows.get(key)!;
    if (dz) for (let cc = 2; cc <= 2 + dHdr.length - 1; cc++) dt.getCell(dr, cc).fill = fillOf(C.zebra);
    dz = !dz;
    dt.getCell(dr, 2).value = co;
    dt.getCell(dr, 3).value = acct;
    dt.getCell(dr, 4).value = data.acctNames[acct] || "";
    dt.getCell(dr, 5).value = CAT_LABEL[cat] || cat;
    arr.forEach((v, i) => { const c = dt.getCell(dr, 6 + i); c.value = v; c.numFmt = EUR_FMT; });
    const tot = dt.getCell(dr, 6 + monthKeys.length);
    tot.value = Math.round(arr.reduce((s, v) => s + v, 0) * 100) / 100;
    tot.numFmt = EUR_FMT; tot.font = { bold: true };
    const link = dt.getCell(dr, 7 + monthKeys.length);
    link.value = { text: "Open in BC", hyperlink: glAccountLink(co, acct) };
    link.font = { color: { argb: "FF0563C1" }, underline: true, size: 9 };
    dr++;
  }
  dt.autoFilter = { from: { row: 4, column: 2 }, to: { row: dr - 1, column: 1 + dHdr.length } };
  dt.getColumn(2).width = 7; dt.getColumn(3).width = 10; dt.getColumn(4).width = 34; dt.getColumn(5).width = 15;
  for (let i = 0; i <= monthKeys.length; i++) dt.getColumn(6 + i).width = 13;
  dt.getColumn(7 + monthKeys.length).width = 11;

  // ---------- Leeswijzer & Mapping ----------
  const lw = wb.addWorksheet("Leeswijzer & Mapping", { views: [{ showGridLines: false }] });
  const lines: [string, boolean][] = [
    [`Overzicht uitgaven — Gheeraert Groep · periode ${fromISO} t/m ${toISO} · data live uit Business Central getrokken op ${stamp}.`, true],
    ["Wat telt mee: geboekte kosten excl. BTW op grootboekklasse 60–65 (debet − credit), boekingsdatum in de periode, alle operationele vennootschappen, incl. intercompany.", false],
    ["Uitgesloten (non-cash/resultaat): 609* voorraadwijzigingen, 630/631/634/638 afschrijvingen & voorzieningen, klasse 66–69, en 6212xx vakantiegeld-provisies.", false],
    ["BV° = credits op 453* (ingehouden bedrijfsvoorheffing) — memo: zit al in de bruto lonen en telt dus NIET mee in het totaal.", false],
    ["De laatste maand kan onvolledig zijn zolang de loonverwerking niet geboekt is (lonen van maand X worden begin maand X+1 geboekt).", false],
    ["Controle: blad Detail rekeningen telt per firma/categorie exact op tot de maandblokken — en linkt per rekening door naar de boekingen in BC.", false],
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
