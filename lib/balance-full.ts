// ============================================================
// Volledige balans — uit BC's trialBalances (per rekening, op datum)
// ============================================================
// De cockpit-balans was "condensed" (klasse 1/2/3/55 + AP/AR). Dit bouwt de
// VOLLEDIGE balans op elke gewenste datum uit het kant-en-klare
// trialBalances-rapport (saldo per rekening met dateFilter), gegroepeerd naar
// PCMN-rubrieken, met de rekeningen als drill.

import type { CfoSource } from "./types";
import { fetchBCCompanies, getBCToken } from "./bc-client";
import { API_ROOT, isOperatingCompany, isDemoMode } from "./bc-odata";
import { fetchWithRetry } from "./http";
import { getCache, setCache } from "./sync-cache";

const r0 = (n: number) => Math.round(n);
const num = (s: unknown): number => parseFloat(String(s ?? "0").replace(/,/g, "")) || 0;

export interface BalanceAccount { number: string; name: string; amount: number }
export interface BalanceRubriek { key: string; label: string; amount: number; accountCount: number; accounts: BalanceAccount[] }
export interface CfoFullBalance {
  asOf: string; asOfDate: string; isLive: boolean;
  assets: BalanceRubriek[]; liabilities: BalanceRubriek[];
  totalAssets: number; totalLiabilities: number; delta: number;
  sources: CfoSource[]; notes: string[];
}

// PCMN-rubriek per rekeningnummer. Activa = debet-normaal (+), passiva = credit-normaal (−).
function rubriekOf(n: string): { key: string; label: string; side: "A" | "P" } | null {
  const c1 = n[0]; const c2 = n.slice(0, 2); const c3 = n.slice(0, 3);
  if (c1 === "2") {
    if (c2 === "20" || c2 === "21") return { key: "20-21", label: "Immateriële & oprichtingskosten", side: "A" };
    if (c2 === "28" || c2 === "29") return { key: "28-29", label: "Financiële vaste activa & LT-vorderingen", side: "A" };
    return { key: "22-27", label: "Materiële vaste activa", side: "A" };
  }
  if (c1 === "3") return { key: "3", label: "Voorraden & bestellingen in uitvoering", side: "A" };
  if (c2 === "40" || c2 === "41") return { key: "40-41", label: "Handels- & overige vorderingen", side: "A" };
  if (c3 === "490" || c3 === "491") return { key: "490-491", label: "Overlopende rekeningen (actief)", side: "A" };
  if (c1 === "5") return { key: "5", label: "Liquide middelen & geldbeleggingen", side: "A" };
  if (c1 === "1") {
    if (c2 === "16") return { key: "16", label: "Voorzieningen & uitgestelde belastingen", side: "P" };
    if (c2 === "17") return { key: "17", label: "Schulden op meer dan één jaar", side: "P" };
    return { key: "10-15", label: "Eigen vermogen", side: "P" };
  }
  if (c1 === "4") {
    if (c2 === "42") return { key: "42", label: "LT-schulden die dit jaar vervallen", side: "P" };
    if (c2 === "43") return { key: "43", label: "Financiële schulden ≤ 1 jaar", side: "P" };
    if (c2 === "44") return { key: "44", label: "Handelsschulden", side: "P" };
    if (c2 === "45") return { key: "45", label: "Belastingen, bezoldigingen & sociale lasten", side: "P" };
    if (c3 === "492" || c3 === "493") return { key: "492-493", label: "Overlopende rekeningen (passief)", side: "P" };
    return { key: "46-48", label: "Overige schulden", side: "P" };
  }
  return null; // klasse 0/6/7 horen niet op de balans
}

const RUBRIEK_ORDER_A = ["20-21", "22-27", "28-29", "3", "40-41", "490-491", "5"];
const RUBRIEK_ORDER_P = ["10-15", "16", "17", "42", "43", "44", "45", "46-48", "492-493"];

