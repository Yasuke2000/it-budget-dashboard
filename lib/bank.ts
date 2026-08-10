// ============================================================
// Banken — exacte bankmutaties (BankAccountLedgerEntries)
// ============================================================
// Vervangt de 55x-tegenboekings-heuristiek: dit ZIJN de bankbewegingen, per
// rekening, per dag. Levert saldo per rekening (som van alle mutaties),
// in/uit per maand per bankgroep en het inkomend volume per bank
// ("via welke bank komt geld binnen").

import type { CfoSource } from "./types";
import { fetchBCCompanies, getBCToken } from "./bc-client";
import { ODATA_ROOT, API_ROOT, pageAllOData, makePolledGetter, isOperatingCompany } from "./bc-odata";
import { fetchWithRetry } from "./http";
import { getCache, setCache } from "./sync-cache";

const r0 = (n: number) => Math.round(n);

export interface BankAccountRow {
  company: string; code: string; name: string; brand: string;
  balance: number; in12m: number; out12m: number;
}
export interface CfoBank {
  asOf: string; isLive: boolean;
  accounts: BankAccountRow[];
  months: string[];                                    // laatste 13 maanden
  byBrand: Record<string, { inflow: number[]; outflow: number[] }>;
  // cashNow = ALLE rekeningen (incl. factor/krediet in debet). De splitsing eronder
  // bestaat omdat de F&A-meeting van 10/08/2026 drie schijnbaar tegenstrijdige
  // cashcijfers opleverde: klasse 55 zei +€583k terwijl "banken saldo nu" −€846k
  // zei — het verschil was de KBC FACTORING-rekening van WHS op −€1,35M, en dat is
  // het opgenomen factorvoorschot (een SCHULD, rekening 433), geen cash.
  totals: { cashNow: number; cashOwn: number; factorCredit: number; in12m: number; out12m: number };
  sources: CfoSource[]; notes: string[];
  refreshing?: boolean;
}

// Merkherkenning uit de rekeningnaam (bankAccounts.displayName).
function brandOf(name: string): string {
  const n = (name || "").toUpperCase();
  if (/FACTOR/i.test(n)) return "Factor";
  if (n.includes("KBC")) return "KBC";
  if (n.includes("BELFIUS") || /\bBEL\b/.test(n)) return "Belfius";
  if (n.includes("BNP") || n.includes("FORTIS")) return "BNP";
  if (n.includes("ING")) return "ING";
  if (n.includes("BPOST")) return "bpost";
  if (/KAS|CASH/i.test(n)) return "Kas";
  return "Overig";
}

function monthKeys(today: Date, n: number): string[] {
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) keys.push(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  return keys;
}

interface CoBank { accounts: BankAccountRow[]; monthly: Record<string, Record<string, { in: number; out: number }>> }

