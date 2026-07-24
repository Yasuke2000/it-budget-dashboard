// ============================================================
// Leasing & huur (rollend materieel) — analyse voor de CFO-cockpit.
// ============================================================
// Spec: mail Birgit (finance, 24/07/2026). Kostenrekeningen 610200/610250/
// 610260/610500 zijn leasing/huur (bedragen excl. btw); intercompany-facturen
// en huur bij niet-leasing-leveranciers (bv. Vero Duco, onderaannemer) tellen
// niet mee. Intresten: 650010. Openstaande leasingschuld: 422000 (balans).
//
// Leverancier per GL-post kennen we niet rechtstreeks (generalLedgerEntries
// draagt geen vendor) — we joinen op documentnummer met VendorLedgerEntries.
// Posten zonder match (bv. memoriaalboekingen) tellen als extern maar worden
// apart gerapporteerd ("nietToegewezen") zodat niets stil verdwijnt.

import { getCache, setCache } from "./sync-cache";
import { getAppSettings, type LeasingConfig } from "./settings-store";
import {
  fetchBCCompanies, fetchBCGlEntriesForAccount, fetchBCVendorDocMap, fetchBCClassNetBalance,
} from "./bc-client";
import { isIcName } from "./cfo";

export interface LeasingVendorRow { name: string; amount: number; kind: "extern" | "ic" | "uitgesloten" }
export interface LeasingData {
  enabled: boolean;
  demo?: boolean;
  period: { from: string; to: string };
  config: { accounts: string[]; interestAccounts: string[]; debtAccounts: string[]; excludedVendors: string[] };
  totals: {
    bruto: number;        // som van de kostenrekeningen, vóór filtering
    ic: number;           // intercompany-deel (naam-match)
    uitgesloten: number;  // uitgesloten leveranciers (bv. Vero Duco)
    extern: number;       // bruto − ic − uitgesloten = de echte leasingkost
    nietToegewezen: number; // deel van extern zonder leverancier-match (memoriaal)
    intrest: number;      // YTD intresten leasing & renting
    schuld: number;       // openstaande leasingschuld (balans, positief = schuld)
  };
  perAccount: { account: string; extern: number; bruto: number }[];
  monthly: { month: string; byAccount: Record<string, number> }[]; // extern
  perCompany: { code: string; extern: number }[];
  vendors: LeasingVendorRow[]; // grootste eerst; extern + gefilterde ter controle
  note?: string;
}

function isOperatingCompany(name: string): boolean {
  return !/^_/.test(name) && !/test|copie|fleetmate/i.test(name);
}
const r0 = (n: number) => Math.round(n);