async function buildBalance(dateIso: string, exclude: string[]): Promise<CfoFullBalance> {
  const token = await getBCToken();
  const raw = await fetchBCCompanies();
  const companies = raw.map((c) => ({ id: String(c.id), code: String(c.name) }))
    .filter((c) => isOperatingCompany(c.code) && !exclude.includes(c.code));

  const perRubriek = new Map<string, { label: string; side: "A" | "P"; byAccount: Map<string, { name: string; amount: number }> }>();
  for (const co of companies) {
    const url = `${API_ROOT}/companies(${co.id})/trialBalances?$filter=${encodeURIComponent(`dateFilter eq ${dateIso}`)}`;
    const res = await fetchWithRetry(url, { headers: { Authorization: `Bearer ${token}`, "Data-Access-Intent": "ReadOnly", Accept: "application/json" } }, { timeoutMs: 90_000, maxAttempts: 3 });
    if (!res.ok) throw new Error(`trialBalances ${co.code}: ${res.status}`);
    const d = await res.json() as { value?: Record<string, unknown>[] };
    for (const row of d.value || []) {
      if (String(row.accountType) !== "Posting") continue;
      const nr = String(row.number || "");
      const rub = rubriekOf(nr);
      if (!rub) continue;
      const bal = num(row.balanceAtDateDebit) - num(row.balanceAtDateCredit); // debet-positief
      if (Math.abs(bal) < 0.005) continue;
      const dst = perRubriek.get(rub.key) || { label: rub.label, side: rub.side, byAccount: new Map() };
      const acc = dst.byAccount.get(nr) || { name: String(row.display || nr), amount: 0 };
      acc.amount += bal;
      dst.byAccount.set(nr, acc);
      perRubriek.set(rub.key, dst);
    }
  }

  const mkRows = (order: string[], side: "A" | "P"): BalanceRubriek[] =>
    order
      .map((key) => {
        const r = perRubriek.get(key);
        if (!r) return null;
        // Activa tonen debet-positief; passiva credit-positief.
        const sign = side === "A" ? 1 : -1;
        const accounts = [...r.byAccount.entries()]
          .map(([number, a]) => ({ number, name: a.name, amount: r0(sign * a.amount) }))
          .filter((a) => Math.abs(a.amount) >= 1)
          .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
        return {
          key, label: r.label,
          amount: r0(accounts.reduce((s, a) => s + a.amount, 0)),
          accountCount: accounts.length,
          accounts: accounts.slice(0, 10),
        };
      })
      .filter((x): x is BalanceRubriek => Boolean(x));

  const assets = mkRows(RUBRIEK_ORDER_A, "A");
  const liabilities = mkRows(RUBRIEK_ORDER_P, "P");
  const totalAssets = r0(assets.reduce((s, r) => s + r.amount, 0));
  const totalLiabilities = r0(liabilities.reduce((s, r) => s + r.amount, 0));
  return {
    asOf: new Date().toISOString(), asOfDate: dateIso, isLive: true,
    assets, liabilities, totalAssets, totalLiabilities, delta: r0(totalAssets - totalLiabilities),
    sources: [
      { label: "Volledige balans", detail: `BC-rapport trialBalances per vennootschap met dateFilter=${dateIso}: saldo per rekening (balanceAtDate), gesommeerd over de scope en gegroepeerd naar PCMN-rubrieken. Alleen 'Posting'-rekeningen; resultaatrekeningen (6/7) horen hier niet in — het lopende resultaat zit dus in Δ tot het wordt overgeboekt.` },
    ],
    notes: [
      "Activa − passiva zou ~0 moeten zijn ná resultaatverwerking; tijdens het jaar is Δ ≈ het nog niet toegewezen resultaat.",
      "Intercompany is hier NIET geëlimineerd (statutaire brutobalans, som van de vennootschappen).",
    ],
  };
}

function demoBalance(dateIso: string): CfoFullBalance {
  const mk = (key: string, label: string, amount: number): BalanceRubriek =>
    ({ key, label, amount, accountCount: 6, accounts: [{ number: `${key.slice(0, 2)}0000`, name: label, amount }] });
  const assets = [
    mk("22-27", "Materiële vaste activa", 21_100_000), mk("28-29", "Financiële vaste activa & LT-vorderingen", 2_400_000),
    mk("3", "Voorraden & bestellingen in uitvoering", 410_000), mk("40-41", "Handels- & overige vorderingen", 16_900_000),
    mk("490-491", "Overlopende rekeningen (actief)", 850_000), mk("5", "Liquide middelen & geldbeleggingen", 1_280_000),
  ];
  const liabilities = [
    mk("10-15", "Eigen vermogen", 13_800_000), mk("16", "Voorzieningen & uitgestelde belastingen", 900_000),
    mk("17", "Schulden op meer dan één jaar", 9_200_000), mk("42", "LT-schulden die dit jaar vervallen", 2_100_000),
    mk("43", "Financiële schulden ≤ 1 jaar", 1_700_000), mk("44", "Handelsschulden", 12_300_000),
    mk("45", "Belastingen, bezoldigingen & sociale lasten", 2_050_000), mk("492-493", "Overlopende rekeningen (passief)", 890_000),
  ];
  const ta = assets.reduce((s, r) => s + r.amount, 0);
  const tl = liabilities.reduce((s, r) => s + r.amount, 0);
  return {
    asOf: new Date(0).toISOString(), asOfDate: dateIso, isLive: false,
    assets, liabilities, totalAssets: ta, totalLiabilities: tl, delta: ta - tl,
    sources: [{ label: "Volledige balans", detail: "Demomodus — live uit trialBalances." }],
    notes: ["Voorbeelddata (demomodus)."],
  };
}

/** Volledige balans op datum; snel genoeg voor een directe call (≈11 lichte pulls), cache 30 min. */
export async function getFullBalance(dateIso?: string, exclude: string[] = []): Promise<CfoFullBalance> {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateIso || "") ? dateIso! : new Date().toISOString().slice(0, 10);
  if (isDemoMode()) return demoBalance(date);
  const excl = [...new Set(exclude.map((x) => x.trim().toUpperCase()).filter(Boolean))].sort();
  const key = `fullbal-v1-${date}-x:${excl.join(",")}`;
  const cached = getCache<CfoFullBalance>(key);
  if (cached) return cached;
  const result = await buildBalance(date, excl);
  setCache(key, result, 30);
  return result;
}
