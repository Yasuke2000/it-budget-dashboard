// ============================================================
// Cashflowprognose — 13-weken direct + maandlaag tot eind volgend jaar + 6 mnd
// ============================================================
// Meeting 17/08/2026 + best-practice-research (13WCF):
//  - BASELINE ZONDER FACTORING: open klantenposten op betaalgedrag-per-klant
//    (niet op vervaldag — grootste accuraatheidswinst), creditnota's GESALDEERD.
//  - LAAG MET FACTORING ernaast (side-by-side): bij factoring-klanten is ±85%
//    al voorgeschoten (lump sum op de 433-rekening), dus daar telt alleen het
//    15%-saldo nog als komende kasontvangst.
//  - Uitstromen: open leveranciersposten op vervaldag + de grote Belgische
//    kalenderposten (lonen/RSZ ~maandeinde, btw ~20e, leasing).
//  - Maandlaag: seizoenspatroon uit de échte bankmutaties (13 mnd historiek) —
//    RICHTINGGEVEND, geen budget. Beslissing David 18/08: OOK de lange-termijnlaag
//    leeft hier — niets blijft bij EMAsphere.
//  - 433-saldi en niet-toegewezen betalingen apart zichtbaar (de "zak met geld").
// Anker: het saldo start op de ECHTE bankstand van vandaag (cashOwn, excl.
// factorkrediet) — nooit een geprojecteerd saldo doorschuiven (forecast drift).
// Open afhankelijkheden (fase 2): E-trans opmaakdatums, CODA-dagreconciliatie,
// factorportaal-rapporten. Zie mails/2026-08-17-antwoorden-cost-of-cash.md.

import type { CfoSource, CfoReceivables } from "./types";
import { fetchBCCompanies, getBCToken } from "./bc-client";
import { ODATA_ROOT, API_ROOT, pageAllOData, makePolledGetter, isOperatingCompany } from "./bc-odata";
import { fetchWithRetry } from "./http";
import { getCache, setCache } from "./sync-cache";
import { getReceivables } from "./receivables";
import { getBank, type CfoBank } from "./bank";
import { getMgmtPnl, type CfoMgmtPnl } from "./mgmt-pnl";
import { isIcName } from "./cfo";
import { vendorLedgerDocLink, custLedgerDocLink } from "./bc-links";
import { isApUitzondering, AP_UITZONDERINGEN } from "./ap-uitzonderingen";

const r0 = (n: number) => Math.round(n);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
function mondayOf(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const wd = (x.getUTCDay() + 6) % 7;
  return addDays(x, -wd);
}
// Echt ISO-weeknummer (vraag David 19/08: "gebruik bij alles de correcte weken") —
// labels tonen de kalenderweek (wk 34, 35, …) i.p.v. een telnummer vanaf 1.
function isoWeekNum(d: Date): number {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7) + 3); // donderdag van de week
  const jan4 = new Date(Date.UTC(x.getUTCFullYear(), 0, 4));
  jan4.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + 3);
  return 1 + Math.round((x.getTime() - jan4.getTime()) / (7 * 86400000));
}

export interface FcWeek {
  weekStart: string; label: string;
  inNoFactor: number;   // afwikkeling bestaande posten, CN gesaldeerd, 100% (baseline)
  inWithFactor: number; // idem, maar factoring-klanten alleen 15%-saldo
  // Run-rate-laag (v6): de prognose zonder nieuwe facturatie/inkopen was een
  // "we stoppen vandaag"-worstcase — de met-factoringlijn dook daardoor naar −8M
  // (melding David 18/08). Nieuwe facturatie op het weekritme van de laatste 12
  // volle weken; nieuwe inkopen op het ritme van de leveranciersfacturen.
  inNewNoFactor: number;   // inning van ná vandaag uitgereikte facturen (100% op betaalgedrag)
  inNewWithFactor: number; // idem met factoring: 85% ~1 week na uitreiking + 15% op betaalgedrag
  outNew: number;          // betaling van ná vandaag ontvangen inkoopfacturen (~30d)
  outAP: number;        // bestaande leveranciersposten op vervaldag (CN gesaldeerd)
  outFixed: number;     // lonen/RSZ + btw + leasing (kalenderregels)
  netNoFactor: number; netWithFactor: number;
  cumNoFactor: number; cumWithFactor: number; // cumulatief saldo vanaf bankstand nu
  // Hybride (audit 18/08): wk 1–6 = individuele posten + kalender (scherp,
  // doorklikbaar); wk 7–13 = bankseizoensritme (geijkt op 13 mnd echte mutaties).
  basis: "posten" | "seizoen";
  // "Lasten van het verleden" (vraag David 19/08): het deel van in/uit dat uit
  // ACHTERSTAL komt — oude AR-inhaal (incl. de niet-toegewezen-saldering) en
  // achterstallige AP, beide 1/6 gespreid over wk 1–6. De view kan hiermee een
  // prognose op het zuivere day-to-day-ritme tonen: in − inOld, outAP − outOldAP.
  inOldNoFactor: number;
  inOldWithFactor: number;
  outOldAP: number;
}
export interface FcMonth {
  month: string;          // "2026-09"
  inSeason: number; outSeason: number; net: number; cum: number;
  isActual: boolean;      // true = historische maand (echte bankmutaties)
}
export interface FcDetailRow {
  week: number;           // 0-based weekindex; 13 = "ná week 13"
  co: string; party: string; doc: string;
  amount: number;         // in: te ontvangen (+), CN (−) · uit: te betalen (+)
  when: string;           // verwacht betaalmoment (in) of vervaldag (uit)
  factored?: boolean;     // in: factoring-klant (85% al voorgeschoten)
  spread: boolean;        // achterstallig → 1/6 per week over wk 1–6
  bcUrl: string;
}
export interface FcCompanyMisc {
  company: string;
  saldo433: number;       // rekening-courant factor (lump-sum "zak met geld")
  btwSaldo: number;       // 451-range: te betalen btw
  unappliedPayments: number; unappliedCount: number; // open betalingen/bankontvangsten zonder factuur (incl. blanco documenttype)
  openCn: number;         // open creditnota's
  saldoKrediet: number;   // 43x excl. 433: straight loans/opticash e.d. (schuld = negatief)
  // Detail HOORT in de gecachete rij: buiten de cache verzameld gaf hij een lege
  // lijst zodra de firma-cache warm was (bug 18/08 — "detail: 0 posten").
  topUnapplied?: { party: string; doc: string; type: string; amount: number }[];
  degraded?: boolean;     // trialBalances faalde → 433/451 onbekend (niet 0!)
}
export interface CfoCashForecast {
  asOf: string; isLive: boolean;
  bankNow: number;        // eigen bankstand (excl. factorkrediet)
  factorCredit: number;   // opgenomen factorvoorschot (schuld, geen cash)
  weeks: FcWeek[];        // 13 weken
  beyond13w: { inNoFactor: number; inWithFactor: number }; // AR verwacht ná week 13
  // Totalen van de "lasten van het verleden" (vraag David 19/08): wat er in
  // wk 1–6 aan achterstal-inhaal zit. inAR = verwachte inning uit oude klant-
  // posten (bruto, vóór de niet-toegewezen-saldering; factor-variant ernaast),
  // uitAP = achterstallige leveranciersposten. De zonder-verleden-weergave
  // haalt dit (plus de niet-toegewezen-correctie) uit het weekprofiel.
  verleden: { inAR: number; inARFactor: number; uitAP: number };
  months: FcMonth[];      // historiek + projectie tot eind volgend jaar + 6 mnd
  lowPoint: { noFactor: { week: string; value: number }; withFactor: { week: string; value: number } };
  negativeWeeks: { noFactor: string[]; withFactor: string[] };
  perCompany: FcCompanyMisc[];
  weekDetail: { in: FcDetailRow[]; out: FcDetailRow[] }; // top 15 per week, met BC-link
  // De grootste niet-toegewezen ontvangsten (de −€1,6M-correctie), met BC-link
  // per post — vraag David 18/08 ("geef me een linkje").
  unappliedDetail: { co: string; party: string; doc: string; type: string; amount: number; bcUrl: string }[];
  totals: { unapplied: number; unappliedCount: number; saldo433: number; btw: number; btwUnclear: number; saldoKrediet: number; payrollMonthly: number; leasingMonthly: number };
  aannames: string[];
  sources: CfoSource[]; notes: string[];
  refreshing?: boolean;
}

