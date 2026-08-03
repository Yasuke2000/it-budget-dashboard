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
import { isIcName } from "./cfo";
import { normName } from "./receivables";

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
// De échte "business units" van de groep zijn grotendeels de vennootschappen zelf —
// de AFDELING-dimensie wordt maar door een deel van de firma's ingevuld (GTR ~99%,
// GDI ~0%; live-check 03/08). Daarom is de per-vennootschap-view de primaire laag.
export const COMPANY_ACTIVITY: Record<string, string> = {
  GTR: "Trucking", GDI: "Distributie", WHS: "Warehousing", TDR: "Transport (De Rudder)",
  GRE: "Verhuur trekkers/trailers", GTG: "Garage", GSS: "Shared services", GPR: "Vastgoed",
  GEX: "Express", LMB: "Transport (Lamberts)", TFO: "Trans-Form",
};
export interface CompanyUnitRow {
  code: string; activity: string;
  revenue: number; costs: number; result: number; marginPct: number;
  icRevenuePct: number;         // aandeel IC in de omzet van deze firma
  dimCoveragePct: number;       // % P&L-volume mét AFDELING-dimensie (datakwaliteit)
}
export interface ConsClassRow {
  cls: string; label: string;
  gross: number; ic: number; net: number;  // bruto / intercompany-deel / geconsolideerd
  kind: "income" | "expense";
}
export interface CustRevRow { name: string; amount: number; ic: boolean; sharePct: number }
export interface CfoUnits {
  asOf: string; isLive: boolean; year: number;
  months: string[];                       // YTD-maanden
  perCompany: CompanyUnitRow[];           // primaire BU-laag: vennootschap = activiteit
  units: UnitRow[];                       // AFDELING-dimensie (waar ingevuld), gesorteerd op omzet
  undimensioned: { revenue: number; costs: number; sharePct: number };
  // Echte IC-eliminatie: elke GL-regel classificeert op tegenpartij (Source-naam + IC-code).
  consolidated: {
    byClass: ConsClassRow[];
    totals: {
      revenueGross: number; revenueIc: number; revenueNet: number;
      costsGross: number; costsIc: number; costsNet: number;
      ebitdaGross: number; ebitdaNet: number;
    };
    icSymmetry: { icRevenue: number; icCosts: number; delta: number; note: string };
    coveragePct: number;                  // aandeel P&L-volume mét herkenbare tegenpartij
  };
  // Omzet per klant, excl. btw, rechtstreeks uit de 70x-grootboekregels (Source = klant).
  revenuePerCustomer: CustRevRow[];
  sources: CfoSource[]; notes: string[];
  refreshing?: boolean;
}

const OP_REV = new Set(["70", "71", "72", "74"]);
const OP_COST = new Set(["60", "61", "62", "63", "64"]);

interface CoUnits {
  agg: Record<string, { rev: number[]; cost: number[] }>;
  icByClass: Record<string, { gross: number; ic: number }>; // per 2-cijferklasse, teken-genormaliseerd
  custRev: Record<string, { amt: number; ic: boolean }>;    // genormaliseerde klantnaam → omzet excl. btw
  sourcedAbs: number; totalAbs: number;                     // dekking tegenpartij-herkenning
  totals: { rev: number; cost: number; icRev: number; dimmedAbs: number }; // firma-totalen + dim-dekking
}

