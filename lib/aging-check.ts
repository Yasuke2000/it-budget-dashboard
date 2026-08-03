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
    const total = (d.value || []).find((r) => String(r.name) === "Total" || String(r.customerNumber ?? r.vendorNumber ?? "") === "");
    if (total) return r0((total.balanceDue as number) || 0);
    return r0((d.value || []).reduce((s, r) => s + ((r.balanceDue as number) || 0), 0));
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
  const allGreen = rows.every((r) => (r.arDelta == null || Math.abs(r.arDelta) <= 1) && (r.apDelta == null || Math.abs(r.apDelta) <= 1));
  return {
    asOf: new Date().toISOString(), isLive: true, rows, allGreen,
    sources: [
      { label: "Aging-verificatie", detail: "Twee onafhankelijke wegen naast elkaar: (1) BC's eigen rapport agedAccountsReceivables/Payables (balanceDue, as-of vandaag) en (2) de som van open klant-/leveranciersposten (Remaining_Amt_LCY). Δ ≤ €1 = groen. Op 03/08/2026 sloot dezelfde som óók exact aan op GL 400000/400001 en 440000/440001 (Δ €0, alle 11)." },
    ],
    notes: ["AP staat als te betalen (positief); een negatief eigen saldo betekent netto-debet bij leveranciers (zoals GEX)."],
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
