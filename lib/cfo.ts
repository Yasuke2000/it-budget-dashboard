// ============================================================
// CFO Cockpit — group financials (P&L, cash, working capital)
// ============================================================
// Self-contained data layer for the /cfo page. Builds a drill-downable P&L from
// BC general-ledger entries (PCMN classes 6/7) THROUGH to net result (financial
// result 65/75, non-recurring 66/76, taxes 67/77 — appropriation 68/69/78/79 is
// excluded), plus cash (class 55), group AP/AR aging, a 13-week cash forecast,
// ratios, a condensed balance sheet and same-period-last-year comparisons.
// Falls back to rich sample data in demo mode. Cached 2h; `force` busts the cache.

import type {
  CfoFinancials, CfoPnlLine, CfoAccountRow, CfoEntityRow, CfoMonthPoint, CfoAgingBucket, CfoKpis,
  CfoRatios, CfoBalanceSheet, CfoCashForecast, CfoCashWeek, CfoBudget, CfoPrevYear, CfoAgingItem,
} from "./types";
import { vendorLedgerDocLink, salesInvoiceLink } from "./bc-links";
import { getCache, setCache } from "./sync-cache";
import {
  fetchBCCompanies, fetchBCPnlRows, fetchBCAccountNames, fetchBCCashBalance,
  fetchBCOpenAP, fetchBCOpenAR, fetchBCClassNetBalance, type BCPnlRow, type BCOpenAPRow, type BCOpenARRow,
} from "./bc-client";
import { getAppSettings } from "./settings-store";

function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE !== "false";
}
function isOperatingCompany(name: string): boolean {
  return !/^_/.test(name) && !/test|copie|fleetmate/i.test(name);
}
const r0 = (n: number) => Math.round(n);

// Intercompany counterparty (own group entity as vendor/customer) — name-based.
const IC_RX = /gheeraert|\bde\s*rudder\b|dr logistics|\brudder\b|marcel lamberts|lamberts en zonen|trans[\s-]?form|\bwarehouse\b|m[\s-]?express/i;
const isIcName = (name: string) => IC_RX.test(name || "");

// Monday of the week containing `d` (UTC).
function mondayOf(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7; // 0 = Monday
  x.setUTCDate(x.getUTCDate() - dow);
  return x;
}
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }
function iso(d: Date): string { return d.toISOString().slice(0, 10); }
function shiftYear(isoDate: string, delta: number): string {
  return `${Number(isoDate.slice(0, 4)) + delta}${isoDate.slice(4)}`;
}

// ---- PCMN (Belgian MAR) class semantics ----
const OP_INCOME = ["70", "71", "72", "74"];          // operating income (credit-normal)
const OP_EXPENSE = ["60", "61", "62", "63", "64"];   // operating expense (debit-normal)
const INCOME_NORMAL = new Set([...OP_INCOME, "75", "76", "77"]);
const EXPENSE_NORMAL = new Set([...OP_EXPENSE, "65", "66", "67"]);
const CLASS_LABEL: Record<string, string> = {
  "70": "Omzet",
  "71": "Voorraadwijziging",
  "72": "Geproduceerde vaste activa",
  "74": "Andere bedrijfsopbrengsten",
  "60": "Aankopen & handelsgoederen",
  "61": "Diensten & diverse goederen",
  "62": "Bezoldigingen & sociale lasten",
  "63": "Afschrijvingen & waardeverm.",
  "64": "Andere bedrijfskosten",
  "65": "Financiële kosten",
  "75": "Financiële opbrengsten",
  "66": "Niet-recurrente kosten",
  "76": "Niet-recurrente opbrengsten",
  "67": "Belastingen",
  "77": "Regularisatie belastingen",
};

