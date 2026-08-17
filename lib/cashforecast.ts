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
//    RICHTINGGEVEND, geen budget. De 12-maanden indirecte laag blijft EMAsphere.
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
import { isIcName } from "./cfo";
import { vendorLedgerDocLink } from "./bc-links";

const r0 = (n: number) => Math.round(n);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
function mondayOf(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const wd = (x.getUTCDay() + 6) % 7;
  return addDays(x, -wd);
}

export interface FcWeek {
  weekStart: string; label: string;
  inNoFactor: number;   // verwachte klantontvangsten, CN gesaldeerd, 100% (baseline)
  inWithFactor: number; // idem, maar factoring-klanten alleen 15%-saldo
  outAP: number;        // leveranciers op vervaldag (CN gesaldeerd)
  outFixed: number;     // lonen/RSZ + btw + leasing (kalenderregels)
  netNoFactor: number; netWithFactor: number;
  cumNoFactor: number; cumWithFactor: number; // cumulatief saldo vanaf bankstand nu
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
  unappliedPayments: number; unappliedCount: number; // open betalingen zonder factuur
  openCn: number;         // open creditnota's
}
export interface CfoCashForecast {
  asOf: string; isLive: boolean;
  bankNow: number;        // eigen bankstand (excl. factorkrediet)
  factorCredit: number;   // opgenomen factorvoorschot (schuld, geen cash)
  weeks: FcWeek[];        // 13 weken
  beyond13w: { inNoFactor: number; inWithFactor: number }; // AR verwacht ná week 13
  months: FcMonth[];      // historiek + projectie tot eind volgend jaar + 6 mnd
  lowPoint: { noFactor: { week: string; value: number }; withFactor: { week: string; value: number } };
  negativeWeeks: { noFactor: string[]; withFactor: string[] };
  perCompany: FcCompanyMisc[];
  weekDetail: { in: FcDetailRow[]; out: FcDetailRow[] }; // top 15 per week, met BC-link
  totals: { unapplied: number; unappliedCount: number; saldo433: number; btw: number; btwUnclear: number; payrollMonthly: number; leasingMonthly: number };
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

  // ---- 2. Weekraster (13 weken, ma–zo) ----
  const weeks: FcWeek[] = Array.from({ length: 13 }, (_, i) => ({
    weekStart: iso(addDays(w0, i * 7)), label: `wk ${String(i + 1).padStart(2, "0")}`,
    inNoFactor: 0, inWithFactor: 0, outAP: 0, outFixed: 0,
    netNoFactor: 0, netWithFactor: 0, cumNoFactor: 0, cumWithFactor: 0,
  }));
  const weekOf = (dateIso: string): number => {
    const wi = Math.floor((Date.parse(`${dateIso}T00:00:00Z`) - w0.getTime()) / (7 * 86400000));
    return wi < 0 ? 0 : wi;
  };

