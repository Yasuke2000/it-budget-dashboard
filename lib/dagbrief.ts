// ============================================================
// Dagelijkse cashpositie ("dagbrief") — vraag CFO 18/08/2026
// ============================================================
// "Kunnen jullie vanaf morgen een dagelijkse cashpositie doorgeven + status van
//  de betaalde facturen van de dag ervoor … en dagelijks de dalende outstandings
//  in beeld brengen (resultaat van de credit-control-acties) … en kijken hoeveel
//  klanten we zouden blokkeren bij +75 en +60 dagen en over hoeveel omzet."
// Elke build slaat de dagstand op in Postgres (cfo_dagstand, upsert per dag) —
// zo groeit de trend vanzelf. Een ochtend-cron (07:15) ververst de bankstand.

import type { CfoSource, CfoReceivables } from "./types";
import { fetchBCCompanies, getBCToken } from "./bc-client";
import { ODATA_ROOT, pageAllOData, makePolledGetter, isOperatingCompany } from "./bc-odata";
import { getBank, type CfoBank } from "./bank";
import { getReceivables, normName } from "./receivables";
import { isIcName } from "./cfo";
import { custLedgerByCustomerLink } from "./bc-links";
import { isDbEnabled, withClient, ensureSchema } from "./db/client";

const r0 = (n: number) => Math.round(n);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export interface DagBetaler { klant: string; co: string; bedrag: number; bcUrl: string }
export interface DagBlokKlant { klant: string; co: string; oudsteDagen: number; vervallen: number; openTotaal: number; omzet12m: number | null }
export interface DagTrendRij { dag: string; bankEigen: number; openExtern: number; vervallen: number; ontvangenGister: number }
export interface CfoDagbrief {
  asOf: string; isLive: boolean;
  dag: string;               // vandaag
  bankEigen: number;         // eigen bankstand (excl. factorrekeningen)
  bankAsOf: string;          // wanneer de bankdata getrokken is
  perFirmaBank: { co: string; saldo: number }[];
  ontvangenGister: { totaal: number; aantal: number; top: DagBetaler[]; datum: string };
  openExtern: number;        // netto open extern AR (alle open posten)
  vervallen: number;         // vervallen facturen (vervaldag < vandaag), bruto
  deltaVsGister: { openExtern: number | null; vervallen: number | null };
  trend: DagTrendRij[];      // laatste 30 dagen uit cfo_dagstand
  // Blokkeeranalyse: bestaande klanten met vervallen facturen ouder dan X dagen
  blok: {
    d60: { klanten: number; vervallen: number; openTotaal: number; omzet12m: number; lijst: DagBlokKlant[] };
    d75: { klanten: number; vervallen: number; openTotaal: number; omzet12m: number; lijst: DagBlokKlant[] };
  };
  dbOk: boolean;
  sources: CfoSource[]; notes: string[];
  refreshing?: boolean;
}

async function waitFor<T>(get: () => Promise<T | { building: true }>, maxMinutes = 20): Promise<T> {
  const deadline = Date.now() + maxMinutes * 60_000;
  for (;;) {
    const r = await get();
    if (!(typeof r === "object" && r !== null && "building" in r && (r as { building?: boolean }).building)) return r as T;
    if (Date.now() > deadline) throw new Error("onderliggende dataset bleef bouwen");
    await new Promise((res) => setTimeout(res, 10_000));
  }
}

