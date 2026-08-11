// ============================================================
// BTW-positie van de groep — maandposities, YTD/YoY, voorfinanciering
// ============================================================
// Bron: ODataV4-webservice Btw_posten_Excel (de werkelijke btw-posten, per
// btw-aangifteperiode VAT_Reporting_Date) + GL 494000 "BTW R/C" voor de echte
// betalingen aan de overheid.
//
// Teken-conventie (gevalideerd op GTR juni 2026, probe 03/08/2026):
//   Type='Sale'     → Amount NEGATIEF  = verschuldigde btw op verkopen
//   Type='Purchase' → Amount POSITIEF  = aftrekbare btw op aankopen
//   maandsaldo (te betalen) = −Σ(Sale.Amount) − Σ(Purchase.Amount)
// GL 494000: memoriaal "BTW Centralisatie MM" (doc D…) verplaatst het maandsaldo
// naar de R/C; de bankbetaling (doc BNP-…/KBC-…) is de échte cash-out.
//
// BTW-eenheid: de ESCJ-velden (Pull_Date_To_VAT_Unit / ESCJ_Company) staan LEEG
// op de posten — de eenheids-consolidatie loopt dus niet via dit mechanisme.
// We rapporteren per vennootschap en groeperen zelf.

import type { CfoVat, VatMonthRow, CfoSource } from "./types";
import { getBCToken, fetchBCCompanies, fetchBCLedgerByAccounts } from "./bc-client";
import { fetchWithRetry } from "./http";
import { getCache, setCache } from "./sync-cache";

const ODATA_ROOT = `https://api.businesscentral.dynamics.com/v2.0/${process.env.BC_TENANT_ID}/${process.env.BC_ENVIRONMENT || "production"}`;

function isDemoMode(): boolean { return process.env.NEXT_PUBLIC_DEMO_MODE !== "false"; }
function isOperatingCompany(name: string): boolean { return !/^_/.test(name) && !/test|copie|fleetmate/i.test(name); }
const r0 = (n: number) => Math.round(n);

// Eigen groeps-btw-nummers (bc-research 20/07/2026) — genormaliseerd op 10 cijfers.
// Gebruikt om het intercompany-aandeel in de btw-basis te meten (tegenpartij-VAT).
const GROUP_VATS = new Set([
  "0415561460", "0422208336", "0757801909", "0429991201", "0741383767",
  "0740593713", "1033968530", "1032871836", "0649971363", "0630943032", "0418276074",
]);
function normVat(v: string): string {
  const digits = (v || "").replace(/\D/g, "");
  return digits.length === 9 ? `0${digits}` : digits;
}