async function buildCompanyBank(co: { id: string; code: string }, months: string[], todayIso: string): Promise<CoBank> {
  const key = `bank-co2-${co.code}-${months[months.length - 1]}`;
  const cached = getCache<CoBank>(key);
  if (cached) return cached;
  const token = await getBCToken();

  // Rekeningnamen uit api/v2.0
  const nameByCode: Record<string, string> = {};
  const res = await fetchWithRetry(`${API_ROOT}/companies(${co.id})/bankAccounts`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (res.ok) {
    const d = await res.json() as { value?: { number?: string; displayName?: string }[] };
    for (const b of d.value || []) nameByCode[String(b.number || "")] = String(b.displayName || b.number || "");
  }

  const agg = new Map<string, { balance: number; in12: number; out12: number }>();
  const monthly: CoBank["monthly"] = {};
  const floor12 = months[Math.max(0, months.length - 12)] + "-01";
  const handle = (e: Record<string, unknown>) => {
    const pd = String(e.Posting_Date || "").slice(0, 10);
    if (!pd || pd > todayIso) return;
    const acc = String(e.Bank_Account_No || "?");
    // Amount_LCY (euro) heeft voorrang op Amount (valuta van de rekening): anders
    // zou een GBP/USD-rekening vreemde valuta bij euro's optellen en kon het saldo
    // nooit op GL-klasse 55 aansluiten (audit 04/08/2026).
    const amt = ((e.Amount_LCY as number) ?? (e.Amount as number)) || 0;
    const a = agg.get(acc) || { balance: 0, in12: 0, out12: 0 };
    a.balance += amt;
    if (pd >= floor12) { if (amt > 0) a.in12 += amt; else a.out12 += -amt; }
    agg.set(acc, a);
    const mk = pd.slice(0, 7);
    if (months.includes(mk)) {
      const brand = brandOf(nameByCode[acc] || acc);
      const mm = (monthly[mk] = monthly[mk] || {});
      const b = (mm[brand] = mm[brand] || { in: 0, out: 0 });
      if (amt > 0) b.in += amt; else b.out += -amt;
    }
  };
  // $select met terugval. KRITIEK (audit 04/08/2026): de accumulators MOETEN gewist
  // worden vóór de tweede poging — `handle` muteert ze tijdens het pagineren, dus een
  // fout halverwege liet de eerste pagina's dubbel tellen (saldo's tot 5× te hoog).
  const base = `${ODATA_ROOT}/ODataV4/Company('${encodeURIComponent(co.code)}')/BankAccountLedgerEntries`;
  try {
    await pageAllOData(`${base}?$select=Posting_Date,Bank_Account_No,Amount,Amount_LCY`, handle, token);
  } catch {
    agg.clear();
    for (const k of Object.keys(monthly)) delete monthly[k];
    await pageAllOData(base, handle, token);
  }

  const bundle: CoBank = {
    accounts: [...agg.entries()].map(([code, a]) => ({
      company: co.code, code, name: nameByCode[code] || code, brand: brandOf(nameByCode[code] || code),
      balance: r0(a.balance), in12m: r0(a.in12), out12m: r0(a.out12),
    })),
    monthly,
  };
  setCache(key, bundle, 720);
  return bundle;
}

async function buildBank(exclude: string[]): Promise<CfoBank> {
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const months = monthKeys(today, 13);
  const raw = await fetchBCCompanies();
  const companies = raw.map((c) => ({ id: String(c.id), code: String(c.name) }))
    .filter((c) => isOperatingCompany(c.code) && !exclude.includes(c.code));
  const cos: CoBank[] = [];
  for (let i = 0; i < companies.length; i += 3) {
    cos.push(...await Promise.all(companies.slice(i, i + 3).map((c) => buildCompanyBank(c, months, todayIso))));
  }
  const accounts = cos.flatMap((c) => c.accounts).sort((a, b) => b.balance - a.balance);
  const brands = [...new Set(accounts.map((a) => a.brand))];
  const byBrand: CfoBank["byBrand"] = {};
  for (const br of brands) byBrand[br] = { inflow: months.map(() => 0), outflow: months.map(() => 0) };
  for (const c of cos) for (const [mk, mm] of Object.entries(c.monthly)) {
    const mi = months.indexOf(mk); if (mi < 0) continue;
    for (const [br, v] of Object.entries(mm)) {
      if (!byBrand[br]) byBrand[br] = { inflow: months.map(() => 0), outflow: months.map(() => 0) };
      byBrand[br].inflow[mi] += v.in; byBrand[br].outflow[mi] += v.out;
    }
  }
  for (const br of Object.keys(byBrand)) {
    byBrand[br].inflow = byBrand[br].inflow.map(r0);
    byBrand[br].outflow = byBrand[br].outflow.map(r0);
  }
  return {
    asOf: new Date().toISOString(), isLive: true,
    accounts, months, byBrand,
    totals: {
      cashNow: r0(accounts.reduce((s, a) => s + a.balance, 0)),
      // Echte cash = alles behalve de factor-/kredietgroep; factorCredit = de
      // factor-rekeningen apart (doorgaans negatief = opgenomen voorschot).
      cashOwn: r0(accounts.filter((a) => a.brand !== "Factor").reduce((s, a) => s + a.balance, 0)),
      factorCredit: r0(accounts.filter((a) => a.brand === "Factor").reduce((s, a) => s + a.balance, 0)),
      in12m: r0(accounts.reduce((s, a) => s + a.in12m, 0)),
      out12m: r0(accounts.reduce((s, a) => s + a.out12m, 0)),
    },
    sources: [
      { label: "Bankmutaties", detail: "BankAccountLedgerEntries (ODataV4), alle vennootschappen — de werkelijke bewegingen per bankrekening, geen tegenboekings-heuristiek. Saldo = som van alle mutaties (hoort aan te sluiten op GL-klasse 55)." },
    ],
    notes: [
      "In = som van positieve mutaties, uit = negatieve; interne overboekingen tussen eigen rekeningen tellen dus aan beide kanten mee (bruto). Bedragen in euro (Amount_LCY).",
      "Merkindeling gebeurt op de RÉKENINGNAAM in BC: 'Factor'/'FACTORING' → groep Factor, anders KBC/Belfius/BNP/ING/bpost/Kas/Overig. Een factorrekening die dat woord niet in haar naam heeft, komt dus bij de gewone bank terecht — namen nakijken bij twijfel.",
      "Saldo = som van álle mutaties op de rekening (dus het echte banksaldo). Aansluiting op GL-klasse 55 geldt alleen voor de eigenlijke bankrekeningen: factoring- en kredietrekeningen boeken via een eigen boekingsgroep naar een andere GL-rekening, en 'Kas' is geen bank. Het totaal 'cash nu' bevat álle rekeningen incl. Factor en Kas.",
    ],
  };
}

function demoBank(): CfoBank {
  const today = new Date();
  const months = monthKeys(today, 13);
  const w = (i: number, b: number, a: number, p = 0) => r0(b + a * Math.sin((i + p) / 2));
  const mk = (b: number, p: number) => ({ inflow: months.map((_, i) => w(i, b, b * 0.3, p)), outflow: months.map((_, i) => w(i, b * 0.96, b * 0.28, p + 1)) });
  return {
    asOf: new Date(0).toISOString(), isLive: false,
    accounts: [
      { company: "GTR", code: "KBC", name: "KBC BE43…0101", brand: "KBC", balance: 412_000, in12m: 9_800_000, out12m: 9_500_000 },
      { company: "GDI", code: "F01", name: "Belfius Factor BE12…5492", brand: "Factor", balance: 618_000, in12m: 18_400_000, out12m: 18_100_000 },
      { company: "GTR", code: "BNP", name: "BNP BE62…7561", brand: "BNP", balance: 154_000, in12m: 4_100_000, out12m: 4_050_000 },
      { company: "WHS", code: "F02", name: "KBC FACTORING BE17…4721", brand: "Factor", balance: 96_000, in12m: 12_300_000, out12m: 12_260_000 },
    ],
    months,
    byBrand: { KBC: mk(1_050_000, 0), Factor: mk(2_450_000, 1), BNP: mk(420_000, 2), ING: mk(240_000, 3) },
    totals: { cashNow: 1_280_000, cashOwn: 566_000, factorCredit: 714_000, in12m: 44_600_000, out12m: 43_910_000 },
    sources: [{ label: "Bankmutaties", detail: "Demomodus — live uit BankAccountLedgerEntries." }],
    notes: ["Voorbeelddata (demomodus)."],
  };
}

export const getBank = makePolledGetter<CfoBank>("bank-v2", buildBank, demoBank);
