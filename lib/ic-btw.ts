// IC-btw & omzetsplit per vennootschap per maand — factuurbasis (vraag David 13/08/2026).
// Bron: salesInvoices + salesCreditMemos (api/v2.0, geboekt), creditnota's verrekend.
// IC = dezelfde naamregel als het dashboard (isIcName, incl. de Lamberts-&-fix).
// Dit is een ONAFHANKELIJKE weg naast de btw-kaart (Btw_posten_Excel): facturen
// zeggen wat we aan btw factureren/ontvangen per tegenpartij; de btw-kaart volgt
// de aangifte-rekeningen. Beide horen dezelfde orde van grootte te geven.

import type { CfoSource } from "./types";
import { fetchBCCompanies, getBCToken } from "./bc-client";
import { API_ROOT, pageAllOData, makePolledGetter, isOperatingCompany } from "./bc-odata";
import { getCache, setCache } from "./sync-cache";
import { isIcName } from "./cfo";

const r0 = (n: number) => Math.round(n);

export interface IcBtwMonthRow {
  month: string;                    // "2026-01"
  extNet: number; icNet: number;    // omzet excl. btw (CN verrekend)
  extVat: number; icVat: number;    // btw-bedrag op die facturen
}
export interface IcBtwCompany {
  code: string;
  months: IcBtwMonthRow[];
  totals: { extNet: number; icNet: number; extVat: number; icVat: number };
}
export interface CfoIcBtw {
  asOf: string; isLive: boolean;
  from: string; to: string;
  months: string[];
  perCompany: IcBtwCompany[];
  group: IcBtwMonthRow[];           // groepstotaal per maand
  totals: { extNet: number; icNet: number; extVat: number; icVat: number };
  sources: CfoSource[]; notes: string[];
  refreshing?: boolean;
}

interface CoAgg { [month: string]: { extNet: number; icNet: number; extVat: number; icVat: number } }

async function buildCompany(co: { id: string; code: string }, fromIso: string, toIso: string): Promise<CoAgg> {
  const key = `icbtw-co1-${co.code}-${fromIso}-${toIso}`;
  const cached = getCache<CoAgg>(key);
  if (cached) return cached;
  const token = await getBCToken();
  const agg: CoAgg = {};
  const add = (dt: unknown, name: unknown, net: number, vat: number, sign: 1 | -1) => {
    const m = String(dt || "").slice(0, 7);
    if (!m || `${m}-01` < fromIso.slice(0, 8) + "01" || m > toIso.slice(0, 7)) return;
    const a = (agg[m] ??= { extNet: 0, icNet: 0, extVat: 0, icVat: 0 });
    if (isIcName(String(name || ""))) { a.icNet += sign * net; a.icVat += sign * vat; }
    else { a.extNet += sign * net; a.extVat += sign * vat; }
  };
  const sel = "$select=customerName,postingDate,totalAmountExcludingTax,totalTaxAmount";
  const filt = `$filter=${encodeURIComponent(`postingDate ge ${fromIso} and postingDate le ${toIso} and status ne 'Draft'`)}`;
  await pageAllOData(`${API_ROOT}/companies(${co.id})/salesInvoices?${filt}&${sel}`,
    (e) => add(e.postingDate, e.customerName, (e.totalAmountExcludingTax as number) || 0, (e.totalTaxAmount as number) || 0, 1), token);
  await pageAllOData(`${API_ROOT}/companies(${co.id})/salesCreditMemos?${filt}&${sel}`,
    (e) => add(e.postingDate, e.customerName, (e.totalAmountExcludingTax as number) || 0, (e.totalTaxAmount as number) || 0, -1), token);
  setCache(key, agg, 720);
  return agg;
}

