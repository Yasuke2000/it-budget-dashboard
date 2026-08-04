// ============================================================
// Vaste activa — CAPEX & afschrijvingen per activaklasse
// ============================================================
// Bronnen: FALedgerEntries (ODataV4, alle FA-boekingen) + fixedAssets (api/v2.0,
// kaart met classCode/subclassCode). Boekwaarde = som van alle FA-boekingen;
// CAPEX YTD = aanschaffingen dit jaar; afschrijving YTD idem.

import type { CfoSource } from "./types";
import { fetchBCCompanies, getBCToken } from "./bc-client";
import { ODATA_ROOT, API_ROOT, pageAllOData, makePolledGetter, isOperatingCompany } from "./bc-odata";
import { fetchWithRetry } from "./http";
import { getCache, setCache } from "./sync-cache";

const r0 = (n: number) => Math.round(n);

export interface AssetClassRow {
  classCode: string; subclassCode: string;
  count: number; bookValue: number; acquisitionYtd: number; depreciationYtd: number;
}
export interface CfoAssets {
  asOf: string; isLive: boolean; year: number;
  classes: AssetClassRow[];
  totals: { bookValue: number; acquisitionYtd: number; depreciationYtd: number; assetCount: number };
  sources: CfoSource[]; notes: string[];
  refreshing?: boolean;
}

interface CoAssets { rows: AssetClassRow[] }