async function buildDagbrief(exclude: string[]): Promise<CfoDagbrief> {
  const today = new Date();
  const todayIso = iso(today);
  const gisterIso = iso(new Date(today.getTime() - 86400000));
  const token = await getBCToken();
  const companies = (await fetchBCCompanies())
    .filter((c) => isOperatingCompany(String(c.name)))
    .map((c) => ({ id: String(c.id), code: String(c.name) }))
    .filter((c) => !exclude.includes(c.code.toUpperCase()));

  // ---- 1. Bankstand (eigen rekeningen) uit de bank-motor ----
  const bank = await waitFor<CfoBank>(() => getBank(false, exclude) as Promise<CfoBank | { building: true }>);
  const perFirmaBankMap = new Map<string, number>();
  for (const a of bank.accounts) {
    if (a.brand === "Factor") continue;
    perFirmaBankMap.set(a.company, (perFirmaBankMap.get(a.company) || 0) + a.balance);
  }
  const perFirmaBank = [...perFirmaBankMap.entries()].map(([co, saldo]) => ({ co, saldo: r0(saldo) })).sort((a, b) => b.saldo - a.saldo);

  // ---- 2. Gisteren ontvangen klantbetalingen (wie heeft betaald) ----
  const betalers = new Map<string, DagBetaler>();
  let ontvangenTotaal = 0, ontvangenAantal = 0;
  for (const c of companies) {
    const filt = encodeURIComponent(`Posting_Date eq ${gisterIso} and Document_Type eq 'Payment'`);
    await pageAllOData(`${ODATA_ROOT}/ODataV4/Company('${encodeURIComponent(c.code)}')/Cust_LedgerEntries?$filter=${filt}&$select=Customer_No,Customer_Name,Amount_LCY`, (e) => {
      const bedrag = -((e.Amount_LCY as number) || 0); // betaling = credit → ontvangen positief
      const naam = String(e.Customer_Name || "").trim();
      if (bedrag <= 0 || isIcName(naam)) return;
      ontvangenTotaal += bedrag; ontvangenAantal++;
      const key = `${c.code}|${normName(naam)}`;
      const cur = betalers.get(key);
      if (cur) cur.bedrag += bedrag;
      else betalers.set(key, { klant: naam, co: c.code, bedrag, bcUrl: custLedgerByCustomerLink(c.code, String(e.Customer_No || "")) });
    }, token);
  }
  const topBetalers = [...betalers.values()].map((b) => ({ ...b, bedrag: r0(b.bedrag) })).sort((a, b) => b.bedrag - a.bedrag).slice(0, 30);

  // ---- 3. Open extern AR + vervallen + blokkeeranalyse (één scan) ----
  interface KlantAgg { klant: string; co: string; open: number; vervallen: number; oudsteDagen: number }
  const perKlant = new Map<string, KlantAgg>();
  let openExtern = 0, vervallenTot = 0;
  for (const c of companies) {
    const filt = encodeURIComponent("Open eq true");
    await pageAllOData(`${ODATA_ROOT}/ODataV4/Company('${encodeURIComponent(c.code)}')/Cust_LedgerEntries?$filter=${filt}&$select=Customer_Name,Document_Type,Due_Date,Remaining_Amt_LCY`, (e) => {
      const rem = (e.Remaining_Amt_LCY as number) || 0;
      const naam = String(e.Customer_Name || "").trim();
      if (Math.abs(rem) < 1 || isIcName(naam)) return;
      openExtern += rem;
      const key = normName(naam);
      const a = perKlant.get(key) || { klant: naam, co: c.code, open: 0, vervallen: 0, oudsteDagen: 0 };
      a.open += rem;
      const due = String(e.Due_Date || "").slice(0, 10);
      if (e.Document_Type === "Invoice" && due && !due.startsWith("0001") && due < todayIso && rem > 0) {
        vervallenTot += rem;
        a.vervallen += rem;
        const dagen = Math.floor((Date.parse(`${todayIso}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86400000);
        if (dagen > a.oudsteDagen) a.oudsteDagen = dagen;
      }
      perKlant.set(key, a);
    }, token);
  }

  // Omzet 12m per klant uit de klantenmotor (voor "over hoeveel omzet gaat het").
  let omzetByKlant: Record<string, number> = {};
  try {
    const rcv = await waitFor<CfoReceivables>(() => getReceivables(false, exclude) as Promise<CfoReceivables | { building: true }>, 5);
    omzetByKlant = Object.fromEntries(rcv.customers.map((c) => [normName(c.name), c.invoiced12m]));
  } catch { /* nog aan het bouwen → omzet12m = null in de lijsten */ }

  const blokLijst = (minDagen: number): CfoDagbrief["blok"]["d60"] => {
    const lijst: DagBlokKlant[] = [...perKlant.values()]
      .filter((a) => a.oudsteDagen >= minDagen && a.vervallen > 500)
      .map((a) => ({
        klant: a.klant, co: a.co, oudsteDagen: a.oudsteDagen,
        vervallen: r0(a.vervallen), openTotaal: r0(a.open),
        omzet12m: omzetByKlant[normName(a.klant)] != null ? r0(omzetByKlant[normName(a.klant)]) : null,
      }))
      .sort((x, y) => y.vervallen - x.vervallen);
    return {
      klanten: lijst.length,
      vervallen: r0(lijst.reduce((s, x) => s + x.vervallen, 0)),
      openTotaal: r0(lijst.reduce((s, x) => s + x.openTotaal, 0)),
      omzet12m: r0(lijst.reduce((s, x) => s + (x.omzet12m || 0), 0)),
      lijst: lijst.slice(0, 40),
    };
  };

  // ---- 4. Dagstand opslaan + trend lezen (Postgres) ----
  let trend: DagTrendRij[] = [];
  let dbOk = false;
  if (isDbEnabled()) {
    try {
      await ensureSchema();
      await withClient(async (cl) => {
        await cl.query(
          `INSERT INTO cfo_dagstand (dag, bank_eigen, open_extern, vervallen, ontvangen_gister, detail)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (dag) DO UPDATE SET bank_eigen=$2, open_extern=$3, vervallen=$4, ontvangen_gister=$5, detail=$6, updated_at=NOW()`,
          [todayIso, r0(bank.totals.cashOwn), r0(openExtern), r0(vervallenTot), r0(ontvangenTotaal),
           JSON.stringify({ perFirmaBank, topBetalers: topBetalers.slice(0, 10) })]
        );
        const res = await cl.query(
          `SELECT dag::text AS dag, bank_eigen, open_extern, vervallen, ontvangen_gister
           FROM cfo_dagstand ORDER BY dag DESC LIMIT 30`
        );
        trend = res.rows.map((r: Record<string, unknown>) => ({
          dag: String(r.dag).slice(0, 10), bankEigen: Number(r.bank_eigen), openExtern: Number(r.open_extern),
          vervallen: Number(r.vervallen), ontvangenGister: Number(r.ontvangen_gister),
        })).reverse();
      });
      dbOk = true;
    } catch (e) { console.error("dagbrief: dagstand niet opgeslagen:", e); }
  }
  const gisterRij = trend.length >= 2 ? trend[trend.length - 2] : null;

  return {
    asOf: new Date().toISOString(), isLive: true,
    dag: todayIso,
    bankEigen: r0(bank.totals.cashOwn), bankAsOf: bank.asOf,
    perFirmaBank,
    ontvangenGister: { totaal: r0(ontvangenTotaal), aantal: ontvangenAantal, top: topBetalers, datum: gisterIso },
    openExtern: r0(openExtern), vervallen: r0(vervallenTot),
    deltaVsGister: {
      openExtern: gisterRij ? r0(openExtern - gisterRij.openExtern) : null,
      vervallen: gisterRij ? r0(vervallenTot - gisterRij.vervallen) : null,
    },
    trend,
    blok: { d60: blokLijst(60), d75: blokLijst(75) },
    dbOk,
    sources: [
      { label: "Bankstand", detail: `Eigen bankrekeningen (excl. factorrekeningen) uit BankAccountLedgerEntries — stand van de datapull ${bank.asOf.slice(0, 16)}. De ochtend-cron (07:15) ververst dit dagelijks.` },
      { label: "Gisteren betaald", detail: "Cust_LedgerEntries, Document_Type = Payment, boekdatum = gisteren, extern — per klant gesommeerd. LET OP: dit is de BOEKdatum; betalingen die de bank al zag maar nog niet geboekt zijn, verschijnen pas na verwerking (CODA-koppeling = fase 2)." },
      { label: "Outstandings & blokkeeranalyse", detail: "Alle open externe klantposten (netto, incl. CN/betalingen) + vervallen facturen (vervaldag < vandaag). Blokkeerlijst: klanten met minstens één vervallen factuur ouder dan 60/75 dagen en > €500 vervallen; omzet 12m per klant uit de klantenmotor (incl. btw). Drempels zijn instelbaar — dit is een beslisondersteuning, geen automatische blokkade." },
      { label: "Trend", detail: "Eén rij per dag in Postgres (cfo_dagstand), gevuld bij elke verversing — de dalende lijn is het resultaat van de credit-control-acties." },
    ],
    notes: [
      "De bellijst voor Stijn/Laura/Nicolas: de blokkeerlijsten hieronder, of de klantenaging-export (blad Samenvatting, sorteer op 'Waarvan vervallen').",
      "Trend start vandaag — elke dag komt er een punt bij.",
    ],
  };
}

function demoDagbrief(): CfoDagbrief {
  return {
    asOf: new Date().toISOString(), isLive: false, dag: iso(new Date()),
    bankEigen: 722_000, bankAsOf: new Date().toISOString(),
    perFirmaBank: [{ co: "WHS", saldo: 318_000 }, { co: "GDI", saldo: 225_000 }],
    ontvangenGister: { totaal: 412_000, aantal: 37, top: [{ klant: "DEMO KLANT", co: "GTR", bedrag: 120_000, bcUrl: "#" }], datum: iso(new Date(Date.now() - 86400000)) },
    openExtern: 10_300_000, vervallen: 5_400_000,
    deltaVsGister: { openExtern: -180_000, vervallen: -120_000 },
    trend: [], blok: {
      d60: { klanten: 42, vervallen: 2_100_000, openTotaal: 3_400_000, omzet12m: 9_800_000, lijst: [] },
      d75: { klanten: 25, vervallen: 1_500_000, openTotaal: 2_300_000, omzet12m: 6_100_000, lijst: [] },
    },
    dbOk: false,
    sources: [{ label: "Demo", detail: "Demomodus." }], notes: [],
  };
}

export const getDagbrief = makePolledGetter<CfoDagbrief>("dagbrief-v1", buildDagbrief, demoDagbrief);