const AGING_ORDER = ["Niet vervallen", "< 30d", "< 60d", "< 90d", "> 90d", "Onbekend"];
function agingBucket(due: string, today: Date): string {
  if (!due) return "Onbekend";
  const d = new Date(`${due}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "Onbekend";
  const days = Math.floor((today.getTime() - d.getTime()) / 86400000);
  if (days <= 0) return "Niet vervallen";
  if (days <= 30) return "< 30d";
  if (days <= 60) return "< 60d";
  if (days <= 90) return "< 90d";
  return "> 90d";
}

// Signed value of one GL row for its class kind (income credit-normal, expense debit-normal).
function rowValue(row: BCPnlRow): { c2: string; val: number; kind: "income" | "expense" } | null {
  const c2 = row.accountNumber.slice(0, 2);
  if (INCOME_NORMAL.has(c2)) return { c2, val: row.credit - row.debit, kind: "income" };
  if (EXPENSE_NORMAL.has(c2)) return { c2, val: row.debit - row.credit, kind: "expense" };
  return null; // 68/69/78/79 (appropriation etc.) — excluded
}

// Headline totals from raw P&L rows — used for the same-period-last-year comparison.
function computePnlTotals(rows: BCPnlRow[]): CfoPrevYear {
  const cls: Record<string, number> = {};
  for (const row of rows) {
    const rv = rowValue(row);
    if (rv) cls[rv.c2] = (cls[rv.c2] || 0) + rv.val;
  }
  const g = (c: string) => cls[c] || 0;
  const revenue = OP_INCOME.reduce((s, c) => s + g(c), 0);
  const ebitda = revenue - (g("60") + g("61") + g("62") + g("64"));
  const ebit = ebitda - g("63");
  const netResult = ebit + (g("75") - g("65")) + (g("76") - g("66")) - (g("67") - g("77"));
  return { revenue: r0(revenue), ebitda: r0(ebitda), ebit: r0(ebit), netResult: r0(netResult) };
}

// ---- per-company aggregate from raw GL rows ----
interface CompanyExtras {
  cash: number;
  equity: number;        // class 1 net (credit-normal → typically negative)
  fixedAssets: number;   // class 2 net
  inventory: number;     // class 3 net
  apRows: BCOpenAPRow[];
  arRows: BCOpenARRow[];
}
interface MonthAgg { rev: number; cost: number; byClass: Record<string, number> }
interface CompanyAgg extends CompanyExtras {
  code: string;
  name: string;
  opIncome: number;                                     // operating income only
  byClass: Record<string, number>;                      // per 2-digit class, signed by kind
  accountsByClass: Record<string, Map<string, number>>; // class → (accountNumber → amount)
  monthly: Map<string, MonthAgg>;                       // operating only, + per expense class
}

function aggregateCompany(
  code: string, name: string, rows: BCPnlRow[], extras: CompanyExtras
): CompanyAgg {
  const byClass: Record<string, number> = {};
  const accountsByClass: Record<string, Map<string, number>> = {};
  const monthly = new Map<string, MonthAgg>();
  let opIncome = 0;
  for (const row of rows) {
    const rv = rowValue(row);
    if (!rv) continue;
    byClass[rv.c2] = (byClass[rv.c2] || 0) + rv.val;
    (accountsByClass[rv.c2] = accountsByClass[rv.c2] || new Map()).set(
      row.accountNumber, (accountsByClass[rv.c2].get(row.accountNumber) || 0) + rv.val
    );
    if (OP_INCOME.includes(rv.c2) || OP_EXPENSE.includes(rv.c2)) {
      const month = row.postingDate.slice(0, 7);
      const m = monthly.get(month) || { rev: 0, cost: 0, byClass: {} };
      if (rv.kind === "income") { opIncome += rv.val; m.rev += rv.val; }
      else { m.cost += rv.val; m.byClass[rv.c2] = (m.byClass[rv.c2] || 0) + rv.val; }
      monthly.set(month, m);
    }
  }
  return { code, name, opIncome, byClass, accountsByClass, monthly, ...extras };
}

// ---- combine company aggregates into the final CfoFinancials ----
function daysElapsed(fromISO: string, today: Date): number {
  const f = new Date(`${fromISO}T00:00:00Z`).getTime();
  return Math.max(1, Math.round((today.getTime() - f) / 86400000));
}

function buildForecast(
  openingCash: number, arRows: BCOpenARRow[], apRows: BCOpenAPRow[], weeklyPayroll: number, today: Date
): CfoCashForecast {
  const start = mondayOf(today);
  const weeks: CfoCashWeek[] = [];
  let closing = openingCash;
  let lowestClosing = openingCash, lowestWeekLabel = "start";
  for (let w = 0; w < 13; w++) {
    const ws = addDays(start, w * 7), we = addDays(ws, 7);
    let inflow = 0, outflow = 0;
    for (const r of arRows) {
      if (!r.due || !r.amount) continue;
      const due = new Date(`${r.due}T00:00:00Z`);
      if (w === 0 ? due < we : due >= ws && due < we) inflow += r.amount;
    }
    for (const r of apRows) {
      if (!r.due || !r.oweEUR) continue;
      const due = new Date(`${r.due}T00:00:00Z`);
      if (w === 0 ? due < we : due >= ws && due < we) outflow += r.oweEUR;
    }
    outflow += weeklyPayroll;
    const net = inflow - outflow;
    closing += net;
    if (closing < lowestClosing) { lowestClosing = closing; lowestWeekLabel = `wk ${String(w + 1).padStart(2, "0")}`; }
    weeks.push({ weekStart: iso(ws), label: `wk ${String(w + 1).padStart(2, "0")}`, inflow: r0(inflow), outflow: r0(outflow), net: r0(net), closing: r0(closing) });
  }
  return {
    openingCash: r0(openingCash), weeks, lowestClosing: r0(lowestClosing), lowestWeekLabel,
    assumptions: [
      "Directe methode: openingssaldo bank + inning openstaande klanten (op vervaldatum) − betaling openstaande leveranciers (op vervaldatum).",
      "Vervallen posten vallen in week 1. Wekelijkse loonuitgave = personeelskost / gemiddeld aantal weken sinds jaarbegin.",
      "Nog geen inningsvertraging per klant gemodelleerd (posten op hun vervaldatum geïnd) — verfijnbaar met betaalgedrag.",
    ],
  };
}

export interface BudgetTargets { rev: number; cost: number; byClass?: Record<string, number> }

function buildBudget(
  targets: BudgetTargets, income: number, costs: number, ebit: number, elapsed: number,
  classActuals?: Record<string, number>
): CfoBudget {
  const hasClassTargets = Object.values(targets.byClass || {}).some((v) => v > 0);
  if (!targets.rev && !targets.cost && !hasClassTargets) {
    return { configured: false, revenueTarget: 0, costTarget: 0, monthlyRevenueTarget: 0, monthlyCostTarget: 0, revenueVariancePct: 0, resultVariancePct: 0 };
  }
  const frac = Math.min(1, elapsed / 365);
  const proRataRev = targets.rev * frac, proRataResult = (targets.rev - targets.cost) * frac;
  // Per-kostenklasse: jaardoel pro-rata vs YTD-actual. Positief = boven doel (slecht).
  const classVariance = hasClassTargets
    ? Object.entries(targets.byClass || {})
        .filter(([, t]) => t > 0)
        .map(([cls, target]) => {
          const actual = classActuals?.[cls] || 0;
          const proRata = target * frac;
          return {
            cls, label: CLASS_LABEL[cls] || cls, target: r0(target), actual: r0(actual), proRata: r0(proRata),
            variancePct: proRata ? Math.round(((actual - proRata) / proRata) * 1000) / 10 : 0,
          };
        })
        .sort((a, b) => a.cls.localeCompare(b.cls))
    : undefined;
  return {
    configured: true, revenueTarget: targets.rev, costTarget: targets.cost,
    monthlyRevenueTarget: r0(targets.rev / 12), monthlyCostTarget: r0(targets.cost / 12),
    revenueVariancePct: proRataRev ? Math.round(((income - proRataRev) / proRataRev) * 1000) / 10 : 0,
    resultVariancePct: proRataResult ? Math.round(((ebit - proRataResult) / proRataResult) * 1000) / 10 : 0,
    classVariance,
  };
}

function combine(
  aggs: CompanyAgg[], names: Record<string, string>, company: string,
  from: string, to: string, label: string, isLive: boolean, today: Date,
  budgetTargets: BudgetTargets, prevYear?: CfoPrevYear
): CfoFinancials {
  const income = aggs.reduce((s, a) => s + a.opIncome, 0);
  const byClass: Record<string, number> = {};
  const accountsByClass: Record<string, Map<string, number>> = {};
  const monthly = new Map<string, MonthAgg>();
  for (const a of aggs) {
    for (const [c, v] of Object.entries(a.byClass)) byClass[c] = (byClass[c] || 0) + v;
    for (const [c, m] of Object.entries(a.accountsByClass)) {
      const dst = (accountsByClass[c] = accountsByClass[c] || new Map());
      for (const [acc, v] of m) dst.set(acc, (dst.get(acc) || 0) + v);
    }
    for (const [mo, v] of a.monthly) {
      const cur = monthly.get(mo) || { rev: 0, cost: 0, byClass: {} };
      cur.rev += v.rev; cur.cost += v.cost;
      for (const [c, x] of Object.entries(v.byClass)) cur.byClass[c] = (cur.byClass[c] || 0) + x;
      monthly.set(mo, cur);
    }
  }
  const cls = (c: string) => byClass[c] || 0;
  const totalCosts = OP_EXPENSE.reduce((s, c) => s + cls(c), 0);
  const ebitda = income - (cls("60") + cls("61") + cls("62") + cls("64"));
  const ebit = ebitda - cls("63");
  const finRes = cls("75") - cls("65");
  const excRes = cls("76") - cls("66");
  const taxes = cls("67") - cls("77");
  const resultBeforeTax = ebit + finRes + excRes;
  const netResult = resultBeforeTax - taxes;

  const accRows = (c: string, negate = false): CfoAccountRow[] =>
    [...(accountsByClass[c] || new Map()).entries()]
      .map(([accountNumber, amount]) => ({
        accountNumber,
        accountName: names[accountNumber] || accountNumber,
        amount: r0(negate ? -amount : amount),
      }))
      .filter((a) => Math.abs(a.amount) > 0);
  const byAbs = (rows: CfoAccountRow[]) => rows.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  const revenueAccounts = byAbs(OP_INCOME.flatMap((c) => accRows(c)));
  const finAccounts = byAbs([...accRows("75"), ...accRows("65", true)]);
  const excAccounts = byAbs([...accRows("76"), ...accRows("66", true)]);
  const taxAccounts = byAbs([...accRows("77"), ...accRows("67", true)]);

  const pnl: CfoPnlLine[] = [
    { key: "revenue", label: "Bedrijfsopbrengsten", amount: r0(income), kind: "income", pnlClass: "70", accounts: revenueAccounts },
    { key: "c60", label: CLASS_LABEL["60"], amount: -r0(cls("60")), kind: "expense", pnlClass: "60", accounts: byAbs(accRows("60")) },
    { key: "c61", label: CLASS_LABEL["61"], amount: -r0(cls("61")), kind: "expense", pnlClass: "61", accounts: byAbs(accRows("61")) },
    { key: "c62", label: CLASS_LABEL["62"], amount: -r0(cls("62")), kind: "expense", pnlClass: "62", accounts: byAbs(accRows("62")) },
    { key: "c64", label: CLASS_LABEL["64"], amount: -r0(cls("64")), kind: "expense", pnlClass: "64", accounts: byAbs(accRows("64")) },
    { key: "ebitda", label: "EBITDA", amount: r0(ebitda), kind: "subtotal", pnlClass: "", accounts: [] },
    { key: "c63", label: CLASS_LABEL["63"], amount: -r0(cls("63")), kind: "expense", pnlClass: "63", accounts: byAbs(accRows("63")) },
    { key: "ebit", label: "Bedrijfsresultaat (EBIT)", amount: r0(ebit), kind: "subtotal", pnlClass: "", accounts: [] },
    { key: "fin", label: "Financieel resultaat", amount: r0(finRes), kind: finRes >= 0 ? "income" : "expense", pnlClass: "65/75", accounts: finAccounts },
  ];
  if (Math.abs(excRes) >= 1) {
    pnl.push({ key: "exc", label: "Niet-recurrent resultaat", amount: r0(excRes), kind: excRes >= 0 ? "income" : "expense", pnlClass: "66/76", accounts: excAccounts });
  }
  pnl.push(
    { key: "rbt", label: "Resultaat vóór belastingen", amount: r0(resultBeforeTax), kind: "subtotal", pnlClass: "", accounts: [] },
    { key: "tax", label: "Belastingen", amount: -r0(taxes), kind: taxes >= 0 ? "expense" : "income", pnlClass: "67/77", accounts: taxAccounts },
    { key: "net", label: "Nettoresultaat", amount: r0(netResult), kind: "subtotal", pnlClass: "", accounts: [] },
  );

  const costStructure: CfoAccountRow[] = OP_EXPENSE
    .map((c) => ({ accountNumber: c, accountName: CLASS_LABEL[c], amount: r0(cls(c)) }))
    .filter((x) => x.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  const monthlyArr: CfoMonthPoint[] = [...monthly.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, v]) => ({
      month, revenue: r0(v.rev), costs: r0(v.cost), result: r0(v.rev - v.cost),
      byClass: Object.fromEntries(Object.entries(v.byClass).map(([c, x]) => [c, r0(x)])),
    }));

  const entities: CfoEntityRow[] = aggs
    .map((a) => {
      const rev = a.opIncome;
      const costs = OP_EXPENSE.reduce((s, c) => s + (a.byClass[c] || 0), 0);
      const result = rev - costs;
      return { code: a.code, companyName: a.name, revenue: r0(rev), costs: r0(costs), result: r0(result), marginPct: rev ? Math.round((result / rev) * 1000) / 10 : 0 };
    })
    .sort((a, b) => b.revenue - a.revenue);

  // ---- AP/AR aging (+ external split via IC name) — with drillable open items ----
  // Iterate per company (not the flat list) so every item keeps its firma-code and
  // can carry a BC deep-link. Per bucket only the largest ITEM_CAP items ship to
  // the client; itemCount/amount stay exact.
  const ITEM_CAP = 40;
  const apRowsAll: BCOpenAPRow[] = aggs.flatMap((a) => a.apRows);
  const arRowsAll: BCOpenARRow[] = aggs.flatMap((a) => a.arRows);

  const apB: Record<string, { all: number; ext: number; items: CfoAgingItem[] }> = {};
  let apOpen = 0, apOpenExtern = 0;
  for (const a of aggs) {
    for (const row of a.apRows) {
      const b = agingBucket(row.due, today);
      const ic = isIcName(row.vendor);
      (apB[b] = apB[b] || { all: 0, ext: 0, items: [] });
      apB[b].all += row.oweEUR; apB[b].ext += ic ? 0 : row.oweEUR;
      apB[b].items.push({
        name: row.vendor, company: a.code, docNo: row.docNo, due: row.due,
        amount: r0(row.oweEUR), ic, bcUrl: row.docNo ? vendorLedgerDocLink(a.code, row.docNo) : "",
      });
      apOpen += row.oweEUR; apOpenExtern += ic ? 0 : row.oweEUR;
    }
  }
  const apAging: CfoAgingBucket[] = AGING_ORDER.filter((b) => apB[b]).map((b) => ({
    label: b, amount: r0(apB[b].all), extern: r0(apB[b].ext),
    itemCount: apB[b].items.length,
    items: apB[b].items.sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount)).slice(0, ITEM_CAP),
  }));

  const arB: Record<string, { all: number; ext: number; items: CfoAgingItem[] }> = {};
  let arOpen = 0, arOpenExtern = 0;
  for (const a of aggs) {
    for (const row of a.arRows) {
      const b = agingBucket(row.due, today);
      const ic = isIcName(row.customer);
      (arB[b] = arB[b] || { all: 0, ext: 0, items: [] });
      arB[b].all += row.amount; arB[b].ext += ic ? 0 : row.amount;
      arB[b].items.push({
        name: row.customer, company: a.code, docNo: row.docNo, due: row.due,
        amount: r0(row.amount), ic, bcUrl: row.docNo ? salesInvoiceLink(a.code, row.docNo) : "",
      });
      arOpen += row.amount; arOpenExtern += ic ? 0 : row.amount;
    }
  }
  const arAging: CfoAgingBucket[] = AGING_ORDER.filter((b) => arB[b]).map((b) => ({
    label: b, amount: r0(arB[b].all), extern: r0(arB[b].ext),
    itemCount: arB[b].items.length,
    items: arB[b].items.sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount)).slice(0, ITEM_CAP),
  }));

  const cash = aggs.reduce((s, a) => s + a.cash, 0);
  const equity = aggs.reduce((s, a) => s + a.equity, 0);
  const fixedAssets = aggs.reduce((s, a) => s + a.fixedAssets, 0);
  const inventory = Math.max(aggs.reduce((s, a) => s + a.inventory, 0), 0);
  const equityPos = -equity;

  const elapsed = daysElapsed(from, today);
  const currentAssets = cash + arOpen + inventory;
  const currentLiab = apOpen;
  const totalAssetsApprox = fixedAssets + inventory + arOpen + cash;
  // DPO over inkopen (60/61/64) — bezoldigingen (62) en afschrijvingen (63) lopen
  // niet via leveranciers, meenemen zou DPO kunstmatig drukken.
  const purchases = cls("60") + cls("61") + cls("64");
  const ratios: CfoRatios = {
    currentRatio: currentLiab ? Math.round((currentAssets / currentLiab) * 100) / 100 : 0,
    quickRatio: currentLiab ? Math.round(((cash + arOpen) / currentLiab) * 100) / 100 : 0,
    solvencyPct: totalAssetsApprox ? Math.round((equityPos / totalAssetsApprox) * 1000) / 10 : 0,
    dso: income ? Math.round((arOpen / income) * elapsed) : 0,
    dpo: purchases ? Math.round((apOpen / purchases) * elapsed) : 0,
    dio: cls("60") ? Math.round((inventory / cls("60")) * elapsed) : 0,
    ccc: 0, approx: true,
  };
  ratios.ccc = ratios.dso + ratios.dio - ratios.dpo;

  const balanceSheet: CfoBalanceSheet = {
    assets: [
      { label: "Vaste activa (klasse 2)", amount: r0(fixedAssets), group: "asset" },
      { label: "Voorraden (klasse 3)", amount: r0(inventory), group: "asset" },
      { label: "Handelsvorderingen (klanten)", amount: r0(arOpen), group: "asset" },
      { label: "Liquide middelen (klasse 55)", amount: r0(cash), group: "asset" },
    ],
    claims: [
      { label: "Eigen vermogen (klasse 1)", amount: r0(equityPos), group: "equity" },
      { label: "Handelsschulden (leveranciers)", amount: r0(apOpen), group: "liability" },
    ],
    totalAssets: r0(totalAssetsApprox), totalClaims: r0(equityPos + apOpen), complete: false, asOf: to,
  };

  const weeklyPayroll = cls("62") / Math.max(1, elapsed / 7);
  const cashForecast = buildForecast(cash, arRowsAll, apRowsAll, weeklyPayroll, today);
  const budget = buildBudget(budgetTargets, income, totalCosts, ebit, elapsed, byClass);

  const kpis: CfoKpis = {
    revenue: r0(income), costs: r0(totalCosts), operatingResult: r0(ebit),
    operatingMarginPct: income ? Math.round((ebit / income) * 1000) / 10 : 0,
    ebitda: r0(ebitda), netResult: r0(netResult), cash: r0(cash), apOpen: r0(apOpen), arOpen: r0(arOpen),
    apOpenExtern: r0(apOpenExtern), arOpenExtern: r0(arOpenExtern),
  };

  const sources = [
    { label: "Winst & verlies", detail: "BC grootboek, PCMN-klasse 6 & 7 (excl. resultaatverwerking 68/69/78/79), postingDate in de periode. Klik een balk voor de onderliggende rekeningen. ΔPY = zelfde periode vorig jaar." },
    { label: "Cash & balans", detail: "Nettosaldo grootboekklassen: 55 (bank), 1 (eigen vermogen), 2 (vaste activa), 3 (voorraden). Volledige balans (kl. 4/5) via de gematerialiseerde snapshot." },
    { label: "Openstaand leveranciers (AP)", detail: "Open leveranciersposten (VendorLedgerEntries), −Remaining_Amt_LCY, gebucket op vervaldatum. IC = intercompany (naam-match)." },
    { label: "Openstaand klanten (AR)", detail: "Open verkoopfacturen (salesInvoices, remainingAmount), gebucket op vervaldatum." },
    { label: "Cashflowprognose", detail: "Directe methode: openingssaldo + AR-inning − AP-betaling − loon, 13 weken rollend op vervaldatum." },
  ];
  const notes: string[] = [];
  notes.push("P&L t/m nettoresultaat (financieel 65/75, niet-recurrent 66/76, belastingen 67/77); resultaatverwerking (68/69/78/79) uitgesloten.");
  // Interim-caveats (data-gedreven): bij Gheeraert worden afschrijvingen en belastingen
  // grotendeels op jaareinde geboekt — zonder deze noten oogt YTD-winst geflatteerd.
  if (isLive && cls("63") < 0.02 * Math.max(income, 1)) {
    notes.push("LET OP: afschrijvingen (klasse 63) zijn YTD amper geboekt (jaareinde-boeking) — EBIT en nettoresultaat zijn daardoor geflatteerd.");
  }
  if (isLive && Math.abs(cls("67") - cls("77")) < 1000) {
    notes.push("LET OP: belastingen (klasse 67) zijn nog niet geboekt (jaareinde) — nettoresultaat is vóór effectieve belastingdruk.");
  }
  notes.push("Ratio's: vlottende schulden ≈ handelsschulden (geen volledige korte-termijnschuld-split); balans condensed tot betrouwbare posten.");
  notes.push("DSO/DPO: open posten zijn incl. btw, omzet/inkopen excl. btw — dagenwaarden zijn daardoor licht overschat (btw-mix transport deels 0%/verlegd). DPO = op inkopen (60/61/64).");
  notes.push("Bedragen bruto per vennootschap — intercompany-eliminatie via de IC-schakelaar (naam-gebaseerd op AP/AR; P&L-IC vereist dimensies).");

  return {
    period: { from, to, label }, company, isLive, generatedAt: new Date().toISOString(),
    kpis, pnl, costStructure, monthly: monthlyArr, apAging, entities, sources, notes,
    arAging, ratios, balanceSheet, cashForecast, budget, prevYear,
  };
}

// ============================================================
// Public getter
// ============================================================

// One in-flight build per cache key: dedupes concurrent cold loads AND backs the
// fire-and-forget background refresh (?refresh=1 on a warm cache).
const inflightCfo = new Map<string, Promise<CfoFinancials>>();

// Per-company bundle (aggregate + PY totals + account names), individually cached.
// The combine step is pure/instant, so any consolidation SCOPE (exclude one or more
// entities) is served from these bundles without re-pulling BC — a scope change on a
// warm cache costs ~0s instead of a 2-minute rebuild that Cloudflare would kill.
interface CompanyBundle { agg: CompanyAgg; pyTotals: CfoPrevYear; names: Record<string, string> }

async function buildCompanyBundle(
  c: { id: string; code: string; name: string }, f: string, t: string, pyCutoff: string
): Promise<CompanyBundle> {
  // v2: rijvorm gewijzigd (docNo op AP/AR, byClass op monthly) — nieuwe prefix zodat
  // een oude in-memory bundle nooit met de nieuwe vorm mengt.
  const key = `cfo-co2-${c.id}-${f}-${t}`;
  const cached = getCache<CompanyBundle>(key);
  if (cached) return cached;
  const pyF = shiftYear(f, -1), pyT = shiftYear(t, -1);
  const [rows, pyRows, nameMap, cash, ap, ar, equity, fixedAssets, inventory] = await Promise.all([
    fetchBCPnlRows(c.id, f, t),
    fetchBCPnlRows(c.id, pyF, pyT).catch(() => [] as BCPnlRow[]),
    fetchBCAccountNames(c.id).catch(() => ({} as Record<string, string>)),
    fetchBCCashBalance(c.id).catch(() => 0),
    fetchBCOpenAP(c.code).catch(() => [] as BCOpenAPRow[]),
    fetchBCOpenAR(c.id).catch(() => [] as BCOpenARRow[]),
    fetchBCClassNetBalance(c.id, "1").catch(() => 0),
    fetchBCClassNetBalance(c.id, "2").catch(() => 0),
    fetchBCClassNetBalance(c.id, "3").catch(() => 0),
  ]);
  // PY meteen tot 4 totalen reduceren — NOOIT alle rauwe PY-rijen bewaren of
  // spreiden (push(...100k rijen) = "Maximum call stack size exceeded").
  const pyTotals = computePnlTotals(pyRows.filter((r) => r.postingDate <= pyCutoff));
  const bundle: CompanyBundle = {
    agg: aggregateCompany(c.code, c.name, rows, { cash, equity, fixedAssets, inventory, apRows: ap, arRows: ar }),
    pyTotals,
    names: nameMap,
  };
  setCache(key, bundle, 720); // 12h, zelfde levensduur als het gecombineerde resultaat
  return bundle;
}

async function buildLiveCfo(
  company: string, f: string, t: string, label: string, cacheKey: string, exclude: string[] = []
): Promise<CfoFinancials> {
  const raw = await fetchBCCompanies();
  const companies = raw
    .map((c) => ({ id: String(c.id), code: String(c.name), name: String(c.displayName || c.name) }))
    .filter((c) => isOperatingCompany(c.code));
  let targets = company === "all"
    ? companies
    : companies.filter((c) => c.id === company || c.code === company || c.name === company);
  // Consolidatiescope: expliciet uitgesloten vennootschappen (alleen zinvol op "all").
  const excluded = company === "all" ? exclude.filter((x) => companies.some((c) => c.code === x)) : [];
  if (excluded.length) targets = targets.filter((c) => !excluded.includes(c.code));
  if (!targets.length) throw new Error(`geen vennootschap gevonden voor "${company}"`);

  const settings = await getAppSettings().catch(() => null);
  const budgetTargets: BudgetTargets = {
    rev: settings?.cfoRevenueTarget || 0,
    cost: settings?.cfoCostTarget || 0,
    byClass: settings?.cfoClassTargets || {},
  };
  const names: Record<string, string> = {};
  const today = new Date();
  // ΔPY: same period last year, capped at "today minus 1 year" so YTD compares like-for-like.
  const pyCutoff = shiftYear(today.toISOString().slice(0, 10), -1);
  const pyAcc: CfoPrevYear = { revenue: 0, ebitda: 0, ebit: 0, netResult: 0 };

  // Process companies in small batches: 11 × 9 concurrent BC calls at once holds two
  // full-year GL datasets in RAM simultaneously (the earlier stack/memory blow-up).
  const aggs: CompanyAgg[] = [];
  const CHUNK = 3;
  for (let i = 0; i < targets.length; i += CHUNK) {
    const batch = targets.slice(i, i + CHUNK);
    const part = await Promise.all(batch.map((c) => buildCompanyBundle(c, f, t, pyCutoff)));
    for (const b of part) {
      Object.assign(names, b.names);
      pyAcc.revenue += b.pyTotals.revenue; pyAcc.ebitda += b.pyTotals.ebitda;
      pyAcc.ebit += b.pyTotals.ebit; pyAcc.netResult += b.pyTotals.netResult;
      aggs.push(b.agg);
    }
  }

  // ΔPY alleen tonen als vorig jaar VOLLEDIG in BC staat: 2025 is het migratiejaar
  // (vroege 2025-boekingen zitten in de uitgesloten _OPSTART-kopieën), dus een
  // "+120% vs vorig jaar"-chip zou misleidend zijn. Heuristiek: PY-omzet < 50% van
  // de huidige omzet in een gelijke periode = onvolledig → chips verbergen.
  const curIncome = aggs.reduce((s, a) => s + a.opIncome, 0);
  const pyReliable = pyAcc.revenue >= 0.5 * curIncome;
  const result = combine(aggs, names, company, f, t, label, true, today, budgetTargets, pyReliable ? pyAcc : undefined);
  result.scope = { all: companies.map((c) => ({ code: c.code, name: c.name })), excluded };
  if (excluded.length) {
    result.notes.push(`Consolidatiescope: ${excluded.join(", ")} uitgesloten — alle cijfers (P&L, cash, AP/AR, ratio's) volgen de scope.`);
  }
  if (!pyReliable) {
    result.notes.push("ΔPY-vergelijking verborgen: 2025 staat onvolledig in Business Central (migratiejaar — vroege 2025-boekingen zitten in de _OPSTART-kopieën). Vanaf boekjaar 2027 verschijnt de vergelijking automatisch.");
  }
  setCache(cacheKey, result, 720); // 12h — verse pull via de vernieuwen-link of pod-herstart

  // Auto-snapshot: één per dag per view (fire-and-forget; alleen mét Postgres).
  // Zo groeit vanzelf een reproduceerbare historiek "cijfers zoals op dag X".
  import("./cfo-store").then(async (store) => {
    if (!store.snapshotEnabled()) return;
    const excludedStr = (result.scope?.excluded || []).join(",");
    if (!(await store.hasSnapshotToday(company, excludedStr))) {
      await store.saveCfoSnapshot(result, false);
    }
  }).catch((e) => console.warn("cfo auto-snapshot failed:", e));

  return result;
}

export async function getCfoFinancials(
  company: string = "all", from?: string, to?: string, force = false, exclude: string[] = []
): Promise<CfoFinancials> {
  const today = new Date();
  const year = today.getUTCFullYear();
  const f = from || `${year}-01-01`;
  // Einde = vandaag (echte YTD), NIET 31/12: het grootboek bevat al vooruit-gedateerde
  // boekingen (probe 23/07/2026: max postingDate 01/12/2026) die anders stil in de
  // "YTD"-cijfers meetellen. Expliciete ?to= blijft mogelijk voor een vaste periode.
  const t = to || today.toISOString().slice(0, 10);
  // Label volgt de werkelijke periode: default = YTD; expliciete range = "dd/mm – dd/mm/jjjj".
  const fmtD = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
  const label = !from && !to
    ? `FY ${year} (YTD)`
    : `${fmtD(f)} – ${fmtD(t)}/${t.slice(0, 4)}`;

  const excl = [...new Set(exclude.map((x) => x.trim().toUpperCase()).filter(Boolean))].sort();
  if (isDemoMode()) return demoCfo(company, f, t, label, excl);

  const cacheKey = `cfo-${company}-${f}-${t}-x:${excl.join(",")}`;
  const cached = getCache<CfoFinancials>(cacheKey);
  if (cached && !force) return cached;

  // Warm cache + expliciete refresh: achtergrond-rebuild starten en de bestaande
  // data meteen teruggeven (Cloudflare kapt requests >100s af — nooit blokkeren).
  if (cached && force) {
    if (!inflightCfo.has(cacheKey)) {
      const p = buildLiveCfo(company, f, t, label, cacheKey, excl).finally(() => inflightCfo.delete(cacheKey));
      inflightCfo.set(cacheKey, p);
      p.catch((e) => console.error("cfo background refresh failed:", e));
    }
    return { ...cached, refreshing: true };
  }

  // Koude lading — gededuped zodat gelijktijdige bezoekers één build delen.
  try {
    let p = inflightCfo.get(cacheKey);
    if (!p) {
      p = buildLiveCfo(company, f, t, label, cacheKey, excl).finally(() => inflightCfo.delete(cacheKey));
      inflightCfo.set(cacheKey, p);
    }
    return await p;
  } catch (err) {
    console.error("getCfoFinancials live fetch failed, serving demo:", err);
    const d = demoCfo(company, f, t, label, excl);
    return { ...d, loadError: String(err).slice(0, 250) };
  }
}

// ============================================================
// Demo / sample data (grounded in the real group order-of-magnitude)
// ============================================================
function demoCfo(company: string, from: string, to: string, label: string, exclude: string[] = []): CfoFinancials {
  const acc = (n: string, name: string, a: number): CfoAccountRow => ({ accountNumber: n, accountName: name, amount: a });
  const c60 = 4_180_000, c61 = 14_820_000, c62 = 8_940_000, c63 = 1_810_000, c64 = 910_000;
  const income = 32_410_000;
  const ebitda = income - (c60 + c61 + c62 + c64);
  const ebit = ebitda - c63;
  const finRes = -412_000, excRes = 58_000, taxes = 486_000;
  const rbt = ebit + finRes + excRes;
  const net = rbt - taxes;
  const pnl: CfoPnlLine[] = [
    { key: "revenue", label: "Bedrijfsopbrengsten", amount: income, kind: "income", pnlClass: "70", accounts: [
      acc("700000", "Omzet transport", 27_650_000), acc("700100", "Omzet logistiek/warehousing", 3_120_000), acc("740000", "Andere bedrijfsopbrengsten", 1_640_000),
    ] },
    { key: "c60", label: CLASS_LABEL["60"], amount: -c60, kind: "expense", pnlClass: "60", accounts: [
      acc("604000", "Handelsgoederen", 2_360_000), acc("600000", "Grond- & hulpstoffen", 1_820_000),
    ] },
    { key: "c61", label: CLASS_LABEL["61"], amount: -c61, kind: "expense", pnlClass: "61", accounts: [
      acc("612100", "Brandstof (diesel)", 6_240_000), acc("610400", "Onderaannemers vervoer", 4_180_000), acc("611000", "Tol & wegenheffing", 1_930_000), acc("613200", "Onderhoud & herstel", 1_240_000), acc("613300", "IT & externe diensten", 620_000), acc("610200", "Huur gebouwen & terreinen", 610_000),
    ] },
    { key: "c62", label: CLASS_LABEL["62"], amount: -c62, kind: "expense", pnlClass: "62", accounts: [
      acc("620000", "Bezoldigingen", 6_410_000), acc("621000", "Werkgevers-RSZ", 1_720_000), acc("623000", "Andere personeelskosten", 810_000),
    ] },
    { key: "c64", label: CLASS_LABEL["64"], amount: -c64, kind: "expense", pnlClass: "64", accounts: [
      acc("640000", "Bedrijfsbelastingen", 520_000), acc("649000", "Diverse bedrijfskosten", 390_000),
    ] },
    { key: "ebitda", label: "EBITDA", amount: ebitda, kind: "subtotal", pnlClass: "", accounts: [] },
    { key: "c63", label: CLASS_LABEL["63"], amount: -c63, kind: "expense", pnlClass: "63", accounts: [
      acc("630000", "Afschrijvingen rollend materieel", 1_360_000), acc("630200", "Afschrijvingen gebouwen", 300_000), acc("631000", "Waardeverminderingen", 150_000),
    ] },
    { key: "ebit", label: "Bedrijfsresultaat (EBIT)", amount: ebit, kind: "subtotal", pnlClass: "", accounts: [] },
    { key: "fin", label: "Financieel resultaat", amount: finRes, kind: "expense", pnlClass: "65/75", accounts: [
      acc("650000", "Rente kredieten & leasing", -365_000), acc("650090", "Bankkosten", -78_000), acc("756000", "Diverse financiële opbrengsten", 31_000),
    ] },
    { key: "exc", label: "Niet-recurrent resultaat", amount: excRes, kind: "income", pnlClass: "66/76", accounts: [
      acc("763000", "Meerwaarde verkoop activa", 96_000), acc("664000", "Niet-recurrente kosten", -38_000),
    ] },
    { key: "rbt", label: "Resultaat vóór belastingen", amount: rbt, kind: "subtotal", pnlClass: "", accounts: [] },
    { key: "tax", label: "Belastingen", amount: -taxes, kind: "expense", pnlClass: "67/77", accounts: [
      acc("670200", "Geraamde belastingen", -486_000),
    ] },
    { key: "net", label: "Nettoresultaat", amount: net, kind: "subtotal", pnlClass: "", accounts: [] },
  ];
  const costStructure: CfoAccountRow[] = [
    { accountNumber: "61", accountName: CLASS_LABEL["61"], amount: c61 },
    { accountNumber: "62", accountName: CLASS_LABEL["62"], amount: c62 },
    { accountNumber: "60", accountName: CLASS_LABEL["60"], amount: c60 },
    { accountNumber: "63", accountName: CLASS_LABEL["63"], amount: c63 },
    { accountNumber: "64", accountName: CLASS_LABEL["64"], amount: c64 },
  ];
  const monthLabels = ["01", "02", "03", "04", "05", "06"];
  const yr = from.slice(0, 4);
  const monthly: CfoMonthPoint[] = monthLabels.map((m, i) => {
    const rev = Math.round((income / 6) * (0.92 + i * 0.03));
    const cost = Math.round(((c60 + c61 + c62 + c63 + c64) / 6) * (0.94 + i * 0.02));
    // Per-klasse spreiding met een lichte variatie zodat de heatmap iets te zien geeft.
    const wob = (base: number, j: number) => Math.round((base / 6) * (0.85 + ((i * 3 + j * 5) % 7) * 0.05));
    return {
      month: `${yr}-${m}`, revenue: rev, costs: cost, result: rev - cost,
      byClass: { "60": wob(c60, 0), "61": wob(c61, 1), "62": wob(c62, 2), "63": wob(c63, 3), "64": wob(c64, 4) },
    };
  });
  // Voorbeeld-openposten per bucket, met BC-links in het echte formaat.
  const demoApItems = (n: number, base: number): CfoAgingItem[] =>
    Array.from({ length: 5 }, (_, j) => {
      const co = ["GTR", "GDI", "WHS"][j % 3];
      const doc = `26${n}${String(40250 + j * 17)}`;
      const ic = j === 4;
      return { name: ic ? "Gheeraert Garage NV" : `Leverancier ${n * 5 + j}`, company: co, docNo: doc, due: iso(addDays(new Date(), -n * 22 + j * 3)), amount: Math.round(base * (1 - j * 0.15)), ic, bcUrl: vendorLedgerDocLink(co, doc) };
    });
  const demoArItems = (n: number, base: number): CfoAgingItem[] =>
    Array.from({ length: 5 }, (_, j) => {
      const co = ["GDI", "GTR", "TDR"][j % 3];
      const doc = `1221103${String(52 + n * 7 + j)}`;
      const ic = j === 4;
      return { name: ic ? "Gheeraert Distribution NV" : `Klant ${n * 5 + j}`, company: co, docNo: doc, due: iso(addDays(new Date(), -n * 22 + j * 3)), amount: Math.round(base * (1 - j * 0.15)), ic, bcUrl: salesInvoiceLink(co, doc) };
    });
  const apAging: CfoAgingBucket[] = [
    { label: "Niet vervallen", amount: 3_121_142, extern: 2_530_000, itemCount: 212, items: demoApItems(0, 310_000) },
    { label: "< 30d", amount: 2_701_919, extern: 2_140_000, itemCount: 178, items: demoApItems(1, 270_000) },
    { label: "< 60d", amount: 2_123_483, extern: 1_680_000, itemCount: 143, items: demoApItems(2, 220_000) },
    { label: "< 90d", amount: 1_239_009, extern: 940_000, itemCount: 96, items: demoApItems(3, 140_000) },
    { label: "> 90d", amount: 3_063_609, extern: 709_345, itemCount: 251, items: demoApItems(4, 350_000) },
  ];
  const entities: CfoEntityRow[] = [
    { code: "GDI", companyName: "Gheeraert Distribution NV", revenue: 9_540_000, costs: 9_010_000, result: 530_000, marginPct: 5.6 },
    { code: "GTR", companyName: "Gheeraert Transport NV", revenue: 9_180_000, costs: 8_760_000, result: 420_000, marginPct: 4.6 },
    { code: "GTG", companyName: "Gheeraert Garage NV", revenue: 3_020_000, costs: 2_760_000, result: 260_000, marginPct: 8.6 },
    { code: "TDR", companyName: "Transport De Rudder BV", revenue: 2_540_000, costs: 2_430_000, result: 110_000, marginPct: 4.3 },
    { code: "WHS", companyName: "Warehouse BV", revenue: 1_980_000, costs: 1_760_000, result: 220_000, marginPct: 11.1 },
    { code: "GRE", companyName: "Gheeraert Renting BV", revenue: 1_520_000, costs: 1_390_000, result: 130_000, marginPct: 8.6 },
    { code: "LMB", companyName: "Vervoer Marcel Lamberts BV", revenue: 950_000, costs: 910_000, result: 40_000, marginPct: 4.2 },
    { code: "GPR", companyName: "Gheeraert Property NV", revenue: 1_090_000, costs: 640_000, result: 450_000, marginPct: 41.3 },
    { code: "GSS", companyName: "Gheeraert Shared Services BV", revenue: 810_000, costs: 720_000, result: 90_000, marginPct: 11.1 },
    { code: "GEX", companyName: "Gheeraert Express BV", revenue: 1_390_000, costs: 1_330_000, result: 60_000, marginPct: 4.3 },
    { code: "TFO", companyName: "Trans-form BV", revenue: 390_000, costs: 370_000, result: 20_000, marginPct: 5.1 },
  ];
  const today = new Date();
  const demoAR: BCOpenARRow[] = [];
  const demoAP: BCOpenAPRow[] = [];
  for (let i = 0; i < 34; i++) {
    demoAR.push({ amount: 90_000 + (i % 6) * 45_000, due: iso(addDays(today, i * 3 - 14)), customer: i % 7 === 0 ? "Gheeraert Distribution NV" : `Klant ${i}`, docNo: `1221104${String(10 + i)}` });
    demoAP.push({ oweEUR: 70_000 + (i % 5) * 55_000, due: iso(addDays(today, i * 3 - 18)), vendor: i % 6 === 0 ? "Gheeraert Garage NV" : `Leverancier ${i}`, docNo: `26${String(50100 + i)}` });
  }
  const cashForecast = buildForecast(1_178_550, demoAR, demoAP, 315_000, today);
  const budget = buildBudget(
    { rev: 66_000_000, cost: 62_000_000, byClass: { "61": 30_000_000, "62": 18_500_000 } },
    income, c60 + c61 + c62 + c63 + c64, ebit, daysElapsed(from, today),
    { "60": c60, "61": c61, "62": c62, "63": c63, "64": c64 }
  );
  const arAging: CfoAgingBucket[] = [
    { label: "Niet vervallen", amount: 4_180_000, extern: 3_620_000, itemCount: 168, items: demoArItems(0, 420_000) },
    { label: "< 30d", amount: 2_060_000, extern: 1_840_000, itemCount: 121, items: demoArItems(1, 210_000) },
    { label: "< 60d", amount: 1_290_000, extern: 1_120_000, itemCount: 84, items: demoArItems(2, 130_000) },
    { label: "< 90d", amount: 780_000, extern: 700_000, itemCount: 52, items: demoArItems(3, 80_000) },
    { label: "> 90d", amount: 1_170_000, extern: 980_000, itemCount: 73, items: demoArItems(4, 120_000) },
  ];
  const ratios: CfoRatios = { currentRatio: 0.9, quickRatio: 0.87, solvencyPct: 26.4, dso: 57, dpo: 78, dio: 12, ccc: -9, approx: true };
  const balanceSheet: CfoBalanceSheet = {
    assets: [
      { label: "Vaste activa (klasse 2)", amount: 21_100_000, group: "asset" },
      { label: "Voorraden (klasse 3)", amount: 410_000, group: "asset" },
      { label: "Handelsvorderingen (klanten)", amount: 9_480_000, group: "asset" },
      { label: "Liquide middelen (klasse 55)", amount: 1_178_550, group: "asset" },
    ],
    claims: [
      { label: "Eigen vermogen (klasse 1)", amount: 12_918_550, group: "equity" },
      { label: "Financiële & overige schulden", amount: 7_000_000, group: "liability" },
      { label: "Handelsschulden (leveranciers)", amount: 12_250_000, group: "liability" },
    ],
    totalAssets: 32_168_550, totalClaims: 32_168_550, complete: false, asOf: to,
  };
  const kpis: CfoKpis = {
    revenue: income, costs: c60 + c61 + c62 + c63 + c64, operatingResult: ebit,
    operatingMarginPct: Math.round((ebit / income) * 1000) / 10, ebitda, netResult: net,
    cash: 1_178_550, apOpen: 12_249_162, arOpen: 9_480_000, apOpenExtern: 7_999_345, arOpenExtern: 8_260_000,
  };
  const prevYear: CfoPrevYear = { revenue: 30_120_000, ebitda: 3_310_000, ebit: 1_620_000, netResult: 890_000 };
  const demoNotes = [
    "Voorbeelddata (demomodus) — orde van grootte gebaseerd op de echte groep.",
    "P&L t/m nettoresultaat; resultaatverwerking (68/69/78/79) uitgesloten.",
  ];
  if (exclude.length) {
    demoNotes.push(`Demomodus: scope-uitsluiting (${exclude.join(", ")}) wordt hier NIET doorgerekend — de voorbeeldcijfers blijven ongewijzigd.`);
  }
  return {
    period: { from, to, label }, company, isLive: false, generatedAt: new Date(0).toISOString(),
    kpis, pnl, costStructure, monthly, apAging, entities, arAging, ratios, balanceSheet, cashForecast, budget, prevYear,
    scope: { all: entities.map((e) => ({ code: e.code, name: e.companyName })), excluded: exclude },
    sources: [
      { label: "Winst & verlies", detail: "BC grootboek, PCMN-klasse 6 & 7 t/m nettoresultaat. Klik een balk voor de onderliggende rekeningen." },
      { label: "Cash & balans", detail: "Nettosaldo klasse 55 (banken), 1, 2, 3." },
      { label: "Openstaand leveranciers (AP)", detail: "Open leveranciersposten, gebucket op vervaldatum." },
      { label: "Openstaand klanten (AR)", detail: "Open verkoopfacturen (remainingAmount)." },
      { label: "Cashflowprognose", detail: "Directe methode, 13 weken rollend." },
    ],
    notes: demoNotes,
  };
}