/** Poll een polled getter tot er echte data is (builds kunnen minuten duren). */
async function waitFor<T>(get: () => Promise<T | { building: true }>, maxMinutes = 25): Promise<T> {
  const deadline = Date.now() + maxMinutes * 60_000;
  for (;;) {
    const r = await get();
    if (!(typeof r === "object" && r !== null && "building" in r && (r as { building?: boolean }).building)) return r as T;
    if (Date.now() > deadline) throw new Error("onderliggende dataset bleef bouwen (timeout)");
    await new Promise((res) => setTimeout(res, 10_000));
  }
}

// trialBalances: saldo per rekening op datum — goedkoopste weg naar 433/451-saldi.
async function fetchAccountBalances(companyId: string, dateIso: string, token: string): Promise<{ no: string; amount: number }[]> {
  const url = `${API_ROOT}/companies(${companyId})/trialBalances?$filter=${encodeURIComponent(`dateFilter eq ${dateIso}`)}`;
  const res = await fetchWithRetry(url, {
    headers: { Authorization: `Bearer ${token}`, "Data-Access-Intent": "ReadOnly", Accept: "application/json" },
  }, { timeoutMs: 90_000, maxAttempts: 2 });
  if (!res.ok) throw new Error(`trialBalances ${res.status}`);
  const j: { value?: Record<string, unknown>[] } = await res.json();
  // Zelfde strikte parser als balance-full.ts: BC levert strings met
  // duizendscheiding ("1,089,138.27"); bij onverwacht formaat liever gooien.
  const num = (s: unknown): number => {
    if (typeof s === "number") return Number.isFinite(s) ? s : 0;
    const raw = String(s ?? "").trim();
    if (!raw) return 0;
    if (!/^-?[\d,]*\.?\d*$/.test(raw)) throw new Error(`trialBalances: onverwacht getalformaat "${raw}"`);
    const v = parseFloat(raw.replace(/,/g, ""));
    return Number.isFinite(v) ? v : 0;
  };
  const out: { no: string; amount: number }[] = [];
  for (const row of j.value || []) {
    if (String(row.accountType) !== "Posting") continue;
    const no = String(row.number || "");
    const bal = num(row.balanceAtDateDebit) - num(row.balanceAtDateCredit); // debet-positief
    if (no && Math.abs(bal) >= 0.005) out.push({ no, amount: bal });
  }
  return out;
}

