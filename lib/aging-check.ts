// ============================================================
// Aging-verificatielaag — BC's eigen aged-rapporten vs onze cijfers
// ============================================================
// Onafhankelijke controle: BC's kant-en-klare agedAccountsReceivables/Payables
// (rapport-entiteiten) naast onze eigen som van open klant-/leveranciersposten.
// Alles ✓ = de dashboards en BC's eigen rapporten vertellen hetzelfde verhaal.

import type { CfoSource } from "./types";
import { fetchBCCompanies, getBCToken } from "./bc-client";
import { ODATA_ROOT, API_ROOT, pageAllOData, makePolledGetter, isOperatingCompany } from "./bc-odata";
import { fetchWithRetry } from "./http";

const r0 = (n: number) => Math.round(n);

export interface AgingCheckRow {
  company: string;
  arBcAged: number | null;   // BC-rapport agedAccountsReceivables (Total)
  arOwn: number;              // eigen som open Cust_LedgerEntries
  arDelta: number | null;
  apBcAged: number | null;    // BC-rapport agedAccountsPayables (Total)
  apOwn: number;              // eigen som open VendorLedgerEntries
  apDelta: number | null;
}
export interface CfoAgingCheck {
  asOf: string; isLive: boolean;
  rows: AgingCheckRow[];
  allGreen: boolean;
  comparisons?: number;    // aantal firma's waarvoor BC's rapport werkelijk antwoordde
  unchecked?: string[];    // firma's zonder vergelijking (rapport-endpoint gaf niets)
  sources: CfoSource[]; notes: string[];
  refreshing?: boolean;
}

async function agedTotal(kind: "agedAccountsReceivables" | "agedAccountsPayables", coId: string, token: string): Promise<number | null> {
  try {
    const res = await fetchWithRetry(`${API_ROOT}/companies(${coId})/${kind}`, {
      headers: { Authorization: `Bearer ${token}`, "Data-Access-Intent": "ReadOnly", Accept: "application/json" },
    }, { timeoutMs: 90_000, maxAttempts: 2 });
    if (!res.ok) return null;
    const d = await res.json() as { value?: Record<string, unknown>[] };
    const rows = d.value || [];
    if (!rows.length) return null;                       // niets ontvangen ≠ €0
    // BC's aged-rapport levert soms een expliciete totaalrij (name = "Total").
    // ALLEEN op die naam matchen: eerder werd óók "partij-nummer is leeg" als
    // totaalrij gelezen, waardoor één willekeurige nummerloze rij het hele totaal
    // kon vervangen (auditbevinding 04/08/2026).
    const total = rows.find((r) => String(r.name || "").trim().toLowerCase() === "total");
    if (total) return r0((total.balanceDue as number) || 0);
    const partyRows = rows.filter((r) => String(r.customerNumber ?? r.vendorNumber ?? "").trim());
    if (!partyRows.length) return null;                  // alleen kop-/totaalrijen → onbekend
    return r0(partyRows.reduce((s, r) => s + ((r.balanceDue as number) || 0), 0));
  } catch { return null; }
}

async function buildAgingCheck(exclude: string[]): Promise<CfoAgingCheck> {
  const token = await getBCToken();
  const raw = await fetchBCCompanies();
  const companies = raw.map((c) => ({ id: String(c.id), code: String(c.name) }))
    .filter((c) => isOperatingCompany(c.code) && !exclude.includes(c.code));
  const rows: AgingCheckRow[] = [];
  for (const co of companies) {
    let arOwn = 0, apOwn = 0;
    await pageAllOData(`${ODATA_ROOT}/ODataV4/Company('${encodeURIComponent(co.code)}')/Cust_LedgerEntries?$filter=Open eq true&$select=Remaining_Amt_LCY`, (e) => { arOwn += (e.Remaining_Amt_LCY as number) || 0; }, token);
    await pageAllOData(`${ODATA_ROOT}/ODataV4/Company('${encodeURIComponent(co.code)}')/VendorLedgerEntries?$filter=Open eq true&$select=Remaining_Amt_LCY`, (e) => { apOwn += -((e.Remaining_Amt_LCY as number) || 0); }, token);
    const arBc = await agedTotal("agedAccountsReceivables", co.id, token);
    const apBc = await agedTotal("agedAccountsPayables", co.id, token);
    rows.push({
      company: co.code,
      arBcAged: arBc, arOwn: r0(arOwn), arDelta: arBc == null ? null : r0(arBc - arOwn),
      apBcAged: apBc, apOwn: r0(apOwn), apDelta: apBc == null ? null : r0(apBc - apOwn),
    });
  }
  // "Groen" mag NOOIT betekenen dat er niets vergeleken kon worden: als BC's
  // rapport-endpoints niet antwoordden (throttling ná 22 zware pulls) waren alle
  // delta's null en meldde het paneel toch "alles groen". Nu vereist groen dat er
  // werkelijk vergelijkingen zijn én dat ze alle binnen €1 vallen.
  const comparisons = rows.filter((r) => r.arDelta != null || r.apDelta != null).length;
  const allGreen = comparisons === rows.length && rows.length > 0
    && rows.every((r) => (r.arDelta == null || Math.abs(r.arDelta) <= 1) && (r.apDelta == null || Math.abs(r.apDelta) <= 1));
  const unchecked = rows.filter((r) => r.arDelta == null && r.apDelta == null).map((r) => r.company);
  return {
    asOf: new Date().toISOString(), isLive: true, rows, allGreen,
    comparisons, unchecked,
    sources: [
      { label: "Aging-verificatie", detail: "Twee onafhankelijke wegen naast elkaar: (1) BC's eigen rapport agedAccountsReceivables/Payables (balanceDue, as-of vandaag) en (2) de som van open klant-/leveranciersposten (Remaining_Amt_LCY). Δ ≤ €1 = groen. Op 03/08/2026 sloot dezelfde som óók exact aan op GL 400000/400001 en 440000/440001 (Δ €0, alle 11)." },
    ],
    notes: [
      "AP staat als te betalen (positief); een negatief eigen saldo betekent netto-debet bij leveranciers (zoals GEX).",
      "Twee peilmomenten kunnen licht verschillen: de eigen som is de stand NU (alle open posten), BC's rapport rekent op zijn eigen as-of-datum en in documentvaluta. Een vooruit geboekte factuur of een niet-euro-klant kan daardoor een kleine Δ geven zonder dat er iets fout is.",
      "'Niet gecontroleerd' betekent dat BC's rapport-endpoint niets teruggaf (bv. throttling) — dat is nooit hetzelfde als groen.",
    ],
  };
}

function demoAgingCheck(): CfoAgingCheck {
  const rows: AgingCheckRow[] = ["GTR", "GDI", "WHS", "TDR"].map((c, i) => ({
    company: c, arBcAged: 2_048_496 - i * 400_000, arOwn: 2_048_496 - i * 400_000, arDelta: 0,
    apBcAged: 2_165_389 - i * 380_000, apOwn: 2_165_389 - i * 380_000, apDelta: 0,
  }));
  return {
    asOf: new Date(0).toISOString(), isLive: false, rows, allGreen: true,
    sources: [{ label: "Aging-verificatie", detail: "Demomodus." }],
    notes: ["Voorbeelddata (demomodus)."],
  };
}

export const getAgingCheck = makePolledGetter<CfoAgingCheck>("agingchk-v1", buildAgingCheck, demoAgingCheck);
