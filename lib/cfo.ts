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
  CfoRatios, CfoBalanceSheet, CfoCashForecast, CfoCashWeek, CfoBudget, CfoPrevYear,
} from "./types";
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
interface CompanyAgg extends CompanyExtras {
  code: string;
  name: string;
  opIncome: number;                                     // operating income only
  byClass: Record<string, number>;                      // per 2-digit class, signed by kind
  accountsByClass: Record<string, Map<string, number>>; // class → (accountNumber → amount)
  monthly: Map<string, { rev: number; cost: number }>;  // operating only
}

function aggregateCompany(
  code: string, name: string, rows: BCPnlRow[], extras: CompanyExtras
): CompanyAgg {
  const byClass: Record<string, number> = {};
  const accountsByClass: Record<string, Map<string, number>> = {};
  const monthly = new Map<string, { rev: number; cost: number }>();
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
      const m = monthly.get(month) || { rev: 0, cost: 0 };
      if (rv.kind === "income") { opIncome += rv.val; m.rev += rv.val; }
      else m.cost += rv.val;
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

function buildBudget(
  targets: { rev: number; cost: number }, income: number, costs: number, ebit: number, elapsed: number
): CfoBudget {
  if (!targets.rev && !targets.cost) {
    return { configured: false, revenueTarget: 0, costTarget: 0, monthlyRevenueTarget: 0, monthlyCostTarget: 0, revenueVariancePct: 0, resultVariancePct: 0 };
  }
  const frac = Math.min(1, elapsed / 365);
  const proRataRev = targets.rev * frac, proRataResult = (targets.rev - targets.cost) * frac;
  return {
    configured: true, revenueTarget: targets.rev, costTarget: targets.cost,
    monthlyRevenueTarget: r0(targets.rev / 12), monthlyCostTarget: r0(targets.cost / 12),
    revenueVariancePct: proRataRev ? Math.round(((income - proRataRev) / proRataRev) * 1000) / 10 : 0,
    resultVariancePct: proRataResult ? Math.round(((ebit - proRataResult) / proRataResult) * 1000) / 10 : 0,
  };
}

function combine(
  aggs: CompanyAgg[], names: Record<string, string>, company: string,
  from: string, to: string, label: string, isLive: boolean, today: Date,
  budgetTargets: { rev: number; cost: number }, prevYear?: CfoPrevYear
): CfoFinancials {
  const income = aggs.reduce((s, a) => s + a.opIncome, 0);
  const byClass: Record<string, number> = {};
  const accountsByClass: Record<string, Map<string, number>> = {};
  const monthly = new Map<string, { rev: number; cost: number }>();
  for (const a of aggs) {
    for (const [c, v] of Object.entries(a.byClass)) byClass[c] = (byClass[c] || 0) + v;
    for (const [c, m] of Object.entries(a.accountsByClass)) {
      const dst = (accountsByClass[c] = accountsByClass[c] || new Map());
      for (const [acc, v] of m) dst.set(acc, (dst.get(acc) || 0) + v);
    }
    for (const [mo, v] of a.monthly) {
      const cur = monthly.get(mo) || { rev: 0, cost: 0 };
      cur.rev += v.rev; cur.cost += v.cost; monthly.set(mo, cur);
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
    .map(([month, v]) => ({ month, revenue: r0(v.rev), costs: r0(v.cost), result: r0(v.rev - v.cost) }));

  const entities: CfoEntityRow[] = aggs
    .map((a) => {
      const rev = a.opIncome;
      const costs = OP_EXPENSE.reduce((s, c) => s + (a.byClass[c] || 0), 0);
      const result = rev - costs;
      return { code: a.code, companyName: a.name, revenue: r0(rev), costs: r0(costs), result: r0(result), marginPct: rev ? Math.round((result / rev) * 1000) / 10 : 0 };
    })
    .sort((a, b) => b.revenue - a.revenue);

  // ---- AP aging (+ external split via IC vendor name) ----
  const apRowsAll: BCOpenAPRow[] = aggs.flatMap((a) => a.apRows);
  const arRowsAll: BCOpenARRow[] = aggs.flatMap((a) => a.arRows);
  const apB: Record<string, { all: number; ext: number }> = {};
  let apOpen = 0, apOpenExtern = 0;
  for (const row of apRowsAll) {
    const b = agingBucket(row.due, today);
    const ext = isIcName(row.vendor) ? 0 : row.oweEUR;
    (apB[b] = apB[b] || { all: 0, ext: 0 }); apB[b].all += row.oweEUR; apB[b].ext += ext;
    apOpen += row.oweEUR; apOpenExtern += ext;
  }
  const apAging: CfoAgingBucket[] = AGING_ORDER.filter((b) => apB[b]).map((b) => ({ label: b, amount: r0(apB[b].all), extern: r0(apB[b].ext) }));

  const arB: Record<string, { all: number; ext: number }> = {};
  let arOpen = 0, arOpenExtern = 0;
  for (const row of arRowsAll) {
    const b = agingBucket(row.due, today);
    const ext = isIcName(row.customer) ? 0 : row.amount;
    (arB[b] = arB[b] || { all: 0, ext: 0 }); arB[b].all += row.amount; arB[b].ext += ext;
    arOpen += row.amount; arOpenExtern += ext;
  }
  const arAging: CfoAgingBucket[] = AGING_ORDER.filter((b) => arB[b]).map((b) => ({ label: b, amount: r0(arB[b].all), extern: r0(arB[b].ext) }));

  const cash = aggs.reduce((s, a) => s + a.cash, 0);
  const equity = aggs.reduce((s, a) => s + a.equity, 0);
  const fixedAssets = aggs.reduce((s, a) => s + a.fixedAssets, 0);
  const inventory = Math.max(aggs.reduce((s, a) => s + a.inventory, 0), 0);
  const equityPos = -equity;

  const elapsed = daysElapsed(from, today);
  const currentAssets = cash + arOpen + inventory;
  const currentLiab = apOpen;
  const totalAssetsApprox = fixedAssets + inventory + arOpen + cash;
  const ratios: CfoRatios = {
    currentRatio: currentLiab ? Math.round((currentAssets / currentLiab) * 100) / 100 : 0,
    quickRatio: currentLiab ? Math.round(((cash + arOpen) / currentLiab) * 100) / 100 : 0,
    solvencyPct: totalAssetsApprox ? Math.round((equityPos / totalAssetsApprox) * 1000) / 10 : 0,
    dso: income ? Math.round((arOpen / income) * elapsed) : 0,
    dpo: totalCosts ? Math.round((apOpen / totalCosts) * elapsed) : 0,
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
  const budget = buildBudget(budgetTargets, income, totalCosts, ebit, elapsed);

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
  notes.push("Ratio's: vlottende schulden ≈ handelsschulden (geen volledige korte-termijnschuld-split); balans condensed tot betrouwbare posten.");
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
export async function getCfoFinancials(
  company: string = "all", from?: string, to?: string, force = false
): Promise<CfoFinancials> {
  const year = new Date().getUTCFullYear();
  const f = from || `${year}-01-01`;
  const t = to || `${year}-12-31`;
  const label = `FY ${year} (YTD)`;

  if (isDemoMode()) return demoCfo(company, f, t, label);

  const cacheKey = `cfo-${company}-${f}-${t}`;
  if (!force) {
    const cached = getCache<CfoFinancials>(cacheKey);
    if (cached) return cached;
  }

  try {
    const raw = await fetchBCCompanies();
    const companies = raw
      .map((c) => ({ id: String(c.id), code: String(c.name), name: String(c.displayName || c.name) }))
      .filter((c) => isOperatingCompany(c.code));
    const targets = company === "all"
      ? companies
      : companies.filter((c) => c.id === company || c.code === company || c.name === company);
    if (!targets.length) return demoCfo(company, f, t, label);

    const settings = await getAppSettings().catch(() => null);
    const budgetTargets = { rev: settings?.cfoRevenueTarget || 0, cost: settings?.cfoCostTarget || 0 };
    const names: Record<string, string> = {};
    const today = new Date();
    const pyF = shiftYear(f, -1), pyT = shiftYear(t, -1);
    const pyAll: BCPnlRow[] = [];
    const aggs = await Promise.all(targets.map(async (c) => {
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
      Object.assign(names, nameMap);
      pyAll.push(...pyRows);
      return aggregateCompany(c.code, c.name, rows, { cash, equity, fixedAssets, inventory, apRows: ap, arRows: ar });
    }));

    // ΔPY: same period last year, capped at "today minus 1 year" so YTD compares like-for-like.
    const pyCutoff = shiftYear(today.toISOString().slice(0, 10), -1);
    const prevYear = computePnlTotals(pyAll.filter((r) => r.postingDate <= pyCutoff));

    const result = combine(aggs, names, company, f, t, label, true, today, budgetTargets, prevYear);
    setCache(cacheKey, result, 120);
    return result;
  } catch (err) {
    console.error("getCfoFinancials live fetch failed, serving demo:", err);
    return demoCfo(company, f, t, label);
  }
}

// ============================================================
// Demo / sample data (grounded in the real group order-of-magnitude)
// ============================================================
function demoCfo(company: string, from: string, to: string, label: string): CfoFinancials {
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
    return { month: `${yr}-${m}`, revenue: rev, costs: cost, result: rev - cost };
  });
  const apAging: CfoAgingBucket[] = [
    { label: "Niet vervallen", amount: 3_121_142, extern: 2_530_000 },
    { label: "< 30d", amount: 2_701_919, extern: 2_140_000 },
    { label: "< 60d", amount: 2_123_483, extern: 1_680_000 },
    { label: "< 90d", amount: 1_239_009, extern: 940_000 },
    { label: "> 90d", amount: 3_063_609, extern: 709_345 },
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
    demoAR.push({ amount: 90_000 + (i % 6) * 45_000, due: iso(addDays(today, i * 3 - 14)), customer: i % 7 === 0 ? "Gheeraert Distribution NV" : `Klant ${i}` });
    demoAP.push({ oweEUR: 70_000 + (i % 5) * 55_000, due: iso(addDays(today, i * 3 - 18)), vendor: i % 6 === 0 ? "Gheeraert Garage NV" : `Leverancier ${i}` });
  }
  const cashForecast = buildForecast(1_178_550, demoAR, demoAP, 315_000, today);
  const budget = buildBudget({ rev: 66_000_000, cost: 62_000_000 }, income, c60 + c61 + c62 + c63 + c64, ebit, daysElapsed(from, today));
  const arAging: CfoAgingBucket[] = [
    { label: "Niet vervallen", amount: 4_180_000, extern: 3_620_000 },
    { label: "< 30d", amount: 2_060_000, extern: 1_840_000 },
    { label: "< 60d", amount: 1_290_000, extern: 1_120_000 },
    { label: "< 90d", amount: 780_000, extern: 700_000 },
    { label: "> 90d", amount: 1_170_000, extern: 980_000 },
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
  return {
    period: { from, to, label }, company, isLive: false, generatedAt: new Date(0).toISOString(),
    kpis, pnl, costStructure, monthly, apAging, entities, arAging, ratios, balanceSheet, cashForecast, budget, prevYear,
    sources: [
      { label: "Winst & verlies", detail: "BC grootboek, PCMN-klasse 6 & 7 t/m nettoresultaat. Klik een balk voor de onderliggende rekeningen." },
      { label: "Cash & balans", detail: "Nettosaldo klasse 55 (banken), 1, 2, 3." },
      { label: "Openstaand leveranciers (AP)", detail: "Open leveranciersposten, gebucket op vervaldatum." },
      { label: "Openstaand klanten (AR)", detail: "Open verkoopfacturen (remainingAmount)." },
      { label: "Cashflowprognose", detail: "Directe methode, 13 weken rollend." },
    ],
    notes: [
      "Voorbeelddata (demomodus) — orde van grootte gebaseerd op de echte groep.",
      "P&L t/m nettoresultaat; resultaatverwerking (68/69/78/79) uitgesloten.",
    ],
  };
}