async function buildCashForecast(exclude: string[]): Promise<CfoCashForecast> {
  const today = new Date();
  const todayIso = iso(today);
  const w0 = mondayOf(today);
  const token = await getBCToken();
  const companies = (await fetchBCCompanies())
    .filter((c) => isOperatingCompany(String(c.name)))
    .map((c) => ({ id: String(c.id), code: String(c.name) }))
    .filter((c) => !exclude.includes(c.code.toUpperCase()));

  // ---- 1. Onderliggende datasets (delen dezelfde bron van waarheid) ----
  const rcv = await waitFor<CfoReceivables>(() => getReceivables(false, exclude) as Promise<CfoReceivables | { building: true }>);
  const bank = await waitFor<CfoBank>(() => getBank(false, exclude) as Promise<CfoBank | { building: true }>);

  // Omzetgroeifactor (vraag David 18/08: "vergelijk met vorig jaar, volg dezelfde
  // trends, op basis van jaaromzet"): het seizoensritme is "zelfde maand vorig
  // jaar" uit de bankmutaties; die schalen we met de omzettrend uit de eigen
  // Management-P&L (omzet YTD dit jaar / dezelfde maanden vorig jaar, volle
  // maanden). Begrensd op 0,8–1,25: een groeifactor is een trend, geen hefboom.
  let groei = 1;
  try {
    const y = today.getUTCFullYear();
    const pnlNow = await waitFor<CfoMgmtPnl>(() => getMgmtPnl(false, exclude, `${y}|ALL`) as Promise<CfoMgmtPnl | { building: true }>, 20);
    const pnlPrev = await waitFor<CfoMgmtPnl>(() => getMgmtPnl(false, exclude, `${y - 1}|ALL`) as Promise<CfoMgmtPnl | { building: true }>, 20);
    const lastFull = today.getUTCMonth(); // aantal volle maanden (0-based huidige maand)
    const som = (p: CfoMgmtPnl) => (p.rows.find((r) => r.id === "omzet")?.monthly || []).slice(0, lastFull).reduce((a, b) => a + b, 0);
    const nu = som(pnlNow), vorig = som(pnlPrev);
    if (vorig > 1_000_000 && nu > 0) groei = Math.min(1.25, Math.max(0.8, nu / vorig));
  } catch { /* P&L niet beschikbaar → groei 1 (puur vorig-jaar-ritme) */ }

  // ---- 2. Weekraster (13 weken, ma–zo; labels = échte ISO-weeknummers) ----
  const weeks: FcWeek[] = Array.from({ length: 13 }, (_, i) => ({
    weekStart: iso(addDays(w0, i * 7)), label: `wk ${isoWeekNum(addDays(w0, i * 7))}`,
    inNoFactor: 0, inWithFactor: 0, inNewNoFactor: 0, inNewWithFactor: 0, outNew: 0,
    outAP: 0, outFixed: 0,
    netNoFactor: 0, netWithFactor: 0, cumNoFactor: 0, cumWithFactor: 0,
    basis: "posten" as const,
    inOldNoFactor: 0, inOldWithFactor: 0, outOldAP: 0,
  }));
  const weekOf = (dateIso: string): number => {
    const wi = Math.floor((Date.parse(`${dateIso}T00:00:00Z`) - w0.getTime()) / (7 * 86400000));
    return wi < 0 ? 0 : wi;
  };

  // Instromen uit de receivables-motor (betaalgedrag per klant, CN gesaldeerd).
  // spreadNet/spreadFactor = het achterstal-deel (inhaal op oude posten) —
  // apart bijgehouden zodat de view het "verleden" kan scheiden van het ritme.
  rcv.cashExpectation.forEach((w, i) => {
    if (i < 13) {
      weeks[i].inNoFactor = w.expectedNet || 0; weeks[i].inWithFactor = w.expectedFactor || 0;
      weeks[i].inOldNoFactor = w.spreadNet || 0; weeks[i].inOldWithFactor = w.spreadFactor || 0;
    }
  });
  const beyond13w = {
    inNoFactor: rcv.forecastBeyond?.net || 0,
    inWithFactor: rcv.forecastBeyond?.factor || 0,
  };

  // ---- 3. Uitstromen: open leveranciersposten op vervaldag (CN gesaldeerd) ----
  // IC uitgesloten: intern betalen is geen netto groepskasstroom.
  let apBeyond = 0;
  const outDetail: FcDetailRow[] = [];
  for (const c of companies) {
    const url = `${ODATA_ROOT}/ODataV4/Company('${encodeURIComponent(c.code)}')/VendorLedgerEntries?$filter=Open eq true&$select=Vendor_Name,Document_No,Due_Date,Document_Date,Remaining_Amt_LCY`;
    await pageAllOData(url, (e) => {
      const rem = -((e.Remaining_Amt_LCY as number) || 0); // te betalen = positief
      if (Math.abs(rem) < 1) return;
      if (isIcName(String(e.Vendor_Name || ""))) return;
      // Apart gezette posten worden géén cash-out (bv. ES Finance-aktefactuur
      // €1,93M — al in de P&L, verrekend via de akte). Zie lib/ap-uitzonderingen.
      if (isApUitzondering(c.code, String(e.Document_No || ""))) return;
      const due = String(e.Due_Date || "").slice(0, 10);
      const doc = String(e.Document_Date || "").slice(0, 10);
      const when = (due && !due.startsWith("0001") ? due : doc) || todayIso;
      let week: number;
      if (when < todayIso) {
        // Achterstallige leveranciers betalen we niet allemaal deze week —
        // inhaalritme gespreid over week 1–6 (eigen keuze, zelfde spreiding als AR).
        // Ook apart geteld als "verleden" (outOldAP) voor de day-to-day-weergave.
        for (let k = 0; k < 6; k++) { weeks[k].outAP += rem / 6; weeks[k].outOldAP += rem / 6; }
        week = 0;
      } else {
        const wi = weekOf(when);
        if (wi < 13) { weeks[wi].outAP += rem; week = wi; } else { apBeyond += rem; week = 13; }
      }
      outDetail.push({
        week, co: c.code, party: String(e.Vendor_Name || "").trim(), doc: String(e.Document_No || ""),
        amount: r0(rem), when, spread: when < todayIso,
        bcUrl: vendorLedgerDocLink(c.code, String(e.Document_No || "")),
      });
    }, token);
  }
  // Payload-cap: per week de 15 grootste posten.
  const capPerWeek = (rows: FcDetailRow[]): FcDetailRow[] => {
    const byWeek = new Map<number, FcDetailRow[]>();
    for (const r of rows) { const a = byWeek.get(r.week) ?? []; a.push(r); byWeek.set(r.week, a); }
    const out: FcDetailRow[] = [];
    for (const a of byWeek.values()) { a.sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount)); out.push(...a.slice(0, 15)); }
    return out;
  };

  // ---- 4. Kalenderposten: lonen/RSZ (62-range, gem. laatste 3 volle maanden) ----
  const m0 = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 3, 1));
  const m0Iso = iso(m0);
  const lastFullEnd = iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0)));
  let payroll3m = 0;
  for (const c of companies) {
    const key = `cf-payroll2-${c.code}-${m0Iso}`;
    const cached = getCache<number>(key);
    if (cached != null) { payroll3m += cached; continue; }
    let sum = 0;
    const filt = encodeURIComponent(`Posting_Date ge ${m0Iso} and Posting_Date le ${lastFullEnd} and G_L_Account_No ge '620000' and G_L_Account_No le '629999'`);
    // Provisieboekingen (vakantiegeld/13e mnd, ±4,4% — audit 18/08) zijn geen
    // maandelijkse cash-out: eruit voor het kasritme.
    const PROV_RX = /provisie|voorziening|overdracht vakantiegeld|vakantiegeld/i;
    await pageAllOData(`${ODATA_ROOT}/ODataV4/Company('${encodeURIComponent(c.code)}')/Grootboekposten_Excel?$filter=${filt}&$select=Amount,Description`, (e) => {
      if (PROV_RX.test(String(e.Description || ""))) return;
      sum += (e.Amount as number) || 0;
    }, token);
    setCache(key, sum, 720);
    payroll3m += sum;
  }
  const payrollMonthly = Math.max(0, payroll3m / 3);

  // ---- 5. 433/451-saldi + niet-toegewezen betalingen per firma ----
  const perCompany: FcCompanyMisc[] = [];
  
  for (const c of companies) {
    const key = `cf-misc4-${c.code}-${todayIso}`;
    const cached = getCache<FcCompanyMisc>(key);
    if (cached) { perCompany.push(cached); continue; }
    const row: FcCompanyMisc = { company: c.code, saldo433: 0, btwSaldo: 0, unappliedPayments: 0, unappliedCount: 0, openCn: 0, saldoKrediet: 0, topUnapplied: [] };
    try {
      for (const b of await fetchAccountBalances(c.id, todayIso, token)) {
        if (b.no.startsWith("433")) row.saldo433 += b.amount;
        else if (b.no.startsWith("43")) row.saldoKrediet += b.amount; // straight loans/opticash/vak.geld-krediet
        if (b.no.startsWith("451")) row.btwSaldo += b.amount;
      }
    } catch {
      // Audit 18/08: NIET stil op 0 laten staan — dat zette de wat-als-lijn €4,6M
      // te hoog en schrapte de btw-post, 12h gecachet. Vlag + niet cachen.
      row.degraded = true;
    }
    // Audit 18/08: ALLE open niet-factuurposten meenemen, ook het blanco
    // documenttype (bankontvangst-documenten op de klantrekening, ±€975k) —
    // het filter op alleen Payment/Credit Memo miste die en de "niet-toegewezen"
    // KPI stond daardoor €975k te laag.
    const filt = encodeURIComponent(`Open eq true and Document_Type ne 'Invoice'`);
    await pageAllOData(`${ODATA_ROOT}/ODataV4/Company('${encodeURIComponent(c.code)}')/Cust_LedgerEntries?$filter=${filt}&$select=Document_Type,Document_No,Remaining_Amt_LCY,Customer_Name`, (e) => {
      const rem = (e.Remaining_Amt_LCY as number) || 0;
      if (Math.abs(rem) < 1 || isIcName(String(e.Customer_Name || ""))) return;
      if (e.Document_Type === "Credit Memo") row.openCn += rem;
      else {
        row.unappliedPayments += rem; row.unappliedCount++;
        row.topUnapplied!.push({
          party: String(e.Customer_Name || "").trim(), doc: String(e.Document_No || ""),
          type: String(e.Document_Type || "").trim() || "bankontvangst", amount: r0(rem),
        });
      }
    }, token);
    row.saldo433 = r0(row.saldo433); row.btwSaldo = r0(row.btwSaldo); row.saldoKrediet = r0(row.saldoKrediet);
    row.unappliedPayments = r0(row.unappliedPayments); row.openCn = r0(row.openCn);
    row.topUnapplied = (row.topUnapplied || []).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 15);
    if (!row.degraded) setCache(key, row, 720);
    perCompany.push(row);
  }
  perCompany.sort((a, b) => Math.abs(b.saldo433) - Math.abs(a.saldo433));
  // 451 = creditsaldo → te betalen. Saldi boven €1M ogen OPGESTAPELD (WHS −2,5M,
  // TDR −619k bij de eerste run — vermoedelijk regime-effect btw-provisierekening
  // 1/5/2026, [PRIO]-vraag bij finance): die horen niet als één klap op de
  // eerstvolgende 20e in het weekprofiel — timing onbekend, apart gerapporteerd.
  const BTW_CLEAR_MAX = 1_000_000;
  let btwPayable = 0, btwUnclear = 0;
  for (const x of perCompany) {
    const owed = Math.max(0, -x.btwSaldo);
    if (owed <= BTW_CLEAR_MAX) btwPayable += owed; else btwUnclear += owed;
  }

  // Audit 18/08 (HIGH, geverifieerd tot op de euro): de niet-toegewezen
  // ontvangsten (open betalingen + blanco-documenttype bankontvangsten, ±−€1,6M)
  // staan al ín bankNow, maar hun facturen worden hierboven nog aan 100% als
  // toekomstige instroom geteld — dubbeltelling. Correctie: salderen in de
  // instroom, gespreid over week 1–6 (zoals achterstallige posten). In de
  // kasrealiteit is dit licht conservatief: een factuur van een factoring-klant
  // telde maar aan 15%, de correctie telt aan 100%.
  const unappliedNet = perCompany.reduce((s, x) => s + x.unappliedPayments, 0); // negatief
  for (let k = 0; k < 6; k++) {
    weeks[k].inNoFactor += unappliedNet / 6;
    weeks[k].inWithFactor += unappliedNet / 6;
    // Hoort bij het "verleden": deze ontvangsten corrigeren oude, nog niet
    // afgepunte posten. Zonder-verleden-weergave haalt beide samen weg.
    weeks[k].inOldNoFactor += unappliedNet / 6;
    weeks[k].inOldWithFactor += unappliedNet / 6;
  }

  // ---- 6. Leasing: gemiddelde maandelijkse externe cash-out (12m) ----
  let leasingMonthly = 0;
  try {
    const { buildLeasing } = await import("./leasing");
    const from = iso(new Date(Date.UTC(today.getUTCFullYear() - 1, today.getUTCMonth(), 1)));
    const lease = await buildLeasing(exclude, from, lastFullEnd);
    const n = Math.max(1, lease.monthly.length);
    leasingMonthly = lease.totals.extern / n;
  } catch { /* leasing-config uit → 0 */ }

  // Kalenderregels in het weekraster: lonen/RSZ op maandeinde, leasing begin
  // maand (maandelijks terugkerend); btw ÉÉN keer op de eerstvolgende 20e —
  // het 451-saldo is de schuld volgens het grootboek, latere aangiftes zijn
  // niet geraamd (bewust: WHS/TDR-saldi zien er opgestapeld uit → PRIO-vraag).
  const horizonEnd = addDays(w0, 13 * 7);
  let btwPlaced = false;
  for (let m = 0; m < 5; m++) {
    const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1 + m, 0));
    const btw20 = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + m, 20));
    const lease5 = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + m, 5));
    for (const [d, amt] of [[monthEnd, payrollMonthly], [lease5, leasingMonthly]] as [Date, number][]) {
      if (d <= today || d >= horizonEnd || amt <= 0) continue;
      weeks[weekOf(iso(d))].outFixed += amt;
    }
    if (!btwPlaced && btw20 > today && btw20 < horizonEnd && btwPayable > 0) {
      weeks[weekOf(iso(btw20))].outFixed += btwPayable;
      btwPlaced = true;
    }
  }

  // ---- 6b. Run-rate-laag: nieuwe facturatie & nieuwe inkopen ----
  // Facturatieritme: gemiddelde van de laatste 12 VOLLE weken (weekFlow is
  // oplopend; de laatste index is de lopende, onvolledige week — overslaan).
  const wf = (rcv.weekFlow || []).slice(0, -1).slice(-12);
  const avgFact = wf.length ? wf.reduce((s, x) => s + x.factored, 0) / wf.length : 0;
  const avgOther = wf.length ? wf.reduce((s, x) => s + x.other, 0) / wf.length : 0;
  const behaveWeeks = Math.min(10, Math.max(2, Math.round((rcv.dsoInvoiceLevel?.medianDays ?? 45) / 7)));
  const ADV_LAG_WEEKS = 1; // uitreiking → 85%-voorschot via E-trans/factor (aanname)
  // Inkoopritme: nieuwe externe leveranciersfacturen (netto CN) van de laatste
  // 12 weken; leasing eruit (zit al als kalenderpost, anders dubbel geteld).
  let newAp12w = 0;
  const apFrom = iso(addDays(new Date(`${todayIso}T00:00:00Z`), -84));
  for (const c of companies) {
    const key = `cf-aprate1-${c.code}-${apFrom}`;
    const cached = getCache<number>(key);
    if (cached != null) { newAp12w += cached; continue; }
    let sum = 0;
    const filt = encodeURIComponent(`Posting_Date ge ${apFrom} and (Document_Type eq 'Invoice' or Document_Type eq 'Credit Memo')`);
    await pageAllOData(`${ODATA_ROOT}/ODataV4/Company('${encodeURIComponent(c.code)}')/VendorLedgerEntries?$filter=${filt}&$select=Vendor_Name,Amount_LCY`, (e) => {
      if (isIcName(String(e.Vendor_Name || ""))) return;
      sum += -((e.Amount_LCY as number) || 0); // factuur = credit → kost positief
    }, token);
    setCache(key, sum, 720);
    newAp12w += sum;
  }
  const avgNewAp = Math.max(0, newAp12w / 12 - (leasingMonthly * 12) / 52);
  for (let w = 0; w < 13; w++) {
    const landBehave = w + behaveWeeks;   // inning op betaalgedrag
    const landAdv = w + ADV_LAG_WEEKS;    // 85%-voorschot
    const landAp = w + 4;                  // inkoop ~30 dagen betaaltermijn
    if (landBehave < 13) {
      weeks[landBehave].inNewNoFactor += avgFact + avgOther;
      weeks[landBehave].inNewWithFactor += avgFact * 0.15 + avgOther;
    }
    if (landAdv < 13) weeks[landAdv].inNewWithFactor += avgFact * 0.85;
    if (landAp < 13) weeks[landAp].outNew += avgNewAp;
  }

  // ---- 6c. Bankseizoen (nodig voor de hybride week 7–13 én de maandlaag) ----
  // Historiek: bank.byBrand per maand (echte mutaties, alle merken behalve Factor —
  // factorbewegingen zijn financiering, geen operationele kasstroom).
  const histIn: Record<string, number> = {}, histOut: Record<string, number> = {};
  for (const [brand, series] of Object.entries(bank.byBrand)) {
    if (brand === "Factor") continue;
    bank.months.forEach((m, i) => {
      histIn[m] = (histIn[m] || 0) + (series.inflow[i] || 0);
      histOut[m] = (histOut[m] || 0) + (series.outflow[i] || 0);
    });
  }
  const seasonIn: Record<number, number[]> = {}, seasonOut: Record<number, number[]> = {};
  for (const m of bank.months) {
    if (m >= todayIso.slice(0, 7)) continue; // lopende maand is onvolledig
    const moY = Number(m.slice(5, 7));
    (seasonIn[moY] ??= []).push(histIn[m] || 0);
    (seasonOut[moY] ??= []).push(histOut[m] || 0);
  }
  const avg = (a: number[] | undefined) => (a && a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

  // HYBRIDE (audit 18/08, geijkt op de bankwerkelijkheid): het itemmodel bleek
  // in de verre weken structureel te pessimistisch (september: model −€1,72M vs
  // bankseizoen +€0,09M; oktober klopte wél: −108k vs −86k). Best practice 13WCF:
  // het nabije venster op individuele posten, het verre venster op het bewezen
  // ritme. Week 1–6 = posten + kalender (scherp, doorklikbaar); week 7–13 =
  // bankseizoensritme per kalendermaand, omgerekend naar weken. Zo sluiten
  // weekmodel en maandlaag per constructie op elkaar aan.
  for (let i = 6; i < 13; i++) {
    const w = weeks[i];
    const mm = Number(w.weekStart.slice(5, 7));
    const y = Number(w.weekStart.slice(0, 4));
    const dim = new Date(Date.UTC(y, mm, 0)).getUTCDate();
    const wIn = (avg(seasonIn[mm]) * groei * 7) / dim, wOut = (avg(seasonOut[mm]) * groei * 7) / dim;
    w.basis = "seizoen";
    w.inNoFactor = wIn; w.inWithFactor = wIn;
    w.inNewNoFactor = 0; w.inNewWithFactor = 0;
    w.outAP = wOut; w.outFixed = 0; w.outNew = 0;
    w.inOldNoFactor = 0; w.inOldWithFactor = 0; w.outOldAP = 0; // seizoen = ritme, geen achterstal
  }

  // ---- 7. Cumulatief saldo + kantelpunten (anker = echte bankstand) ----
  const bankNow = bank.totals.cashOwn;
  // Wat-als "stoppen met factoring" (fix 18/08, vraag David "hoe kan cash meer
  // zijn zonder factoring?"): de oude zonder-lijn startte op de bankstand-mét-
  // voorschotten én telde daarna 100% van de facturen — dubbeltelling, waardoor
  // hij ONterecht boven de kasrealiteit lag. Correct: wie stopt met factoring
  // betaalt eerst het opgenomen 433-voorschot terug (hier: meteen, conservatief),
  // en ontvangt daarna 100% van elke factuur op betaalgedrag. Factoring is dus
  // structureel cash-positief zolang de omzet draait.
  const saldo433Now = perCompany.reduce((s, x) => s + x.saldo433, 0); // negatief = schuld
  let cumN = bankNow + saldo433Now, cumF = bankNow;
  const negN: string[] = [], negF: string[] = [];
  for (const w of weeks) {
    w.inNoFactor = r0(w.inNoFactor); w.inWithFactor = r0(w.inWithFactor);
    w.inNewNoFactor = r0(w.inNewNoFactor); w.inNewWithFactor = r0(w.inNewWithFactor);
    w.outAP = r0(w.outAP); w.outFixed = r0(w.outFixed); w.outNew = r0(w.outNew);
    w.inOldNoFactor = r0(w.inOldNoFactor); w.inOldWithFactor = r0(w.inOldWithFactor); w.outOldAP = r0(w.outOldAP);
    w.netNoFactor = r0(w.inNoFactor + w.inNewNoFactor - w.outAP - w.outFixed - w.outNew);
    w.netWithFactor = r0(w.inWithFactor + w.inNewWithFactor - w.outAP - w.outFixed - w.outNew);
    cumN += w.netNoFactor; cumF += w.netWithFactor;
    w.cumNoFactor = r0(cumN); w.cumWithFactor = r0(cumF);
    if (cumN < 0) negN.push(w.weekStart);
    if (cumF < 0) negF.push(w.weekStart);
  }
  const lowN = weeks.reduce((a, w) => (w.cumNoFactor < a.value ? { week: w.weekStart, value: w.cumNoFactor } : a), { week: weeks[0].weekStart, value: weeks[0].cumNoFactor });
  const lowF = weeks.reduce((a, w) => (w.cumWithFactor < a.value ? { week: w.weekStart, value: w.cumWithFactor } : a), { week: weeks[0].weekStart, value: weeks[0].cumWithFactor });

  // ---- 8. Maandlaag tot eind volgend jaar + 6 mnd (zelfde seizoen als 6c) ----
  // 11 + 7: t/m JUNI van jaar+2 — met +6 eindigde de reeks op mei (audit 18/08).
  const endHorizon = new Date(Date.UTC(today.getUTCFullYear() + 1, 11 + 7, 1)); // eind volgend jaar + 6 mnd
  const months: FcMonth[] = [];
  // eerst de historiek (echte cijfers), dan de projectie
  for (const m of bank.months) {
    if (m >= todayIso.slice(0, 7)) continue;
    months.push({ month: m, inSeason: r0(histIn[m] || 0), outSeason: r0(histOut[m] || 0), net: r0((histIn[m] || 0) - (histOut[m] || 0)), cum: 0, isActual: true });
  }
  for (let d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)); d < endHorizon; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    const m = iso(d).slice(0, 7);
    const moY = Number(m.slice(5, 7));
    let inS = avg(seasonIn[moY]) * groei, outS = avg(seasonOut[moY]) * groei;
    // Lopende maand pro-rata (audit 18/08): bankNow bevat de maand-tot-datum-
    // mutaties al — alleen het RESTANT van deze maand projecteren, anders telt
    // het verstreken deel dubbel.
    if (m === todayIso.slice(0, 7)) {
      const dim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      const frac = Math.max(0, dim - today.getUTCDate()) / dim;
      inS *= frac; outS *= frac;
    }
    months.push({ month: m, inSeason: r0(inS), outSeason: r0(outS), net: r0(inS - outS), cum: 0, isActual: false });
  }
  // cumulatief vanaf bankstand nu, alleen over de projectiemaanden
  let cumM = bankNow;
  for (const m of months) { if (!m.isActual) { cumM += m.net; m.cum = r0(cumM); } }

  const unappliedTotal = perCompany.reduce((s, x) => s + x.unappliedPayments, 0);
  const saldo433Total = saldo433Now;

  return {
    asOf: new Date().toISOString(), isLive: true,
    bankNow: r0(bankNow), factorCredit: r0(bank.totals.factorCredit),
    weeks, beyond13w: { inNoFactor: r0(beyond13w.inNoFactor), inWithFactor: r0(beyond13w.inWithFactor) },
    verleden: {
      inAR: r0(rcv.cashExpectation.reduce((s, w) => s + (w.spreadNet || 0), 0)),
      inARFactor: r0(rcv.cashExpectation.reduce((s, w) => s + (w.spreadFactor || 0), 0)),
      uitAP: r0(weeks.reduce((s, w) => s + w.outOldAP, 0)),
    },
    months,
    lowPoint: { noFactor: lowN, withFactor: lowF },
    negativeWeeks: { noFactor: negN, withFactor: negF },
    perCompany,
    // Uit de gecachete rijen samengesteld — overleeft warme caches (bugfix 18/08).
    unappliedDetail: perCompany
      .flatMap((x) => (x.topUnapplied || []).map((u) => ({ co: x.company, ...u, bcUrl: custLedgerDocLink(x.company, u.doc) })))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
      .slice(0, 25),
    weekDetail: {
      in: (rcv.forecastDetail || []).map((r) => ({
        week: r.week, co: r.co, party: r.cust, doc: r.doc, amount: r.amount,
        when: r.expected, factored: r.factored, spread: r.spread, bcUrl: r.bcUrl,
      })),
      out: capPerWeek(outDetail),
    },
    totals: {
      unapplied: r0(unappliedTotal), unappliedCount: perCompany.reduce((s, x) => s + x.unappliedCount, 0),
      saldo433: r0(saldo433Total), btw: r0(btwPayable), btwUnclear: r0(btwUnclear),
      saldoKrediet: r0(perCompany.reduce((s, x) => s + x.saldoKrediet, 0)),
      payrollMonthly: r0(payrollMonthly), leasingMonthly: r0(leasingMonthly),
    },
    aannames: ([
      "Betaalmoment per klant = factuurdatum + de bedrag-gewogen gemiddelde betaalduur van dié klant (gemeten op de betaalde facturen; kleinere klanten vallen terug op de groepsmediaan). Niet de vervaldag — de grootste accuraatheidswinst volgens best practice.",
      `Niet-toegewezen ontvangsten (open betalingen + bankontvangsten zonder factuurkoppeling, € ${r0(Math.abs(unappliedNet)).toLocaleString("nl-BE")}) staan al in de bankstand en zijn daarom GESALDEERD in de instroom van week 1–6 — anders telden hun facturen dubbel. Bij factoring-klanten is die correctie licht conservatief.`,
      "Straight loans/opticash: de getrokken cash zit al in de bankstand; de schuld zelf (43x excl. 433) en de vervaldagen/rollovers zijn NIET ingepland (rentevoeten en vervaldagen = openstaande vraag bij finance). Rood = behoefte bovenop wat al getrokken is.",
      "Recourse-terugnames door de factor (>90d onbetaalde gefactorde posten) zitten nog niet als uitstroom in het weekprofiel — bekend hiaat, wordt zichtbaar via de 433-monitor.",
      "Wat-als 'stoppen met factoring': die lijn betaalt eerst het opgenomen 433-voorschot terug (conservatief: meteen) en ontvangt daarna 100% van elke factuur op betaalgedrag. Daardoor ligt hij ónder de kasrealiteit — factoring is structureel cash-positief zolang de omzet draait.",
      "Factoring-variant: bij factoring-klanten is 85% van de bestaande posten al voorgeschoten (bevestigd percentage, alle drie de factors); alleen het 15%-saldo telt daar nog. Door KBC uitgesloten facturen (portaal-export 10/08: €42.518) tellen wél aan 100%; de Belfius- en BNP-uitsluitingslijsten ontbreken nog.",
      "Run-rate-laag: nieuwe facturatie loopt door op het gemiddelde weekritme van de laatste 12 volle weken (gesplitst factoring/niet-factoring); met factoring komt 85% daarvan ±1 week na uitreiking binnen (E-trans-aanname), de rest op betaalgedrag. Nieuwe inkopen lopen door op het 12-weken-ritme van de leveranciersfacturen (excl. leasing, ±30d betaaltermijn). Dit is een ritme-aanname, geen orderboek.",
      "Achterstallige posten (klant én leverancier) worden vlak gespreid over week 1–6 — een inningsaanname, geen belofte per post.",
      "Weergave 'zonder achterstal uit het verleden' (schakelaar boven de grafiek): haalt de inhaal op oude posten — achterstallige klantposten, achterstallige leveranciersposten én de niet-toegewezen-saldering — uit het weekprofiel, zodat je het zuivere day-to-day-ritme ziet. De achterstal verdwijnt daarmee NIET: hij staat als aparte pot naast de grafiek en moet bovenop dit ritme worden ingehaald (belwerk) of betaald.",
      `Apart gezette leveranciersposten tellen NIET als cash-out (${AP_UITZONDERINGEN.map((u) => `${u.co} ${u.doc}`).join(", ")} — o.a. de ES Finance-aktefactuur Sint-Niklaas €1,93M: al in de P&L als uitzonderlijke kost, wordt via de akte verrekend). Volledige lijst met reden: blad 'Apart gezet' in de leveranciersaging-export.`,
      "Lonen/RSZ = gemiddelde van de laatste 3 volle maanden op de 62-rekeningen, excl. provisieboekingen (vakantiegeld/13e maand — geen maandcash), geboekt op maandeinde. Btw = 451-saldi tot €1M per firma ÉÉN keer op de eerstvolgende 20e; latere aangiftes zijn nog niet geraamd. Leasing = 12m-gemiddelde externe cash-out, begin maand.",
      btwUnclear > 0 ? `€ ${r0(btwUnclear).toLocaleString("nl-BE")} aan 451-saldi (>€1M per firma, o.a. WHS/TDR) staat NIET in het weekprofiel: het oogt opgestapeld (regime btw-provisierekening?) en de betaaltiming is onbekend — [PRIO]-vraag bij finance.` : "",
      "Maandlaag = seizoensgemiddelde van de échte bankmutaties (excl. factorbewegingen) — dít is de lange-termijnlaag (tot eind volgend jaar + 6 mnd), richtinggevend tot het budgetbronbestand is aangesloten.",
      `AP-posten met vervaldag ná week 13 (€ ${r0(apBeyond).toLocaleString("nl-BE")}) zitten niet in het weekbeeld.`,
    ] as string[]).filter(Boolean),
    sources: [
      { label: "Instromen (13 weken)", detail: `Open klantposten (Cust_LedgerEntries, Open=true) van alle vennootschappen, extern, creditnota's gesaldeerd. Verwacht betaalmoment per klant uit de betaalgedrag-motor van de klantenpagina (meetperiode: ${rcv.periodNote}). Factoring-herkenning: ≥40% betaald volume via factor-dagboek.` },
      { label: "Uitstromen (13 weken)", detail: "Open leveranciersposten (VendorLedgerEntries, Open=true) op vervaldag (achterstallig = deze week), IC uitgesloten, CN gesaldeerd. Plus kalenderposten: lonen/RSZ (62-range, gem. 3 mnd), btw (451-saldo, 20e), leasing (12m-gemiddelde)." },
      { label: "Bankstand & maandlaag", detail: "BankAccountLedgerEntries per rekening: eigen bankstand (excl. factorkrediet) als anker; maandlaag = seizoensgemiddelde per kalendermaand uit dezelfde mutaties (excl. Factor-merk)." },
      { label: "433 / niet-toegewezen", detail: "trialBalances per vennootschap op vandaag (433*-saldi = factor rekening-courant, 451* = btw) + open betalingen/creditnota's zonder factuurtoewijzing uit Cust_LedgerEntries." },
    ],
    notes: ([
      perCompany.some((x) => x.degraded)
        ? `LET OP — DATAKWALITEIT: voor ${perCompany.filter((x) => x.degraded).map((x) => x.company).join(", ")} kon het 433/451-saldo NIET worden opgehaald (trialBalances faalde). De wat-als-lijn en de btw-post zijn voor die firma's onvolledig — vernieuw of meld het.`
        : "",
      "Kasrealiteit (met factoring) is het echte saldo-pad; het wat-als toont de kost van stoppen met factoring. Rood = financieringsbehoefte (kredietlijnen zitten er bewust niet in).",
      "Nog niet aangesloten (fase 2): E-trans opmaakdatums (moment van aanbieding aan de factor), CODA-dagreconciliatie en de factorportaal-rapporten. Tot dan is de 85/15-timing een modelaanname.",
      "Week 1–6 = individuele posten + kalender (scherp, doorklikbaar). Week 7–13 en de maandlaag = het bankritme van dezelfde maand vorig jaar, geschaald met de omzettrend uit de Management-P&L (omzet volle maanden dit jaar ÷ zelfde maanden vorig jaar, begrensd 0,8–1,25)" + (typeof groei === "number" && groei !== 1 ? ` — groeifactor nu: ${groei.toFixed(2)}` : "") + ". Geijkt op de werkelijkheid: het pure itemmodel bleek in het verre venster te pessimistisch (september −€1,7M vs bankwerkelijkheid +€0,1M).",
    ] as string[]).filter(Boolean),
  };
}