const WINDOW_MONTHS = 19; // t/m 19 maanden terug → YoY op dezelfde kalendermaanden
function windowKeys(today: Date): string[] {
  const keys: string[] = [];
  for (let i = WINDOW_MONTHS - 1; i >= 0; i--) {
    keys.push(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  }
  return keys;
}

async function pageAll(url: string, token: string, cb: (row: Record<string, unknown>) => void): Promise<void> {
  let next: string | null = url; let page = 0;
  while (next && page < 800) {
    const res: Response = await fetchWithRetry(next, {
      headers: { Authorization: `Bearer ${token}`, "Data-Access-Intent": "ReadOnly", Accept: "application/json" },
    }, { timeoutMs: 90_000, maxAttempts: 3 });
    if (!res.ok) throw new Error(`BC ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const data: { value?: Record<string, unknown>[]; "@odata.nextLink"?: string } = await res.json();
    for (const v of data.value || []) cb(v);
    next = data["@odata.nextLink"] || null;
    page++;
  }
  if (next) throw new Error("BC-paging (btw): 800-paginalimiet bereikt, dataset onvolledig");
}

interface CompanyVatBundle {
  code: string;
  months: Record<string, { saleBase: number; saleVat: number; purchBase: number; purchVat: number; nonDed: number; icBase: number; allBase: number }>;
  paidByMonth: Record<string, number>; // 494000: bankbetalingen aan de overheid
  paidOk: boolean;                     // false = de 494000-pull mislukte (paid is dan onbekend, niet 0)
  builtAt?: string;                    // wanneer deze firmabundel echt uit BC getrokken is
}

async function buildCompanyVat(co: { id: string; code: string }, keys: string[], today: Date): Promise<CompanyVatBundle> {
  const cacheKey = `vat-co2-${co.code}-${keys[keys.length - 1]}`;
  const cached = getCache<CompanyVatBundle>(cacheKey);
  if (cached) return cached;

  const token = await getBCToken();
  const months: CompanyVatBundle["months"] = {};
  const m0 = () => ({ saleBase: 0, saleVat: 0, purchBase: 0, purchVat: 0, nonDed: 0, icBase: 0, allBase: 0 });
  const floor = `${keys[0]}-01`;
  const sel = "$select=VAT_Reporting_Date,Type,Base,Amount,NonDeductibleVATAmount,Enterprise_No";
  await pageAll(
    `${ODATA_ROOT}/ODataV4/Company('${encodeURIComponent(co.code)}')/Btw_posten_Excel?$filter=${encodeURIComponent(`VAT_Reporting_Date ge ${floor}`)}&${sel}`,
    token,
    (e) => {
      const k = String(e.VAT_Reporting_Date || "").slice(0, 7);
      if (!keys.includes(k)) return;
      const m = (months[k] = months[k] || m0());
      const base = (e.Base as number) || 0;
      const amt = (e.Amount as number) || 0;
      if (e.Type === "Sale") { m.saleBase += -base; m.saleVat += -amt; }
      else if (e.Type === "Purchase") { m.purchBase += base; m.purchVat += amt; m.nonDed += (e.NonDeductibleVATAmount as number) || 0; }
      const absBase = Math.abs(base);
      m.allBase += absBase;
      if (GROUP_VATS.has(normVat(String(e.Enterprise_No || "")))) m.icBase += absBase;
    }
  );

  // Echte betalingen: 494000-debets uit een bankdagboek (memoriaal-docs beginnen met "D").
  // Werkelijke betalingen aan de overheid. LET OP (audit 04/08/2026): een mislukte pull
  // mocht niet stil als "geen betalingen" gelden — dat zette `ytd.paid` te laag en ging
  // 12u de cache in. `paidOk` maakt het zichtbaar.
  const paidByMonth: Record<string, number> = {};
  let paidOk = true;
  try {
    const gl = await fetchBCLedgerByAccounts(co.id, floor, today.toISOString().slice(0, 10), ["494000"]);
    for (const g of gl) {
      const doc = String(g.documentNumber || "");
      const dt = String(g.documentType || "");
      // Memoriaal-centralisaties ("D01-26-0120 BTW Centralisatie") zijn geen cash.
      // Primair op documentType (Payment) wanneer BC dat vult; anders de D-heuristiek.
      const isPayment = dt === "Payment";
      if (!isPayment && /^D/i.test(doc)) continue;
      const k = String(g.postingDate || "").slice(0, 7);
      paidByMonth[k] = (paidByMonth[k] || 0) + (((g.debitAmount as number) || 0) - ((g.creditAmount as number) || 0));
    }
  } catch { paidOk = false; }

  const bundle: CompanyVatBundle = { code: co.code, months, paidByMonth, paidOk, builtAt: new Date().toISOString() };
  setCache(cacheKey, bundle, 720);
  return bundle;
}

function combineVat(bundles: CompanyVatBundle[], keys: string[], today: Date): CfoVat {
  const curYear = today.getUTCFullYear();
  const lastFull = new Date(Date.UTC(curYear, today.getUTCMonth(), 0)).toISOString().slice(0, 7); // vorige maand
  const rows: VatMonthRow[] = keys.map((k) => {
    let saleBase = 0, saleVat = 0, purchBase = 0, purchVat = 0, nonDed = 0;
    for (const b of bundles) {
      const m = b.months[k]; if (!m) continue;
      saleBase += m.saleBase; saleVat += m.saleVat; purchBase += m.purchBase; purchVat += m.purchVat; nonDed += m.nonDed;
    }
    return {
      month: k, saleBase: r0(saleBase), saleVat: r0(saleVat), purchBase: r0(purchBase), purchVat: r0(purchVat),
      net: r0(saleVat - purchVat), nonDeductible: r0(nonDed),
    };
  });

  // Rapportagejaar = het jaar van de laatste afgesloten aangiftemaand. In januari is
  // dat het VORIGE jaar; anders zou de YTD-tabel leeg zijn (curYear-maanden ≤ "vorig
  // jaar-12" bestaan niet) naast een volledige vorig-jaar-kolom. Audit 04/08/2026.
  const repYear = Number(lastFull.slice(0, 4));
  const ytdMonths = rows.filter((r) => r.month.startsWith(String(repYear)) && r.month <= lastFull);
  // YoY alleen op maanden die ÉCHT in het venster zitten: het venster is 19 maanden,
  // dus vanaf augustus valt januari van vorig jaar erbuiten. Vergelijk daarom alleen
  // de overlappende kalendermaanden en zeg welke dat zijn — anders leest een halve
  // vorig-jaar-periode als een daling van 50%.
  const pyYear = String(repYear - 1);
  const pyMonths = rows.filter((r) => r.month.startsWith(pyYear) && r.month.slice(5) <= lastFull.slice(5));
  const pyMonthNums = new Set(pyMonths.map((r) => r.month.slice(5)));
  const ytdMatched = ytdMonths.filter((r) => pyMonthNums.has(r.month.slice(5)));
  const paidYtd = bundles.reduce((s, b) =>
    s + Object.entries(b.paidByMonth).filter(([k]) => k.startsWith(String(repYear)) && k <= lastFull).reduce((x, [, v]) => x + v, 0), 0);
  const paidIncomplete = bundles.filter((b) => b.paidOk === false).map((b) => b.code);

  const perCompany = bundles.map((b) => {
    let net = 0, sale = 0, purch = 0;
    for (const [k, m] of Object.entries(b.months)) {
      if (!k.startsWith(String(repYear)) || k > lastFull) continue;
      net += m.saleVat - m.purchVat; sale += m.saleVat; purch += m.purchVat;
    }
    return { code: b.code, ytdNet: r0(net), ytdSaleVat: r0(sale), ytdPurchVat: r0(purch) };
  }).sort((a, b) => b.ytdNet - a.ytdNet);

  // IC-aandeel in de btw-basis (YTD): meet hoeveel van de btw-stroom intra-groep is —
  // relevant voor de vraag "wat zou een (actieve) btw-eenheid aan voorfinanciering schelen".
  let icBase = 0, allBase = 0;
  for (const b of bundles) for (const [k, m] of Object.entries(b.months)) {
    if (!k.startsWith(String(repYear)) || k > lastFull) continue;
    icBase += m.icBase; allBase += m.allBase;
  }

  const positives = rows.filter((r) => r.month <= lastFull).slice(-12).map((r) => r.net).filter((n) => n > 0);
  const recoverable = ytdMonths.filter((r) => r.net < 0).reduce((s, r) => s + -r.net, 0);

  const sources: CfoSource[] = [
    { label: "BTW-posten", detail: "Btw_posten_Excel per btw-aangifteperiode (VAT_Reporting_Date), alle vennootschappen. Verkoop-btw = verschuldigd, aankoop-btw = aftrekbaar; saldo per maand = verschuldigd − aftrekbaar (positief = te betalen)." },
    { label: "Betalingen aan de overheid", detail: "GL 494000 'BTW R/C', nettobeweging (debet − credit) van posten die als betaling gelden: documenttype 'Payment', of — waar BC dat type niet vult — elk document dat NIET met 'D' begint (de 'BTW Centralisatie'-memorialen doen dat wél). Het grootboek-endpoint geeft geen dagboekcode terug, dus dit is een documentregel-benadering en geen echte dagboekfilter." },
    { label: "IC-aandeel", detail: "Aandeel van de btw-maatstaf (|Base|) waarvan de tegenpartij een eigen groeps-btw-nummer draagt (Enterprise_No-match op de 11 gekende nummers)." },
  ];
  const notes: string[] = [
    `Laatste volledige aangiftemaand: ${lastFull}. De lopende maand staat wel in de grafiek maar is onvolledig.`,
    `Vergelijking met vorig jaar gebeurt op exact dezelfde kalendermaanden (${pyMonths.map((r) => r.month.slice(5)).sort().join("+") || "geen"}): het datavenster is 19 maanden, dus vroege maanden van vorig jaar vallen er later in het jaar buiten. Zonder die beperking zou een halve vorig-jaar-periode als een daling lezen.`,
    ...(paidIncomplete.length ? [`LET OP: de betalingsgegevens (GL 494000) konden niet opgehaald worden voor ${paidIncomplete.join(", ")} — "betaald YTD" is daardoor onvolledig, niet nul.`] : []),
    "'Verschuldigd YTD' loopt t/m de laatste afgesloten aangiftemaand; 'betaald YTD' is de cash die in datzelfde tijdvak wegging. Een aangifte wordt de maand ná de periode betaald, dus de twee lopen structureel één periode uit fase — vergelijk ze niet als saldo.",
    "De ESCJ-btw-eenheid-velden (pull naar eenheid) staan leeg op de posten — consolidatie/aangifte lijkt per vennootschap te lopen. Bevestigen met finance hoe de btw-eenheid in de praktijk afrekent.",
    "Niet-aftrekbare btw zit als kost in de P&L (rekening 640200 e.a.) en niet in het saldo hier.",
  ];

  return {
    // Oudste firmabundel-stempel, niet het combineermoment — anders lijkt 12u oude
    // cache vers (zelfde fix als units.ts, audit 11/08/2026).
    asOf: bundles.reduce<string | null>((m, b) => (b.builtAt && (!m || b.builtAt < m) ? b.builtAt : m), null) || new Date().toISOString(),
    isLive: true,
    months: rows,
    ytd: { net: r0(ytdMonths.reduce((s, r) => s + r.net, 0)), paid: r0(paidYtd), recoverable: r0(recoverable), year: repYear },
    // YoY op exact dezelfde kalendermaanden aan beide kanten (zie pyMonths hierboven).
    prevYtd: {
      net: r0(pyMonths.reduce((s, r) => s + r.net, 0)), year: repYear - 1,
      matchedNet: r0(ytdMatched.reduce((s, r) => s + r.net, 0)),
      monthsCompared: pyMonths.map((r) => r.month.slice(5)).sort().join("+"),
    },
    perCompany,
    icVat: {
      basePct: allBase ? Math.round((icBase / allBase) * 1000) / 10 : 0,
      note: "van de btw-maatstaf YTD heeft een groepsfirma als tegenpartij",
    },
    vatUnit: { active: false, note: "Eenheids-pull (ESCJ) niet in gebruik op de posten — rapportage per vennootschap." },
    prefinance: {
      avgMonthlyNet: r0(positives.length ? positives.reduce((s, x) => s + x, 0) / positives.length : 0),
      note: "gemiddelde van de te-betalen-maanden (laatste 12 volledige)",
    },
    sources, notes,
  };
}

const inflight = new Map<string, Promise<CfoVat>>();

async function buildLiveVat(cacheKey: string, exclude: string[]): Promise<CfoVat> {
  const today = new Date();
  const keys = windowKeys(today);
  const raw = await fetchBCCompanies();
  const companies = raw
    .map((c) => ({ id: String(c.id), code: String(c.name) }))
    .filter((c) => isOperatingCompany(c.code) && !exclude.includes(c.code));
  const bundles: CompanyVatBundle[] = [];
  for (let i = 0; i < companies.length; i += 3) {
    const part = await Promise.all(companies.slice(i, i + 3).map((c) => buildCompanyVat(c, keys, today)));
    bundles.push(...part);
  }
  const result = combineVat(bundles, keys, today);

  // Live-check btw-eenheid: zodra finance de VAT-Group-module activeert, verschijnen
  // hier submissions en kantelt de status vanzelf.
  try {
    const token = await getBCToken();
    let submissions = 0;
    for (const c of companies.slice(0, 3)) {
      const res = await fetchWithRetry(
        `${ODATA_ROOT}/api/microsoft/vatGroup/v1.0/companies(${c.id})/vatGroupSubmissions`,
        { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
        { timeoutMs: 30_000, maxAttempts: 1 }
      );
      if (res.ok) submissions += (((await res.json()) as { value?: unknown[] }).value || []).length;
    }
    result.vatUnit = submissions > 0
      ? { active: true, note: `BC VAT-Group-module actief (${submissions} submission(s) gevonden).` }
      : { active: false, note: "BC VAT-Group-module aanwezig maar zonder submissions — aangifte loopt per vennootschap (live gecheckt)." };
  } catch { /* check optioneel */ }

  setCache(cacheKey, result, 720);
  return result;
}

export interface VatState { building?: boolean }

export async function getVat(
  force = false, exclude: string[] = []
): Promise<CfoVat | (VatState & { isLive: boolean })> {
  if (isDemoMode()) return demoVat();
  const excl = [...new Set(exclude.map((x) => x.trim().toUpperCase()).filter(Boolean))].sort();
  const cacheKey = `vat-v2-x:${excl.join(",")}`;
  const cached = getCache<CfoVat>(cacheKey);
  if (cached && !force) return cached;

  if (!inflight.has(cacheKey)) {
    const p = buildLiveVat(cacheKey, excl).finally(() => inflight.delete(cacheKey));
    inflight.set(cacheKey, p);
    p.catch((e) => console.error("vat build failed:", e));
  }
  if (cached) return { ...cached, refreshing: true };
  const winner = await Promise.race([
    inflight.get(cacheKey)!.then((r) => ({ done: r })),
    new Promise<{ done: null }>((res) => setTimeout(() => res({ done: null }), 20_000)),
  ]);
  if (winner.done) return winner.done;
  return { building: true, isLive: true };
}

function demoVat(): CfoVat {
  const today = new Date();
  const keys = windowKeys(today);
  const curYear = today.getUTCFullYear();
  const months: VatMonthRow[] = keys.map((k, i) => {
    const saleVat = r0(1_050_000 + 130_000 * Math.sin(i / 2));
    const purchVat = r0(980_000 + 160_000 * Math.sin(i / 2 + 1.4));
    return {
      month: k, saleBase: saleVat * 5, saleVat, purchBase: purchVat * 5, purchVat,
      net: saleVat - purchVat, nonDeductible: 12_000,
    };
  });
  const ytdRows = months.filter((m) => m.month.startsWith(String(curYear))).slice(0, -1);
  return {
    asOf: new Date(0).toISOString(), isLive: false, months,
    ytd: {
      net: r0(ytdRows.reduce((s, m) => s + m.net, 0)),
      paid: 410_000, recoverable: r0(ytdRows.filter((m) => m.net < 0).reduce((s, m) => s + -m.net, 0)), year: curYear,
    },
    prevYtd: { net: 236_000, year: curYear - 1 },
    perCompany: [
      { code: "GDI", ytdNet: 118_000, ytdSaleVat: 2_890_000, ytdPurchVat: 2_772_000 },
      { code: "GTR", ytdNet: 64_000, ytdSaleVat: 1_598_000, ytdPurchVat: 1_534_000 },
      { code: "WHS", ytdNet: 41_000, ytdSaleVat: 830_000, ytdPurchVat: 789_000 },
      { code: "TDR", ytdNet: -22_000, ytdSaleVat: 410_000, ytdPurchVat: 432_000 },
    ],
    icVat: { basePct: 18.4, note: "van de btw-maatstaf YTD heeft een groepsfirma als tegenpartij" },
    vatUnit: { active: false, note: "Demomodus." },
    prefinance: { avgMonthlyNet: 96_000, note: "gemiddelde van de te-betalen-maanden (laatste 12 volledige)" },
    sources: [{ label: "BTW-posten", detail: "Demomodus — live komt dit uit Btw_posten_Excel + GL 494000." }],
    notes: ["Voorbeelddata (demomodus)."],
  };
}