export async function buildLeasing(exclude: string[] = [], from?: string, to?: string): Promise<LeasingData> {
  const settings = await getAppSettings();
  const cfg: LeasingConfig = settings.leasing;
  const year = new Date().getUTCFullYear();
  const f = from || `${year}-01-01`;
  const t = to || new Date().toISOString().slice(0, 10);
  const excl = [...new Set(exclude.map((x) => x.trim().toUpperCase()).filter(Boolean))].sort();

  const base: Pick<LeasingData, "enabled" | "period" | "config"> = {
    enabled: cfg.enabled,
    period: { from: f, to: t },
    config: { accounts: cfg.accounts, interestAccounts: cfg.interestAccounts, debtAccounts: cfg.debtAccounts, excludedVendors: cfg.excludedVendors },
  };
  if (!cfg.enabled) return { ...base, totals: { bruto: 0, ic: 0, uitgesloten: 0, extern: 0, nietToegewezen: 0, intrest: 0, schuld: 0 }, perAccount: [], monthly: [], perCompany: [], vendors: [] };

  if (process.env.NEXT_PUBLIC_DEMO_MODE !== "false") return demoLeasing(base);

  const cfgKey = JSON.stringify([cfg.accounts, cfg.interestAccounts, cfg.debtAccounts, cfg.excludedVendors]);
  const cacheKey = `leasing-${f}-${t}-x:${excl.join(",")}-c:${cfgKey}`;
  const cached = getCache<LeasingData>(cacheKey);
  if (cached) return cached;

  const companies = (await fetchBCCompanies())
    .map((c) => ({ id: String(c.id), code: String(c.name) }))
    .filter((c) => isOperatingCompany(c.code) && !excl.includes(c.code.toUpperCase()));

  const exVendors = cfg.excludedVendors.map((v) => v.trim().toLowerCase()).filter(Boolean);
  const totals = { bruto: 0, ic: 0, uitgesloten: 0, extern: 0, nietToegewezen: 0, intrest: 0, schuld: 0 };
  const perAccount = new Map<string, { extern: number; bruto: number }>();
  const monthly = new Map<string, Record<string, number>>();
  const perCompany: { code: string; extern: number }[] = [];
  const vendorTotals = new Map<string, { amount: number; kind: LeasingVendorRow["kind"] }>();

  const CHUNK = 3;
  for (let i = 0; i < companies.length; i += CHUNK) {
    const batch = companies.slice(i, i + CHUNK);
    await Promise.all(batch.map(async (c) => {
      const [vendorMap, ...accountRows] = await Promise.all([
        fetchBCVendorDocMap(c.code, f, t).catch(() => ({} as Record<string, string>)),
        ...cfg.accounts.map((a) => fetchBCGlEntriesForAccount(c.id, a, f, t).catch(() => [])),
      ]);
      let companyExtern = 0;
      cfg.accounts.forEach((account, ai) => {
        for (const row of accountRows[ai]) {
          const amount = row.debit - row.credit; // kosten zijn debet-normaal
          if (!amount) continue;
          const vendor = vendorMap[row.documentNumber] || "";
          const ic = vendor ? isIcName(vendor) : false;
          const uitgesloten = !ic && vendor && exVendors.some((x) => vendor.toLowerCase().includes(x));
          const pa = perAccount.get(account) || { extern: 0, bruto: 0 };
          pa.bruto += amount;
          totals.bruto += amount;
          const vKey = vendor || "(geen leverancier-match)";
          const vt = vendorTotals.get(vKey) || { amount: 0, kind: ic ? "ic" : uitgesloten ? "uitgesloten" : "extern" };
          vt.amount += amount;
          vendorTotals.set(vKey, vt);
          if (ic) { totals.ic += amount; }
          else if (uitgesloten) { totals.uitgesloten += amount; }
          else {
            totals.extern += amount;
            companyExtern += amount;
            pa.extern += amount;
            if (!vendor) totals.nietToegewezen += amount;
            const mo = row.postingDate.slice(0, 7);
            const m = monthly.get(mo) || {};
            m[account] = (m[account] || 0) + amount;
            monthly.set(mo, m);
          }
          perAccount.set(account, pa);
        }
      });
      // Intresten (650010 e.d.) — bruto, geen IC-filter (lessors zijn extern).
      for (const a of cfg.interestAccounts) {
        const rows = await fetchBCGlEntriesForAccount(c.id, a, f, t).catch(() => []);
        totals.intrest += rows.reduce((s, r) => s + (r.debit - r.credit), 0);
      }
      // Openstaande leasingschuld (422000): credit-normaal → schuld = −netto.
      for (const a of cfg.debtAccounts) {
        const net = await fetchBCClassNetBalance(c.id, a).catch(() => 0);
        totals.schuld += -net;
      }
      perCompany.push({ code: c.code, extern: r0(companyExtern) });
    }));
  }

  const result: LeasingData = {
    ...base,
    totals: {
      bruto: r0(totals.bruto), ic: r0(totals.ic), uitgesloten: r0(totals.uitgesloten),
      extern: r0(totals.extern), nietToegewezen: r0(totals.nietToegewezen),
      intrest: r0(totals.intrest), schuld: r0(totals.schuld),
    },
    perAccount: [...perAccount.entries()]
      .map(([account, v]) => ({ account, extern: r0(v.extern), bruto: r0(v.bruto) }))
      .sort((a, b) => b.extern - a.extern),
    monthly: [...monthly.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, byAccount]) => ({ month, byAccount: Object.fromEntries(Object.entries(byAccount).map(([k, v]) => [k, r0(v)])) })),
    perCompany: perCompany.filter((c) => c.extern !== 0).sort((a, b) => b.extern - a.extern),
    vendors: [...vendorTotals.entries()]
      .map(([name, v]) => ({ name, amount: r0(v.amount), kind: v.kind }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
      .slice(0, 25),
    note: totals.nietToegewezen > 0.02 * Math.max(totals.extern, 1)
      ? `€${r0(totals.nietToegewezen).toLocaleString("nl-BE")} zonder leverancier-match (memoriaal/journaal) telt als extern — controleer bij twijfel de boekingen via de drill.`
      : undefined,
  };
  setCache(cacheKey, result, 720); // 12h; settings-save wist de cache
  return result;
}

function demoLeasing(base: Pick<LeasingData, "enabled" | "period" | "config">): LeasingData {
  const accounts = base.config.accounts;
  const per = [46_000, 21_000, 14_500, 8_200];
  const monthly = ["01", "02", "03", "04", "05", "06"].map((m, i) => ({
    month: `${base.period.from.slice(0, 4)}-${m}`,
    byAccount: Object.fromEntries(accounts.map((a, j) => [a, Math.round((per[j] || 6_000) * (0.9 + ((i + j) % 4) * 0.06))])),
  }));
  const extern = monthly.reduce((s, m) => s + Object.values(m.byAccount).reduce((x, y) => x + y, 0), 0);
  return {
    ...base,
    demo: true,
    totals: { bruto: extern + 74_000, ic: 52_000, uitgesloten: 22_000, extern, nietToegewezen: 6_400, intrest: 28_400, schuld: 3_420_000 },
    perAccount: accounts.map((a, j) => ({ account: a, extern: Math.round((per[j] || 6_000) * 6), bruto: Math.round((per[j] || 6_000) * 6.3) })),
    monthly,
    perCompany: [
      { code: "GTR", extern: Math.round(extern * 0.4) }, { code: "GDI", extern: Math.round(extern * 0.3) },
      { code: "TDR", extern: Math.round(extern * 0.18) }, { code: "LMB", extern: Math.round(extern * 0.12) },
    ],
    vendors: [
      { name: "KBC Autolease", amount: Math.round(extern * 0.35), kind: "extern" },
      { name: "Van Hool Rental", amount: Math.round(extern * 0.27), kind: "extern" },
      { name: "TIP Trailer Services", amount: Math.round(extern * 0.2), kind: "extern" },
      { name: "Gheeraert Renting BV", amount: 52_000, kind: "ic" },
      { name: "Vero Duco", amount: 22_000, kind: "uitgesloten" },
    ],
    note: "Demomodus — voorbeeldcijfers volgens de echte rekeningstructuur.",
  };
}