function demoCashForecast(): CfoCashForecast {
  const w0 = mondayOf(new Date());
  const weeks: FcWeek[] = Array.from({ length: 13 }, (_, i) => {
    const inN = 900_000 + (i % 4) * 120_000, inF = inN * 0.55, outA = 700_000 + (i % 3) * 90_000, outF = i % 4 === 3 ? 950_000 : 60_000;
    return {
      weekStart: iso(addDays(w0, i * 7)), label: `wk ${isoWeekNum(addDays(w0, i * 7))}`,
      inNoFactor: inN, inWithFactor: inF, inNewNoFactor: i >= 6 ? 850_000 : 0, inNewWithFactor: i >= 1 ? 700_000 : 0, outNew: i >= 4 ? 780_000 : 0,
      outAP: outA, outFixed: outF,
      netNoFactor: inN - outA - outF, netWithFactor: inF - outA - outF, cumNoFactor: 0, cumWithFactor: 0,
      basis: (i >= 6 ? "seizoen" : "posten") as "posten" | "seizoen",
      inOldNoFactor: i < 6 ? 320_000 : 0, inOldWithFactor: i < 6 ? 180_000 : 0, outOldAP: i < 6 ? 260_000 : 0,
    };
  });
  // Demo consistent met het echte mechanisme: wat-als start ná 433-terugbetaling (audit 18/08).
  let cn = 1_200_000 - 4_100_000, cf = 1_200_000;
  for (const w of weeks) { cn += w.netNoFactor; cf += w.netWithFactor; w.cumNoFactor = cn; w.cumWithFactor = cf; }
  return {
    asOf: new Date().toISOString(), isLive: false,
    bankNow: 1_200_000, factorCredit: -1_350_000,
    weeks, beyond13w: { inNoFactor: 800_000, inWithFactor: 300_000 },
    // Bruto = weekvelden (incl. saldering) + de niet-toegewezen −180k terug erbij.
    verleden: { inAR: 6 * 320_000 + 180_000, inARFactor: 6 * 180_000 + 180_000, uitAP: 6 * 260_000 },
    months: [], lowPoint: { noFactor: { week: weeks[8].weekStart, value: -4_100_000 }, withFactor: { week: weeks[6].weekStart, value: -510_000 } },
    negativeWeeks: { noFactor: [weeks[8].weekStart], withFactor: [weeks[6].weekStart, weeks[7].weekStart] },
    perCompany: [{ company: "WHS", saldo433: -1_350_000, btwSaldo: -220_000, unappliedPayments: -180_000, unappliedCount: 14, openCn: -60_000, saldoKrediet: -500_000 }],
    weekDetail: { in: [], out: [] }, unappliedDetail: [],
    totals: { unapplied: -180_000, unappliedCount: 14, saldo433: -1_350_000, btw: 220_000, btwUnclear: 0, saldoKrediet: -500_000, payrollMonthly: 1_450_000, leasingMonthly: 410_000 },
    aannames: ["Demomodus"], sources: [{ label: "Demo", detail: "Demomodus — live versie leest BC." }], notes: [],
  };
}

// v15: verleden-splitsing (achterstal apart) + ISO-weeknummers (19/08).
export const getCashForecast = makePolledGetter<CfoCashForecast>("cashfc-v15", buildCashForecast, demoCashForecast);