async function buildCompanyAssets(co: { id: string; code: string }, year: number, todayIso: string): Promise<CoAssets> {
  const key = `assets-co1-${co.code}-${todayIso.slice(0, 7)}`;
  const cached = getCache<CoAssets>(key);
  if (cached) return cached;
  const token = await getBCToken();

  // FA-kaarten: nummer → klasse/subklasse
  const classByFa: Record<string, { c: string; s: string }> = {};
  const res = await fetchWithRetry(`${API_ROOT}/companies(${co.id})/fixedAssets`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (res.ok) {
    const d = await res.json() as { value?: { number?: string; classCode?: string; subclassCode?: string }[] };
    for (const f of d.value || []) classByFa[String(f.number || "")] = { c: String(f.classCode || "?"), s: String(f.subclassCode || "?") };
  }

  const agg = new Map<string, AssetClassRow>();
  const faSeen = new Map<string, Set<string>>();
  const ystart = `${year}-01-01`;
  const handle = (e: Record<string, unknown>) => {
    const pd = String(e.Posting_Date || "").slice(0, 10);
    if (!pd || pd > todayIso) return;
    const fa = String(e.FA_No || "");
    const cls = classByFa[fa] || { c: "?", s: "?" };
    const k = `${cls.c}|${cls.s}`;
    const row = agg.get(k) || { classCode: cls.c, subclassCode: cls.s, count: 0, bookValue: 0, acquisitionYtd: 0, depreciationYtd: 0 };
    const amt = (e.Amount as number) || 0;
    const type = String(e.FA_Posting_Type || "");
    row.bookValue += amt;
    if (pd >= ystart) {
      if (/acquisition/i.test(type)) row.acquisitionYtd += amt;
      else if (/depreciation/i.test(type)) row.depreciationYtd += -amt;
    }
    const seen = faSeen.get(k) || new Set<string>();
    if (!seen.has(fa)) { seen.add(fa); row.count++; faSeen.set(k, seen); }
    agg.set(k, row);
  };
  // Eén pull, geen stille terugval: een tweede poging op dezelfde accumulators liet de
  // al verwerkte pagina's dubbel tellen (boekwaarde/CAPEX te hoog, terwijl `count`
  // door de dedupe wél klopte — dus vrijwel onzichtbaar). Audit 04/08/2026.
  const base = `${ODATA_ROOT}/ODataV4/Company('${encodeURIComponent(co.code)}')/FALedgerEntries`;
  await pageAllOData(`${base}?$select=FA_No,FA_Posting_Type,Posting_Date,Amount`, handle, token);
  const bundle: CoAssets = { rows: [...agg.values()] };
  setCache(key, bundle, 720);
  return bundle;
}

async function buildAssets(exclude: string[]): Promise<CfoAssets> {
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const year = today.getUTCFullYear();
  const raw = await fetchBCCompanies();
  const companies = raw.map((c) => ({ id: String(c.id), code: String(c.name) }))
    .filter((c) => isOperatingCompany(c.code) && !exclude.includes(c.code));
  const agg = new Map<string, AssetClassRow>();
  for (let i = 0; i < companies.length; i += 3) {
    const part = await Promise.all(companies.slice(i, i + 3).map((c) => buildCompanyAssets(c, year, todayIso)));
    for (const p of part) for (const r of p.rows) {
      const k = `${r.classCode}|${r.subclassCode}`;
      const dst = agg.get(k) || { classCode: r.classCode, subclassCode: r.subclassCode, count: 0, bookValue: 0, acquisitionYtd: 0, depreciationYtd: 0 };
      dst.count += r.count; dst.bookValue += r.bookValue; dst.acquisitionYtd += r.acquisitionYtd; dst.depreciationYtd += r.depreciationYtd;
      agg.set(k, dst);
    }
  }
  const classes = [...agg.values()].map((r) => ({
    ...r, bookValue: r0(r.bookValue), acquisitionYtd: r0(r.acquisitionYtd), depreciationYtd: r0(r.depreciationYtd),
  })).sort((a, b) => b.bookValue - a.bookValue);
  return {
    asOf: new Date().toISOString(), isLive: true, year, classes,
    totals: {
      bookValue: r0(classes.reduce((s, c) => s + c.bookValue, 0)),
      acquisitionYtd: r0(classes.reduce((s, c) => s + c.acquisitionYtd, 0)),
      depreciationYtd: r0(classes.reduce((s, c) => s + c.depreciationYtd, 0)),
      assetCount: classes.reduce((s, c) => s + c.count, 0),
    },
    sources: [
      { label: "Vaste activa", detail: "FALedgerEntries + fixedAssets (klasse/subklasse van de activakaart). Boekwaarde = som van alle FA-boekingen t/m vandaag; CAPEX = aanschaffingsboekingen dit jaar; afschrijving = afschrijvingsboekingen dit jaar. De subklasse volgt de balansrekening (bv. 210000)." },
    ],
    notes: [
      "Activa zonder kaartkoppeling staan onder klasse '?' (als de activakaart-lijst niet geladen kon worden, valt álles daar in — dan is de indeling onbekend, niet leeg).",
      "LET OP: afschrijvingen worden bij Gheeraert grotendeels op jaareinde geboekt — YTD-afschrijving kan dus laag ogen (zelfde caveat als de cockpit-P&L).",
      "CAPEX en afschrijving zijn NETTO: correcties en tegenboekingen bij verkoop verlagen het cijfer, dus dit is geen bruto-investeringsbedrag. Boekwaarde = som van alle FA-boekingen, niet BC's eigen boekwaardeveld — desinvesteringen (Proceeds/Gain-Loss) zitten er dus in. Nog te verifiëren met finance: of er per vennootschap méér dan één afschrijvingsboek bestaat (commercieel + fiscaal); zo ja, dan tellen alle bedragen dubbel.",
      "Aantal activa = elke activakaart met minstens één boeking, dus inclusief volledig afgeschreven en verkochte activa — geen maat voor de actieve vloot.",
    ],
  };
}

function demoAssets(): CfoAssets {
  const year = new Date().getUTCFullYear();
  const mk = (c: string, s: string, n: number, bv: number, aq: number, dep: number): AssetClassRow =>
    ({ classCode: c, subclassCode: s, count: n, bookValue: bv, acquisitionYtd: aq, depreciationYtd: dep });
  const classes = [
    mk("MATERIELE", "224000", 312, 14_200_000, 2_850_000, 240_000),
    mk("MATERIELE", "221000", 18, 8_900_000, 410_000, 95_000),
    mk("MATERIELE", "230000", 84, 1_950_000, 310_000, 41_000),
    mk("MATERIELE", "240000", 129, 640_000, 118_000, 22_000),
    mk("IMMATERIELE", "211000", 6, 180_000, 45_000, 9_000),
  ];
  return {
    asOf: new Date(0).toISOString(), isLive: false, year, classes,
    totals: { bookValue: 25_870_000, acquisitionYtd: 3_733_000, depreciationYtd: 407_000, assetCount: 549 },
    sources: [{ label: "Vaste activa", detail: "Demomodus — live uit FALedgerEntries + fixedAssets." }],
    notes: ["Voorbeelddata (demomodus)."],
  };
}

export const getAssets = makePolledGetter<CfoAssets>("assets-v1", buildAssets, demoAssets);