  // Instromen uit de receivables-motor (betaalgedrag per klant, CN gesaldeerd).
  rcv.cashExpectation.forEach((w, i) => {
    if (i < 13) { weeks[i].inNoFactor = w.expectedNet || 0; weeks[i].inWithFactor = w.expectedFactor || 0; }
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
      const due = String(e.Due_Date || "").slice(0, 10);
      const doc = String(e.Document_Date || "").slice(0, 10);
      const when = (due && !due.startsWith("0001") ? due : doc) || todayIso;
      let week: number;
      if (when < todayIso) {
        // Achterstallige leveranciers betalen we niet allemaal deze week —
        // inhaalritme gespreid over week 1–6 (eigen keuze, zelfde spreiding als AR).
        for (let k = 0; k < 6; k++) weeks[k].outAP += rem / 6;
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
    const key = `cf-payroll1-${c.code}-${m0Iso}`;
    const cached = getCache<number>(key);
    if (cached != null) { payroll3m += cached; continue; }
    let sum = 0;
    const filt = encodeURIComponent(`Posting_Date ge ${m0Iso} and Posting_Date le ${lastFullEnd} and G_L_Account_No ge '620000' and G_L_Account_No le '629999'`);
    await pageAllOData(`${ODATA_ROOT}/ODataV4/Company('${encodeURIComponent(c.code)}')/Grootboekposten_Excel?$filter=${filt}&$select=Amount`, (e) => {
      sum += (e.Amount as number) || 0;
    }, token);
    setCache(key, sum, 720);
    payroll3m += sum;
  }
  const payrollMonthly = Math.max(0, payroll3m / 3);

  // ---- 5. 433/451-saldi + niet-toegewezen betalingen per firma ----
  const perCompany: FcCompanyMisc[] = [];
  for (const c of companies) {
    const key = `cf-misc1-${c.code}-${todayIso}`;
    const cached = getCache<FcCompanyMisc>(key);
    if (cached) { perCompany.push(cached); continue; }
    const row: FcCompanyMisc = { company: c.code, saldo433: 0, btwSaldo: 0, unappliedPayments: 0, unappliedCount: 0, openCn: 0 };
    try {
      for (const b of await fetchAccountBalances(c.id, todayIso, token)) {
        if (b.no.startsWith("433")) row.saldo433 += b.amount;
        if (b.no.startsWith("451")) row.btwSaldo += b.amount;
      }
    } catch { /* trialBalances niet beschikbaar → 0, staat in de noot */ }
    const filt = encodeURIComponent(`Open eq true and (Document_Type eq 'Payment' or Document_Type eq 'Credit Memo')`);
    await pageAllOData(`${ODATA_ROOT}/ODataV4/Company('${encodeURIComponent(c.code)}')/Cust_LedgerEntries?$filter=${filt}&$select=Document_Type,Remaining_Amt_LCY,Customer_Name`, (e) => {
      const rem = (e.Remaining_Amt_LCY as number) || 0;
      if (Math.abs(rem) < 1 || isIcName(String(e.Customer_Name || ""))) return;
      if (e.Document_Type === "Payment") { row.unappliedPayments += rem; row.unappliedCount++; }
      else row.openCn += rem;
    }, token);
    row.saldo433 = r0(row.saldo433); row.btwSaldo = r0(row.btwSaldo);
    row.unappliedPayments = r0(row.unappliedPayments); row.openCn = r0(row.openCn);
    setCache(key, row, 720);
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

  // ---- 7. Cumulatief saldo + kantelpunten (anker = echte bankstand) ----
  const bankNow = bank.totals.cashOwn;
  let cumN = bankNow, cumF = bankNow;
  const negN: string[] = [], negF: string[] = [];
  for (const w of weeks) {
    w.inNoFactor = r0(w.inNoFactor); w.inWithFactor = r0(w.inWithFactor);
    w.outAP = r0(w.outAP); w.outFixed = r0(w.outFixed);
    w.netNoFactor = r0(w.inNoFactor - w.outAP - w.outFixed);
    w.netWithFactor = r0(w.inWithFactor - w.outAP - w.outFixed);
    cumN += w.netNoFactor; cumF += w.netWithFactor;
    w.cumNoFactor = r0(cumN); w.cumWithFactor = r0(cumF);
    if (cumN < 0) negN.push(w.weekStart);
    if (cumF < 0) negF.push(w.weekStart);
  }
  const lowN = weeks.reduce((a, w) => (w.cumNoFactor < a.value ? { week: w.weekStart, value: w.cumNoFactor } : a), { week: weeks[0].weekStart, value: weeks[0].cumNoFactor });
  const lowF = weeks.reduce((a, w) => (w.cumWithFactor < a.value ? { week: w.weekStart, value: w.cumWithFactor } : a), { week: weeks[0].weekStart, value: weeks[0].cumWithFactor });

  // ---- 8. Maandlaag tot eind volgend jaar + 6 mnd (seizoen uit bankmutaties) ----
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
  const endHorizon = new Date(Date.UTC(today.getUTCFullYear() + 1, 11 + 6, 1)); // eind volgend jaar + 6 mnd
  const months: FcMonth[] = [];
  // eerst de historiek (echte cijfers), dan de projectie
  for (const m of bank.months) {
    if (m >= todayIso.slice(0, 7)) continue;
    months.push({ month: m, inSeason: r0(histIn[m] || 0), outSeason: r0(histOut[m] || 0), net: r0((histIn[m] || 0) - (histOut[m] || 0)), cum: 0, isActual: true });
  }
  for (let d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)); d < endHorizon; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    const m = iso(d).slice(0, 7);
    const moY = Number(m.slice(5, 7));
    const inS = avg(seasonIn[moY]), outS = avg(seasonOut[moY]);
    months.push({ month: m, inSeason: r0(inS), outSeason: r0(outS), net: r0(inS - outS), cum: 0, isActual: false });
  }
  // cumulatief vanaf bankstand nu, alleen over de projectiemaanden
  let cumM = bankNow;
  for (const m of months) { if (!m.isActual) { cumM += m.net; m.cum = r0(cumM); } }

  const unappliedTotal = perCompany.reduce((s, x) => s + x.unappliedPayments, 0);
  const saldo433Total = perCompany.reduce((s, x) => s + x.saldo433, 0);

  return {
    asOf: new Date().toISOString(), isLive: true,
    bankNow: r0(bankNow), factorCredit: r0(bank.totals.factorCredit),
    weeks, beyond13w: { inNoFactor: r0(beyond13w.inNoFactor), inWithFactor: r0(beyond13w.inWithFactor) },
    months,
    lowPoint: { noFactor: lowN, withFactor: lowF },
    negativeWeeks: { noFactor: negN, withFactor: negF },
    perCompany,
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
      payrollMonthly: r0(payrollMonthly), leasingMonthly: r0(leasingMonthly),
    },
    aannames: ([
      "Betaalmoment per klant = factuurdatum + mediaan betaalgedrag van dié klant (niet de vervaldag) — de grootste accuraatheidswinst volgens best practice.",
      "Factoring-variant: bij factoring-klanten is 85% verondersteld al voorgeschoten (bevestigd percentage, alle drie de factors); alleen het 15%-saldo telt als komende ontvangst. Nieuwe facturatie ná vandaag zit nog niet in het weekbeeld.",
      "Achterstallige posten (klant én leverancier) worden vlak gespreid over week 1–6 — een inningsaanname, geen belofte per post.",
      "Lonen/RSZ = gemiddelde van de laatste 3 volle maanden op de 62-rekeningen, geboekt op maandeinde. Btw = 451-saldi tot €1M per firma ÉÉN keer op de eerstvolgende 20e; latere aangiftes zijn nog niet geraamd. Leasing = 12m-gemiddelde externe cash-out, begin maand.",
      btwUnclear > 0 ? `€ ${r0(btwUnclear).toLocaleString("nl-BE")} aan 451-saldi (>€1M per firma, o.a. WHS/TDR) staat NIET in het weekprofiel: het oogt opgestapeld (regime btw-provisierekening?) en de betaaltiming is onbekend — [PRIO]-vraag bij finance.` : "",
      "Maandlaag = seizoensgemiddelde van de échte bankmutaties (excl. factorbewegingen) — richtinggevend, geen budget. De 12-maanden indirecte prognose blijft EMAsphere.",
      `AP-posten met vervaldag ná week 13 (€ ${r0(apBeyond).toLocaleString("nl-BE")}) zitten niet in het weekbeeld.`,
    ] as string[]).filter(Boolean),
    sources: [
      { label: "Instromen (13 weken)", detail: `Open klantposten (Cust_LedgerEntries, Open=true) van alle vennootschappen, extern, creditnota's gesaldeerd. Verwacht betaalmoment per klant uit de betaalgedrag-motor van de klantenpagina (meetperiode: ${rcv.periodNote}). Factoring-herkenning: ≥40% betaald volume via factor-dagboek.` },
      { label: "Uitstromen (13 weken)", detail: "Open leveranciersposten (VendorLedgerEntries, Open=true) op vervaldag (achterstallig = deze week), IC uitgesloten, CN gesaldeerd. Plus kalenderposten: lonen/RSZ (62-range, gem. 3 mnd), btw (451-saldo, 20e), leasing (12m-gemiddelde)." },
      { label: "Bankstand & maandlaag", detail: "BankAccountLedgerEntries per rekening: eigen bankstand (excl. factorkrediet) als anker; maandlaag = seizoensgemiddelde per kalendermaand uit dezelfde mutaties (excl. Factor-merk)." },
      { label: "433 / niet-toegewezen", detail: "trialBalances per vennootschap op vandaag (433*-saldi = factor rekening-courant, 451* = btw) + open betalingen/creditnota's zonder factuurtoewijzing uit Cust_LedgerEntries." },
    ],
    notes: [
      "Baseline = ZONDER factoring (meeting 17/08): het zuiverste beeld van wanneer klanten echt betalen. De factoringlijn ernaast toont de kasrealiteit met voorschotten.",
      "Nog niet aangesloten (fase 2): E-trans opmaakdatums (moment van aanbieding aan de factor), CODA-dagreconciliatie en de factorportaal-rapporten. Tot dan is de 85/15-timing een modelaanname.",
      "Week 1–4 is operationeel scherp; week 5–13 richtinggevend. De maandlaag is een seizoensbeeld, geen toezegging.",
    ],
  };
}