async function buildCompanyUnits(co: { id: string; code: string }, months: string[], todayIso: string): Promise<CoUnits> {
  const key = `units-co3-${co.code}-${todayIso.slice(0, 7)}`;
  const cached = getCache<CoUnits>(key);
  if (cached) return cached;
  const token = await getBCToken();
  const agg: CoUnits["agg"] = {};
  const icByClass: CoUnits["icByClass"] = {};
  const custRev: CoUnits["custRev"] = {};
  const totals = { rev: 0, cost: 0, icRev: 0, dimmedAbs: 0 };
  let sourcedAbs = 0, totalAbs = 0;
  const filter = encodeURIComponent(
    `Posting_Date ge ${months[0]}-01 and Posting_Date le ${todayIso} and G_L_Account_No ge '600000' and G_L_Account_No le '799999'`
  );
  await pageAllOData(
    `${ODATA_ROOT}/ODataV4/Company('${encodeURIComponent(co.code)}')/Grootboekposten_Excel?$filter=${filter}&$select=Posting_Date,G_L_Account_No,Amount,Global_Dimension_1_Code,Source_Type,ESCW_Source_Name,IC_Partner_Code`,
    (e) => {
      const c2 = String(e.G_L_Account_No || "").slice(0, 2);
      const isRev = OP_REV.has(c2), isCost = OP_COST.has(c2);
      if (!isRev && !isCost) return; // financieel/niet-recurrent (65-67/75-77) buiten deze view
      const mi = months.indexOf(String(e.Posting_Date || "").slice(0, 7));
      if (mi < 0) return;
      const amt = (e.Amount as number) || 0;
      const signed = isRev ? -amt : amt; // omzet credit-normaal → positief maken
      // per business unit
      const unit = String(e.Global_Dimension_1_Code || "").trim() || "(geen)";
      const a = (agg[unit] = agg[unit] || { rev: months.map(() => 0), cost: months.map(() => 0) });
      if (isRev) a.rev[mi] += signed; else a.cost[mi] += signed;
      // IC-classificatie per regel: tegenpartijnaam (99% gevuld op omzet, probe 03/08) + IC-code
      const srcName = String(e.ESCW_Source_Name || "");
      const hasSrc = Boolean(srcName) || Boolean(String(e.IC_Partner_Code || "").trim());
      const ic = isIcName(srcName) || Boolean(String(e.IC_Partner_Code || "").trim());
      const cls = (icByClass[c2] = icByClass[c2] || { gross: 0, ic: 0 });
      cls.gross += signed; if (ic) cls.ic += signed;
      totalAbs += Math.abs(signed); if (hasSrc) sourcedAbs += Math.abs(signed);
      if (isRev) { totals.rev += signed; if (ic) totals.icRev += signed; } else totals.cost += signed;
      if (unit !== "(geen)") totals.dimmedAbs += Math.abs(signed);
      // omzet per klant (excl. btw)
      if (isRev && e.Source_Type === "Customer" && srcName) {
        const cKey = normName(srcName);
        const c = (custRev[cKey] = custRev[cKey] || { amt: 0, ic });
        c.amt += signed; if (ic) c.ic = true;
      }
    },
    token
  );
  const bundle: CoUnits = { agg, icByClass, custRev, sourcedAbs, totalAbs, totals };
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
  const icByClass: Record<string, { gross: number; ic: number }> = {};
  const custRev: Record<string, { amt: number; ic: boolean }> = {};
  const perCompany: CompanyUnitRow[] = [];
  let sourcedAbs = 0, totalAbs = 0;
  for (let i = 0; i < companies.length; i += 2) {
    const part = await Promise.all(companies.slice(i, i + 2).map(async (c) => ({ code: c.code, b: await buildCompanyUnits(c, months, todayIso) })));
    for (const { code, b: p } of part) {
      for (const [u, v] of Object.entries(p.agg)) {
        const dst = (agg[u] = agg[u] || { rev: months.map(() => 0), cost: months.map(() => 0) });
        for (let m = 0; m < months.length; m++) { dst.rev[m] += v.rev[m]; dst.cost[m] += v.cost[m]; }
      }
      for (const [c, v] of Object.entries(p.icByClass)) {
        const dst = (icByClass[c] = icByClass[c] || { gross: 0, ic: 0 });
        dst.gross += v.gross; dst.ic += v.ic;
      }
      for (const [c, v] of Object.entries(p.custRev)) {
        const dst = (custRev[c] = custRev[c] || { amt: 0, ic: v.ic });
        dst.amt += v.amt; if (v.ic) dst.ic = true;
      }
      sourcedAbs += p.sourcedAbs; totalAbs += p.totalAbs;
      const t = p.totals;
      perCompany.push({
        code, activity: COMPANY_ACTIVITY[code] || code,
        revenue: r0(t.rev), costs: r0(t.cost), result: r0(t.rev - t.cost),
        marginPct: t.rev ? Math.round(((t.rev - t.cost) / t.rev) * 1000) / 10 : 0,
        icRevenuePct: t.rev ? Math.round((t.icRev / t.rev) * 1000) / 10 : 0,
        dimCoveragePct: p.totalAbs ? Math.round((t.dimmedAbs / p.totalAbs) * 1000) / 10 : 0,
      });
    }
  }
  perCompany.sort((a, b) => b.revenue - a.revenue);
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
  const buAbs = units.reduce((s, u) => s + Math.abs(u.revenue) + Math.abs(u.costs), 0) + Math.abs(undimRev) + Math.abs(undimCost);

  // ---- geconsolideerde P&L (IC-eliminatie per regel) ----
  const CLASS_LABEL: Record<string, string> = {
    "70": "Omzet", "71": "Voorraadwijziging", "72": "Geproduceerde vaste activa", "74": "Andere bedrijfsopbrengsten",
    "60": "Aankopen & handelsgoederen", "61": "Diensten & diverse goederen", "62": "Bezoldigingen & sociale lasten",
    "63": "Afschrijvingen & waardeverm.", "64": "Andere bedrijfskosten",
  };
  const byClass: ConsClassRow[] = [...OP_REV, ...OP_COST]
    .filter((c) => icByClass[c])
    .map((c) => ({
      cls: c, label: CLASS_LABEL[c] || c,
      gross: r0(icByClass[c].gross), ic: r0(icByClass[c].ic), net: r0(icByClass[c].gross - icByClass[c].ic),
      kind: OP_REV.has(c) ? "income" as const : "expense" as const,
    }));
  const sum = (kind: "income" | "expense", f: (r: ConsClassRow) => number) =>
    byClass.filter((r) => r.kind === kind).reduce((s, r) => s + f(r), 0);
  const revenueGross = sum("income", (r) => r.gross), revenueIc = sum("income", (r) => r.ic);
  const costsGross = sum("expense", (r) => r.gross), costsIc = sum("expense", (r) => r.ic);
  const consolidated: CfoUnits["consolidated"] = {
    byClass,
    totals: {
      revenueGross: r0(revenueGross), revenueIc: r0(revenueIc), revenueNet: r0(revenueGross - revenueIc),
      costsGross: r0(costsGross), costsIc: r0(costsIc), costsNet: r0(costsGross - costsIc),
      ebitdaGross: r0(revenueGross - costsGross), ebitdaNet: r0((revenueGross - revenueIc) - (costsGross - costsIc)),
    },
    icSymmetry: {
      icRevenue: r0(revenueIc), icCosts: r0(costsIc), delta: r0(revenueIc - costsIc),
      note: "IC-omzet en IC-kosten (klassen 70–74 vs 60–64) horen groepsbreed te spiegelen; Δ = asymmetrische boekingen (bv. eenzijdige doorrekeningen, IC via 65x/74x-randgevallen, timing) — onderzoekslijst voor finance.",
    },
    coveragePct: totalAbs ? Math.round((sourcedAbs / totalAbs) * 1000) / 10 : 0,
  };

  // ---- omzet per klant (excl. btw), top-50 ----
  const revenuePerCustomer: CustRevRow[] = Object.entries(custRev)
    .map(([name, v]) => ({ name, amount: r0(v.amt), ic: v.ic, sharePct: revenueGross ? Math.round((v.amt / revenueGross) * 1000) / 10 : 0 }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 50);

  return {
    asOf: new Date().toISOString(), isLive: true, year, months, perCompany, units,
    undimensioned: {
      revenue: r0(undimRev), costs: r0(undimCost),
      sharePct: buAbs ? Math.round(((Math.abs(undimRev) + Math.abs(undimCost)) / buAbs) * 1000) / 10 : 0,
    },
    consolidated, revenuePerCustomer,
    sources: [
      { label: "Per vennootschap (primair)", detail: "Grootboekposten_Excel, operationele klassen 60–64/70–74 per vennootschap, YTD, excl. btw. De vennootschappen ZIJN grotendeels de activiteiten van de groep (GDI=distributie, GTR=trucking, WHS=warehousing, …) — deze laag is volledig en betrouwbaar, óók zonder dimensies." },
      { label: "AFDELING-dimensie (secundair)", detail: "Zelfde bron, gesplitst op de AFDELING-dimensie — maar die wordt niet overal ingevuld (GTR ~99%, GDI ~0%; groepsbreed ontbreekt ±57%). Gebruik deze laag alleen voor firma's met hoge dekking (kolom 'AFDELING-dekking'); de rest staat in 'niet toegewezen'. Financieel resultaat/belastingen blijven buiten beide lagen." },
      { label: "IC-eliminatie (geconsolideerd)", detail: "Elke grootboekregel classificeert op zijn tegenpartij: Source-naam (99% gevuld op omzetregels, probe 03/08/2026) + IC-partnercode, met dezelfde naam-matching als de gevalideerde exports. Geconsolideerd = bruto − IC. De symmetrie-check (IC-omzet ↔ IC-kost) toont hoe sluitend de eliminatie is." },
      { label: "Omzet per klant", detail: "70x-omzetregels gegroepeerd op de klant achter de boeking (Source_Type=Customer), excl. btw — dus het P&L-perspectief, niet het te-innen-bedrag (dat staat op Klanten & Cash, incl. btw)." },
    ],
    notes: [
      "LET OP bij de AFDELING-laag: 'Distributie' oogt daar klein omdat GDI (dé distributiefirma, grootste omzet) de dimensie niet invult — GDI's volume zit in 'niet toegewezen'. De per-vennootschap-tabel bovenaan geeft het echte beeld. Actiepunt finance: AFDELING overal laten overerven.",
      "Beide lagen zijn bruto; de geconsolideerde kaart elimineert IC per regel (tegenpartij-herkenning). De kolom 'IC-omzet' per firma toont hoeveel van de omzet intra-groep is.",
      "Marge per klant vergt de kóstenkant per klant (welke onderaannemersrit hoort bij welke klant) — die koppeling zit niet in BC (Job_No leeg); dat is TMS/job-costing-terrein. Tot dan tonen we omzet per klant zonder schijnmarge.",
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
    perCompany: [
      { code: "GDI", activity: "Distributie", revenue: 16_900_000, costs: 16_400_000, result: 500_000, marginPct: 3.0, icRevenuePct: 8.1, dimCoveragePct: 1.2 },
      { code: "GTR", activity: "Trucking", revenue: 12_400_000, costs: 12_100_000, result: 300_000, marginPct: 2.4, icRevenuePct: 6.0, dimCoveragePct: 98.7 },
      { code: "WHS", activity: "Warehousing", revenue: 10_900_000, costs: 10_100_000, result: 800_000, marginPct: 7.3, icRevenuePct: 17.9, dimCoveragePct: 2.4 },
      { code: "GRE", activity: "Verhuur trekkers/trailers", revenue: 5_200_000, costs: 4_100_000, result: 1_100_000, marginPct: 21.2, icRevenuePct: 64.0, dimCoveragePct: 11.0 },
      { code: "GTG", activity: "Garage", revenue: 3_900_000, costs: 3_600_000, result: 300_000, marginPct: 7.7, icRevenuePct: 55.3, dimCoveragePct: 84.2 },
    ],
    units: [
      mkUnit("TRUC", 21_400_000, 3.1), mkUnit("DISTR", 9_800_000, 4.6), mkUnit("WARE", 7_100_000, 8.2),
      mkUnit("TANK", 3_900_000, 2.2), mkUnit("GARA", 2_400_000, 6.8), mkUnit("TRUCCL", 900_000, 11.4),
      mkUnit("TRANSF", 700_000, 4.0), mkUnit("OVERH", 300_000, -42.0),
    ],
    undimensioned: { revenue: 850_000, costs: 1_150_000, sharePct: 4.2 },
    consolidated: {
      byClass: [
        { cls: "70", label: "Omzet", gross: 46_500_000, ic: 10_400_000, net: 36_100_000, kind: "income" },
        { cls: "74", label: "Andere bedrijfsopbrengsten", gross: 1_400_000, ic: 350_000, net: 1_050_000, kind: "income" },
        { cls: "60", label: "Aankopen & handelsgoederen", gross: 4_100_000, ic: 420_000, net: 3_680_000, kind: "expense" },
        { cls: "61", label: "Diensten & diverse goederen", gross: 24_800_000, ic: 9_600_000, net: 15_200_000, kind: "expense" },
        { cls: "62", label: "Bezoldigingen & sociale lasten", gross: 11_900_000, ic: 0, net: 11_900_000, kind: "expense" },
        { cls: "64", label: "Andere bedrijfskosten", gross: 1_300_000, ic: 180_000, net: 1_120_000, kind: "expense" },
      ],
      totals: {
        revenueGross: 47_900_000, revenueIc: 10_750_000, revenueNet: 37_150_000,
        costsGross: 42_100_000, costsIc: 10_200_000, costsNet: 31_900_000,
        ebitdaGross: 5_800_000, ebitdaNet: 5_250_000,
      },
      icSymmetry: { icRevenue: 10_750_000, icCosts: 10_200_000, delta: 550_000, note: "Demomodus — Δ = asymmetrische IC-boekingen." },
      coveragePct: 96.4,
    },
    revenuePerCustomer: [
      { name: "COLRUYT GROUP", amount: 6_900_000, ic: false, sharePct: 14.4 },
      { name: "GHEERAERT DISTRIBUTION", amount: 5_800_000, ic: true, sharePct: 12.1 },
      { name: "DELHAIZE", amount: 4_200_000, ic: false, sharePct: 8.8 },
      { name: "AB INBEV", amount: 3_100_000, ic: false, sharePct: 6.5 },
      { name: "MILCOBEL", amount: 2_400_000, ic: false, sharePct: 5.0 },
      { name: "BARRY CALLEBAUT", amount: 1_900_000, ic: false, sharePct: 4.0 },
    ],
    sources: [{ label: "Business units", detail: "Demomodus — live uit Grootboekposten_Excel (dimensie AFDELING)." }],
    notes: ["Voorbeelddata (demomodus)."],
  };
}

export const getUnits = makePolledGetter<CfoUnits>("units-v3", buildUnits, demoUnits);
