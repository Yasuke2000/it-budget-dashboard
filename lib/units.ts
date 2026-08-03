// ============================================================
// Business units — omzet/kosten/marge per AFDELING
// ============================================================
// Bron: Grootboekposten_Excel (ODataV4) — het grootboek MÉT dimensies inline
// (Global_Dimension_1_Code = AFDELING). Daarmee is de operationele P&L per
// activiteit (TRUCKING/WAREHOUSING/DISTRIBUTIE/…) rechtstreeks opvraagbaar,
// wat met api/v2.0 generalLedgerEntries niet kan (geen dimensievelden).

import type { CfoSource } from "./types";
import { fetchBCCompanies, getBCToken } from "./bc-client";
import { ODATA_ROOT, pageAllOData, makePolledGetter, isOperatingCompany } from "./bc-odata";
import { getCache, setCache } from "./sync-cache";

const r0 = (n: number) => Math.round(n);

// Vriendelijke labels (dimensiewaarden GTR, probe 03/08); onbekende codes tonen de code.
const UNIT_LABELS: Record<string, string> = {
  TRUC: "Trucking", WARE: "Warehousing", DISTR: "Distributie", TANK: "Tankstation",
  GARA: "Garage", TRUCCL: "Truckcleaning", TRANSF: "Trans-Form", OVERH: "Overhead",
};

export interface UnitRow {
  code: string; label: string;
  revenue: number; costs: number; result: number; marginPct: number;
  monthlyRevenue: number[]; monthlyCosts: number[];
}
export interface CfoUnits {
  asOf: string; isLive: boolean; year: number;
  months: string[];                       // YTD-maanden
  units: UnitRow[];                       // gesorteerd op omzet
  undimensioned: { revenue: number; costs: number; sharePct: number };
  sources: CfoSource[]; notes: string[];
  refreshing?: boolean;
}

const OP_REV = new Set(["70", "71", "72", "74"]);
const OP_COST = new Set(["60", "61", "62", "63", "64"]);

interface CoUnits { agg: Record<string, { rev: number[]; cost: number[] }> }

async function buildCompanyUnits(co: { id: string; code: string }, months: string[], todayIso: string): Promise<CoUnits> {
  const key = `units-co1-${co.code}-${todayIso.slice(0, 7)}`;
  const cached = getCache<CoUnits>(key);
  if (cached) return cached;
  const token = await getBCToken();
  const agg: CoUnits["agg"] = {};
  const filter = encodeURIComponent(
    `Posting_Date ge ${months[0]}-01 and Posting_Date le ${todayIso} and G_L_Account_No ge '600000' and G_L_Account_No le '799999'`
  );
  await pageAllOData(
    `${ODATA_ROOT}/ODataV4/Company('${encodeURIComponent(co.code)}')/Grootboekposten_Excel?$filter=${filter}&$select=Posting_Date,G_L_Account_No,Amount,Global_Dimension_1_Code`,
    (e) => {
      const c2 = String(e.G_L_Account_No || "").slice(0, 2);
      const isRev = OP_REV.has(c2), isCost = OP_COST.has(c2);
      if (!isRev && !isCost) return; // financieel/niet-recurrent (65-67/75-77) buiten de BU-view
      const mi = months.indexOf(String(e.Posting_Date || "").slice(0, 7));
      if (mi < 0) return;
      const unit = String(e.Global_Dimension_1_Code || "").trim() || "(geen)";
      const a = (agg[unit] = agg[unit] || { rev: months.map(() => 0), cost: months.map(() => 0) });
      const amt = (e.Amount as number) || 0;
      if (isRev) a.rev[mi] += -amt; else a.cost[mi] += amt; // omzet credit-normaal
    },
    token
  );
  const bundle: CoUnits = { agg };
  setCache(key, bundle, 720);
  return bundle;
}