async function buildIcBtw(exclude: string[], extra?: string): Promise<CfoIcBtw> {
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  let fromIso = `${today.getUTCFullYear()}-01-01`;
  let toIso = todayIso;
  const m2 = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(extra || "");
  if (m2 && m2[1] <= m2[2]) { fromIso = m2[1]; toIso = m2[2]; }
  const months: string[] = [];
  for (let d = new Date(`${fromIso.slice(0, 7)}-01T00:00:00Z`);
       d.toISOString().slice(0, 7) <= toIso.slice(0, 7) && months.length < 36;
       d.setUTCMonth(d.getUTCMonth() + 1)) {
    months.push(d.toISOString().slice(0, 7));
  }
  const raw = await fetchBCCompanies();
  const companies = raw.map((c) => ({ id: String(c.id), code: String(c.name) }))
    .filter((c) => isOperatingCompany(c.code) && !exclude.includes(c.code));
  const perCompany: IcBtwCompany[] = [];
  for (let i = 0; i < companies.length; i += 3) {
    const part = await Promise.all(companies.slice(i, i + 3).map(async (c) => ({ code: c.code, a: await buildCompany(c, fromIso, toIso) })));
    for (const { code, a } of part) {
      const rows: IcBtwMonthRow[] = months.map((m) => ({
        month: m,
        extNet: r0(a[m]?.extNet || 0), icNet: r0(a[m]?.icNet || 0),
        extVat: r0(a[m]?.extVat || 0), icVat: r0(a[m]?.icVat || 0),
      }));
      perCompany.push({
        code, months: rows,
        totals: {
          extNet: r0(rows.reduce((s, x) => s + x.extNet, 0)), icNet: r0(rows.reduce((s, x) => s + x.icNet, 0)),
          extVat: r0(rows.reduce((s, x) => s + x.extVat, 0)), icVat: r0(rows.reduce((s, x) => s + x.icVat, 0)),
        },
      });
    }
  }
  perCompany.sort((a, b) => (b.totals.extNet + b.totals.icNet) - (a.totals.extNet + a.totals.icNet));
  const group: IcBtwMonthRow[] = months.map((m, i) => ({
    month: m,
    extNet: r0(perCompany.reduce((s, c) => s + c.months[i].extNet, 0)),
    icNet: r0(perCompany.reduce((s, c) => s + c.months[i].icNet, 0)),
    extVat: r0(perCompany.reduce((s, c) => s + c.months[i].extVat, 0)),
    icVat: r0(perCompany.reduce((s, c) => s + c.months[i].icVat, 0)),
  }));
  const totals = {
    extNet: r0(group.reduce((s, x) => s + x.extNet, 0)), icNet: r0(group.reduce((s, x) => s + x.icNet, 0)),
    extVat: r0(group.reduce((s, x) => s + x.extVat, 0)), icVat: r0(group.reduce((s, x) => s + x.icVat, 0)),
  };
  return {
    asOf: new Date().toISOString(), isLive: true, from: fromIso, to: toIso, months, perCompany, group, totals,
    sources: [
      { label: "IC-btw & omzetsplit (factuurbasis)", detail: "salesInvoices + salesCreditMemos (api/v2.0, geboekt — status ≠ Draft) per vennootschap: netto excl. btw en het btw-bedrag per factuur, creditnota's als min. Intercompany herkend op de klantnaam met dezelfde regel als de rest van het dashboard. Dit is het FACTUURperspectief: wat er gefactureerd is, niet wat er op de 70x-grootboekrekeningen staat (GDI/WHS wijken daar bewust af — doorfacturatie)." },
    ],
    notes: [
      "IC-btw = btw die tussen eigen vennootschappen betaald en teruggevorderd wordt — de kern van de btw-eenheid-businesscase (vraag [PRIO] in de vragenlijst). In een volledige maand is dat ±€500k die intern rondgepompt wordt.",
      "De laatste 1–2 maanden zijn structureel onvolledig: IC-facturatie wordt met vertraging geboekt (GTR/GSS/GPR/GRE/TDR factureren maand M vaak pas in M+1/M+2).",
      "GPR extern bevat in maart 2026 de gebouwenverkoop (€10,63M, ES Finance) — one-off, geen bedrijfsomzet.",
    ],
  };
}

function demoIcBtw(): CfoIcBtw {
  const today = new Date();
  const y = today.getFullYear();
  const months = Array.from({ length: 6 }, (_, i) => `${y}-${String(i + 1).padStart(2, "0")}`);
  const mk = (base: number): IcBtwMonthRow[] => months.map((m, i) => ({
    month: m, extNet: r0(base * (0.9 + 0.05 * i)), icNet: r0(base * 0.25), extVat: r0(base * 0.18), icVat: r0(base * 0.05),
  }));
  const per = (code: string, base: number): IcBtwCompany => {
    const rows = mk(base);
    return { code, months: rows, totals: {
      extNet: rows.reduce((s, x) => s + x.extNet, 0), icNet: rows.reduce((s, x) => s + x.icNet, 0),
      extVat: rows.reduce((s, x) => s + x.extVat, 0), icVat: rows.reduce((s, x) => s + x.icVat, 0) } };
  };
  const perCompany = [per("GDI", 2_600_000), per("WHS", 1_900_000), per("GTR", 1_500_000)];
  const group = months.map((m, i) => ({
    month: m,
    extNet: perCompany.reduce((s, c) => s + c.months[i].extNet, 0), icNet: perCompany.reduce((s, c) => s + c.months[i].icNet, 0),
    extVat: perCompany.reduce((s, c) => s + c.months[i].extVat, 0), icVat: perCompany.reduce((s, c) => s + c.months[i].icVat, 0),
  }));
  return {
    asOf: new Date(0).toISOString(), isLive: false, from: `${y}-01-01`, to: today.toISOString().slice(0, 10),
    months, perCompany, group,
    totals: {
      extNet: group.reduce((s, x) => s + x.extNet, 0), icNet: group.reduce((s, x) => s + x.icNet, 0),
      extVat: group.reduce((s, x) => s + x.extVat, 0), icVat: group.reduce((s, x) => s + x.icVat, 0),
    },
    sources: [{ label: "IC-btw & omzetsplit", detail: "Demomodus." }], notes: ["Voorbeelddata (demomodus)."],
  };
}

export const getIcBtw = makePolledGetter<CfoIcBtw>("icbtw-v1", buildIcBtw, demoIcBtw);