function demoCashForecast(): CfoCashForecast {
  const w0 = mondayOf(new Date());
  const weeks: FcWeek[] = Array.from({ length: 13 }, (_, i) => {
    const inN = 900_000 + (i % 4) * 120_000, inF = inN * 0.55, outA = 700_000 + (i % 3) * 90_000, outF = i % 4 === 3 ? 950_000 : 60_000;
    return {
      weekStart: iso(addDays(w0, i * 7)), label: `wk ${String(i + 1).padStart(2, "0")}`,
      inNoFactor: inN, inWithFactor: inF, outAP: outA, outFixed: outF,
      netNoFactor: inN - outA - outF, netWithFactor: inF - outA - outF, cumNoFactor: 0, cumWithFactor: 0,
    };
  });
  let cn = 1_200_000, cf = 1_200_000;
  for (const w of weeks) { cn += w.netNoFactor; cf += w.netWithFactor; w.cumNoFactor = cn; w.cumWithFactor = cf; }
  return {
    asOf: new Date().toISOString(), isLive: false,
    bankNow: 1_200_000, factorCredit: -1_350_000,
    weeks, beyond13w: { inNoFactor: 800_000, inWithFactor: 300_000 },
    months: [], lowPoint: { noFactor: { week: weeks[8].weekStart, value: -240_000 }, withFactor: { week: weeks[6].weekStart, value: -510_000 } },
    negativeWeeks: { noFactor: [weeks[8].weekStart], withFactor: [weeks[6].weekStart, weeks[7].weekStart] },
    perCompany: [{ company: "WHS", saldo433: -1_350_000, btwSaldo: -220_000, unappliedPayments: -180_000, unappliedCount: 14, openCn: -60_000 }],
    weekDetail: { in: [], out: [] },
    totals: { unapplied: -180_000, unappliedCount: 14, saldo433: -1_350_000, btw: 220_000, btwUnclear: 0, payrollMonthly: 1_450_000, leasingMonthly: 410_000 },
    aannames: ["Demomodus"], sources: [{ label: "Demo", detail: "Demomodus — live versie leest BC." }], notes: [],
  };
}

export const getCashForecast = makePolledGetter<CfoCashForecast>("cashfc-v4", buildCashForecast, demoCashForecast);