async function buildUnits(exclude: string[]): Promise<CfoUnits> {
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const year = today.getUTCFullYear();
  const months: string[] = [];
  for (let m = 0; m <= today.getUTCMonth(); m++) months.push(`${year}-${String(m + 1).padStart(2, "0")}`);
  const raw = await fetchBCCompanies();
  const companies = raw.map((c) => ({ id: String(c.id), code: String(c.name) }))
    .filter((c) => isOperatingCompany(c.code) && !exclude.includes(c.code));
  const agg: Record<string, { rev: number[]; cost: number[] }> = {};
  for (let i = 0; i < companies.length; i += 2) {
    const part = await Promise.all(companies.slice(i, i + 2).map((c) => buildCompanyUnits(c, months, todayIso)));
    for (const p of part) for (const [u, v] of Object.entries(p.agg)) {
      const dst = (agg[u] = agg[u] || { rev: months.map(() => 0), cost: months.map(() => 0) });
      for (let m = 0; m < months.length; m++) { dst.rev[m] += v.rev[m]; dst.cost[m] += v.cost[m]; }
    }
  }
  const undim = agg["(geen)"] || { rev: months.map(() => 0), cost: months.map(() => 0) };
  delete agg["(geen)"];
  const units: UnitRow[] = Object.entries(agg)
    .map(([code, v]) => {
      const revenue = v.rev.reduce((s, x) => s + x, 0);
      const costs = v.cost.reduce((s, x) => s + x, 0);
      return {
        code, label: UNIT_LABELS[code] || code,
        revenue: r0(revenue), costs: r0(costs), result: r0(revenue - costs),
        marginPct: revenue ? Math.round(((revenue - costs) / revenue) * 1000) / 10 : 0,
        monthlyRevenue: v.rev.map(r0), monthlyCosts: v.cost.map(r0),
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
  const undimRev = undim.rev.reduce((s, x) => s + x, 0);
  const undimCost = undim.cost.reduce((s, x) => s + x, 0);
  const totalAbs = units.reduce((s, u) => s + Math.abs(u.revenue) + Math.abs(u.costs), 0) + Math.abs(undimRev) + Math.abs(undimCost);
  return {
    asOf: new Date().toISOString(), isLive: true, year, months, units,
    undimensioned: {
      revenue: r0(undimRev), costs: r0(undimCost),
      sharePct: totalAbs ? Math.round(((Math.abs(undimRev) + Math.abs(undimCost)) / totalAbs) * 1000) / 10 : 0,
    },
    sources: [
      { label: "Business units", detail: "Grootboekposten_Excel (grootboek mét dimensies inline), operationele klassen 60–64 en 70–74, YTD, alle vennootschappen. Unit = dimensie AFDELING (Global Dimension 1). Financieel resultaat (65/75), niet-recurrent (66/76) en belastingen blijven buiten deze view. Bedragen excl. btw." },
    ],
    notes: [
      "Boekingen zonder AFDELING-dimensie staan apart als 'niet toegewezen' — hoe kleiner dat blok, hoe betrouwbaarder de BU-marges (actiepunt finance als het groot is).",
      "Intercompany zit hier bruto in (P&L-IC is pas elimineerbaar als de INTERCO-dimensie consequent gevuld wordt).",
    ],
  };
}

function demoUnits(): CfoUnits {
  const today = new Date();
  const year = today.getUTCFullYear();
  const months: string[] = [];
  for (let m = 0; m <= today.getUTCMonth(); m++) months.push(`${year}-${String(m + 1).padStart(2, "0")}`);
  const mk = (base: number, margin: number): UnitRow["monthlyRevenue"] => months.map((_, i) => r0(base * (0.9 + 0.05 * Math.sin(i)) * margin));
  const mkUnit = (code: string, rev: number, marginPct: number): UnitRow => {
    const revenue = rev, costs = r0(rev * (1 - marginPct / 100));
    return { code, label: UNIT_LABELS[code] || code, revenue, costs, result: revenue - costs, marginPct, monthlyRevenue: mk(rev / months.length, 1), monthlyCosts: mk(rev / months.length, 1 - marginPct / 100) };
  };
  return {
    asOf: new Date(0).toISOString(), isLive: false, year, months,
    units: [
      mkUnit("TRUC", 21_400_000, 3.1), mkUnit("DISTR", 9_800_000, 4.6), mkUnit("WARE", 7_100_000, 8.2),
      mkUnit("TANK", 3_900_000, 2.2), mkUnit("GARA", 2_400_000, 6.8), mkUnit("TRUCCL", 900_000, 11.4),
      mkUnit("TRANSF", 700_000, 4.0), mkUnit("OVERH", 300_000, -42.0),
    ],
    undimensioned: { revenue: 850_000, costs: 1_150_000, sharePct: 4.2 },
    sources: [{ label: "Business units", detail: "Demomodus — live uit Grootboekposten_Excel (dimensie AFDELING)." }],
    notes: ["Voorbeelddata (demomodus)."],
  };
}

export const getUnits = makePolledGetter<CfoUnits>("units-v1", buildUnits, demoUnits);
